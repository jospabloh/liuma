// notifyTicketCreated — real-time push of a freshly created SupportTicket to
// ACACIA Mission Control, so the support desk is notified within seconds instead
// of waiting for Mission Control's daily pull sync.
//
// The app's support UI calls this (fire-and-forget) right after it creates a
// SupportTicket. It runs server-side with the customer's token, re-reads the
// ticket with the service role, and POSTs it to Mission Control's HMAC-signed
// ingest endpoint. The signature is computed here — the shared secret never
// reaches the browser.
//
// Same file deploys to every ticket app (puntos / rumbo / liuma / stockflow /
// flowfin). The only per-app difference is the secret ACACIA_APP_SLUG (the
// Mission Control app id this backend belongs to).
//
// Required app secrets (npx base44 secrets set):
//   INGEST_HMAC_SECRET   — shared with Mission Control (already set for acaciaControl)
//   ACACIA_MC_INGEST_URL — e.g. https://control.acaciaco.com.mx/api/ingest/ticket
//   ACACIA_APP_SLUG      — this app's Mission Control id: puntos|rumbo|liuma|stockflow|flowfin
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';
import { signAs } from './_acaciaSign.ts';

// stableStringify and hmacHex used to live here, hand-mirrored against Mission
// Control's api/_lib/ingestSign.js. Both now come from _acaciaSign.ts, the
// canonical copy in jospabloh/acacia-app-standard → shared/bridge/ — a
// hand-kept mirror of a signing routine is exactly the thing that drifts, and
// a drift here surfaces only as "bad signature" at runtime.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const ticketId = body?.ticketId;
    // Always SupportTicket. This used to accept `entity` from the body, so a
    // caller could push any record they had created (an EmergencyContact, a
    // UserProfile…) to Mission Control's ticket ingest, signed with LIUMA's
    // key (P7, 2026-09-29). There is no second entity this function serves.
    if (!ticketId) return Response.json({ error: 'ticketId required' }, { status: 400 });

    const secret = Deno.env.get('INGEST_HMAC_SECRET');
    const url = Deno.env.get('ACACIA_MC_INGEST_URL');
    const app = Deno.env.get('ACACIA_APP_SLUG');
    if (!secret || !url || !app) {
      return Response.json({ error: 'notify not configured (INGEST_HMAC_SECRET/ACACIA_MC_INGEST_URL/ACACIA_APP_SLUG)' }, { status: 503 });
    }

    // Re-read the ticket as the service role (authoritative copy, not client input).
    const sr = base44.asServiceRole;
    const record = await sr.entities.SupportTicket.get(ticketId).catch(() => null);
    if (!record) return Response.json({ error: 'ticket not found' }, { status: 404 });

    // Ownership guard: only notify for a ticket the caller actually raised (or an
    // admin/owner). The notification only ever reaches ACACIA operators, but this
    // stops a customer firing alerts for arbitrary ids.
    const role = String(user.role ?? '').toLowerCase();
    const isStaff = role === 'admin' || role === 'owner';
    const owns =
      record.requester_user_id === user.id ||
      record.created_by_id === user.id ||
      record.created_by === user.email ||
      record.created_by_email === user.email;
    if (!isStaff && !owns) return Response.json({ error: 'forbidden' }, { status: 403 });

    const ts = Date.now().toString();
    const params = { app, record };
    // Signed with THIS app's derived key, not the bare INGEST_HMAC_SECRET.
    // That secret is one value shared by the whole portfolio, so a signature
    // made with it proves "someone holds the shared secret" and never "this is
    // <app>" — and since the app name travels in the body, any app could sign
    // a payload naming another. See _acaciaSign.ts, and Module 15 of
    // jospabloh/acacia-app-standard.
    const sig = await signAs(secret, app, ts, 'ticket.ingest', params);

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app, record, ts, sig }),
    });
    const out = await resp.json().catch(() => ({}));
    if (!resp.ok) return Response.json({ ok: false, status: resp.status, mc: out }, { status: 502 });
    return Response.json({ ok: true, mc: out });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
