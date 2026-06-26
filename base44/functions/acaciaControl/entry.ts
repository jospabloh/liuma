// acaciaControl — ACACIA Mission Control admin bridge for this Base44 app.
//
// Mission Control calls this function over an HMAC-signed body (no user token):
//   { action, params, ts, sig }
// We verify the signature against the app secret INGEST_HMAC_SECRET (set via
// `npx base44 secrets set`), then run the requested action with the service
// role. Single channel for reads (license sync, usage) and writes (Fase 6).
// Same file deploys to every app.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const MAX_SKEW_MS = 5 * 60 * 1000;
const COUNT_CAP = 5000; // Base44 caps list at 5,000 — usage counts are capped here.

// Stable JSON: keys sorted recursively, so MC and this function sign the exact
// same string (must mirror api/_lib/ingestSign.js in Mission Control).
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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

Deno.serve(async (req) => {
  try {
    const secret = Deno.env.get('INGEST_HMAC_SECRET');
    if (!secret) return Response.json({ error: 'INGEST_HMAC_SECRET not set in app secrets' }, { status: 500 });

    const body = await req.json().catch(() => ({}));
    const { action, params = {}, ts, sig } = body ?? {};
    if (!action || !ts || !sig) return Response.json({ error: 'missing action/ts/sig' }, { status: 400 });
    if (Math.abs(Date.now() - Number(ts)) > MAX_SKEW_MS) return Response.json({ error: 'stale request' }, { status: 401 });

    const expected = await hmacHex(secret, `${ts}.${action}.${stableStringify(params)}`);
    if (!timingSafeEqual(expected, String(sig))) return Response.json({ error: 'bad signature' }, { status: 401 });

    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;

    switch (action) {
      case 'ping':
        return Response.json({ ok: true, pong: true });

      case 'licenses.list': {
        const entity = params.entity;
        if (!entity) return Response.json({ error: 'params.entity required' }, { status: 400 });
        const records = await sr.entities[entity].list('-created_date', COUNT_CAP);
        return Response.json({ ok: true, records });
      }

      case 'usage.summary': {
        // Count records of each requested entity → product-usage signal.
        const entities: string[] = Array.isArray(params.entities) ? params.entities : [];
        const counts: Record<string, number | null> = {};
        for (const e of entities) {
          try {
            const rows = await sr.entities[e].list('-created_date', COUNT_CAP);
            counts[e] = rows.length;
          } catch {
            counts[e] = null; // entity missing/inaccessible in this app
          }
        }
        return Response.json({ ok: true, counts, cap: COUNT_CAP });
      }

      case 'emails.status': {
        // Read follow-up / lifecycle email history for one tenant from the app's
        // email log entity (apps that have one). Returns [] when absent. Read-only.
        const logEntity = params.logEntity;
        const idField = params.idField;
        const id = params.id;
        if (!logEntity || !idField || !id) return Response.json({ error: 'params.logEntity/idField/id required' }, { status: 400 });
        try {
          const rows = await sr.entities[logEntity].filter({ [idField]: id });
          const records = (rows ?? []).map((r: Record<string, unknown>) => ({
            email_type: r.email_type, status: r.status, sent_at: r.sent_at, recipient_email: r.recipient_email,
          }));
          return Response.json({ ok: true, records });
        } catch (e) {
          return Response.json({ ok: true, records: [], note: (e as Error).message });
        }
      }

      case 'license.set': {
        // Mission Control writes a tenant's license (service-role, HMAC-gated).
        // MC owns the per-app field mapping and builds `patch`; optional `log`
        // appends an audit row (e.g. puntos LicenseEvent). Returns the updated row.
        const entity = params.entity;
        const id = params.id;
        const patch = params.patch;
        if (!entity || !id || !patch || typeof patch !== 'object') {
          return Response.json({ error: 'params.entity/id/patch required' }, { status: 400 });
        }
        const updated = await sr.entities[entity].update(id, patch);
        const log = params.log;
        if (log && log.entity && log.row && typeof log.row === 'object') {
          try { await sr.entities[log.entity].create(log.row); } catch { /* audit best-effort */ }
        }
        return Response.json({ ok: true, updated });
      }

      case 'emails.sendFollowup': {
        // Mission Control sends ONE renewal follow-up to a tenant (HMAC-gated,
        // service-role). MC owns the recipient + rendered content; the bridge
        // just sends via the app email integration and optionally logs it.
        const to = params.to;
        const subject = params.subject;
        const html = params.html;
        if (!to || !subject || !html) return Response.json({ error: 'params.to/subject/html required' }, { status: 400 });
        await sr.integrations.Core.SendEmail({ to, subject, body: html, from_name: 'ACACIA' });
        const sent_at = new Date().toISOString();
        const log = params.log;
        if (log && log.entity && log.row && typeof log.row === 'object') {
          try { await sr.entities[log.entity].create({ ...log.row, sent_at }); } catch { /* audit best-effort */ }
        }
        return Response.json({ ok: true, sent_at, recipient: to });
      }

      case 'tenants.contacts': {
        // Resolve recipient contacts for the app's tenants (read-only). MC passes
        // the per-app recipient spec: emails from fields on the license record, or
        // from a related entity (membership / school). Used to target campaigns.
        const entity = params.entity;
        const r = params.recipient || {};
        if (!entity) return Response.json({ error: 'params.entity required' }, { status: 400 });
        const records = await sr.entities[entity].list('-created_date', COUNT_CAP);
        const contacts = [];
        for (const rec of records) {
          let email = '';
          if (Array.isArray(r.fields)) {
            for (const f of r.fields) { if (rec[f]) { email = String(rec[f]); break; } }
          }
          if (!email && r.related && r.related.entity && r.related.keyField && r.related.emailField) {
            try {
              const key = r.related.keyFromRecord ? rec[r.related.keyFromRecord] : rec.id;
              const rows = await sr.entities[r.related.entity].filter({ [r.related.keyField]: key });
              let pick = rows[0];
              if (Array.isArray(r.related.roles) && r.related.roleField) {
                const m = rows.find((x) => r.related.roles.includes(x[r.related.roleField]));
                if (m) pick = m;
              }
              if (pick) email = String(pick[r.related.emailField] || '');
            } catch { /* skip this record */ }
          }
          contacts.push({ id: rec.id, name: (r.nameField ? rec[r.nameField] : rec.name) || null, email: email || null });
        }
        return Response.json({ ok: true, contacts });
      }

      // Fase 6 — writes land here, e.g. 'license.activate' / 'license.suspend'.

      default:
        return Response.json({ error: `unknown action: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
