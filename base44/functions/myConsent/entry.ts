// myConsent — the caller's own consent to the Aviso de Privacidad and the
// Términos (v1.9.0, owner decision 2026-10-02: accepting is mandatory).
//
//   { action: 'status' }  → { required, hasProfile, role, noticeVersion,
//                             termsVersion, accountDeleted? }
//   { action: 'accept', general: true, sensitive: true, noticeVersion,
//     termsVersion }      → writes a ConsentRecord and stamps the profile.
//
// src/components/consent/ConsentGate.jsx calls `status` only when the
// profile it already loaded lacks the current stamp, and shows the blocking
// screen while `required` is true. The rules live in ./_consent.ts (pure,
// tested by node --test against an in-memory database); this file only wires
// the request to them. Everything is derived from the authenticated caller.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';
import { acceptConsent, consentStatus } from './_consent.ts';

// Same test as schoolRead/_answer.ts#isRateLimitError (functions cannot
// import across directories; tests/unit/rate-limit-resilience.test.js keeps
// the copies in step).
function isRateLimitError(e: unknown): boolean {
  const err = e as { status?: unknown; message?: unknown } | null;
  return err?.status === 429 || /rate limit/i.test(String(err?.message ?? ''));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ ok: false, code: 'UNAUTHENTICATED', error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || 'status');
    const sr = base44.asServiceRole;
    let result;
    if (action === 'status') {
      result = await consentStatus(sr, user);
    } else if (action === 'accept') {
      result = await acceptConsent(sr, user, body || {}, new Date(), String(req.headers.get('user-agent') || ''));
    } else {
      return Response.json({ ok: false, code: 'BAD_ACTION', error: 'action must be status or accept' }, { status: 400 });
    }
    return Response.json(result.body, { status: result.status });
  } catch (e) {
    if (isRateLimitError(e)) {
      console.warn('myConsent rate limited');
      return Response.json({ ok: false, code: 'RATE_LIMITED', error: 'RATE_LIMITED' }, { status: 429, headers: { 'Retry-After': '3' } });
    }
    console.error('myConsent failed', (e as Error)?.message);
    return Response.json({ ok: false, code: 'INTERNAL', error: 'INTERNAL' }, { status: 500 });
  }
});
