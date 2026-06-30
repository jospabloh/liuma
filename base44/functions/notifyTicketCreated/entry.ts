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
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Stable JSON (keys sorted recursively) — MUST mirror Mission Control's
// api/_lib/ingestSign.js so both sides sign the exact same string.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const ticketId = body?.ticketId;
    const entity = typeof body?.entity === 'string' && body.entity ? body.entity : 'SupportTicket';
    if (!ticketId) return Response.json({ error: 'ticketId required' }, { status: 400 });

    const secret = Deno.env.get('INGEST_HMAC_SECRET');
    const url = Deno.env.get('ACACIA_MC_INGEST_URL');
    const app = Deno.env.get('ACACIA_APP_SLUG');
    if (!secret || !url || !app) {
      return Response.json({ error: 'notify not configured (INGEST_HMAC_SECRET/ACACIA_MC_INGEST_URL/ACACIA_APP_SLUG)' }, { status: 503 });
    }

    // Re-read the ticket as the service role (authoritative copy, not client input).
    const sr = base44.asServiceRole;
    const record = await sr.entities[entity].get(ticketId).catch(() => null);
    if (!record) return Response.json({ error: 'ticket not found' }, { status: 404 });

    // Ownership guard: only notify for a ticket the caller actually raised (or an
    // admin/owner). The notification only ever reaches ACACIA operators, but this
    // stops a customer firing alerts for arbitrary ids.
    const role = String(user.role ?? '').toLowerCase();
    const isStaff = role === 'admin' || role === 'owner';
    const owns =
      record.created_by_id === user.id ||
      record.created_by === user.email ||
      record.created_by_email === user.email;
    if (!isStaff && !owns) return Response.json({ error: 'forbidden' }, { status: 403 });

    const ts = Date.now().toString();
    const params = { app, record };
    const sig = await hmacHex(secret, `${ts}.ticket.ingest.${stableStringify(params)}`);

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
