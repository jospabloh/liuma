// acaciaControl — ACACIA Mission Control admin bridge for this Base44 app.
//
// Mission Control calls this function over an HMAC-signed body (no user token):
//   { action, params, ts, sig }
// We verify the signature against the app secret INGEST_HMAC_SECRET (set via
// `npx base44 secrets set`), then run the requested action with the service
// role. This is the single channel for both reads (license sync) and, later,
// writes (activate/suspend licenses — Fase 6). Same file deploys to every app.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const MAX_SKEW_MS = 5 * 60 * 1000;

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
        const records = await sr.entities[entity].list('-created_date', 5000);
        return Response.json({ ok: true, records });
      }

      // Fase 6 — writes land here, e.g. 'license.activate' / 'license.suspend',
      // each doing sr.entities[entity].update(id, {...}) under the service role.

      default:
        return Response.json({ error: `unknown action: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
