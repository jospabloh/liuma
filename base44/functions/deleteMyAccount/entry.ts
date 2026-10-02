// deleteMyAccount — "Eliminar mi cuenta y mis datos" (v1.9.0).
//
//   { action: 'preview' }                    → { platformOwner, hasProfile,
//                                                soleAdmin, soleAdminSchools }
//   { action: 'delete', confirm: 'ELIMINAR' } → deletes the CALLER's account
//   { action: 'cancel' }                     → undoes a deletion that started
//                                              but never reserved
//
// Service role, and everything derives from the authenticated caller: there is
// no target in the body, so nobody can delete anyone else. What is deleted,
// what stays with the school and why, and what code cannot do (Lumi
// conversations, Base44's trash) are documented where the rules live,
// ./_deletion.ts — pure and tested by node --test
// (tests/unit/account-deletion.test.js) against an in-memory database.
//
// The page is src/pages/EliminarCuenta.jsx; it is reachable from the consent
// screen ("No acepto") and from every role's menu.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';
import { DeletionIncompleteError, cancelDeletion, previewDeletion, runAccountDeletion } from './_deletion.ts';

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
    const action = String(body?.action || '');
    const sr = base44.asServiceRole;
    let result;
    if (action === 'preview') {
      result = await previewDeletion(sr, user);
    } else if (action === 'delete') {
      result = await runAccountDeletion({
        sr,
        user,
        body: body || {},
        now: new Date(),
        userAgent: String(req.headers.get('user-agent') || ''),
      });
    } else if (action === 'cancel') {
      // "Cancelar la baja y volver": only before the reservation (see
      // cancelDeletion in ./_deletion.ts).
      result = await cancelDeletion(sr, user);
    } else {
      return Response.json({ ok: false, code: 'BAD_ACTION', error: 'action must be preview, delete or cancel' }, { status: 400 });
    }
    return Response.json(result.body, { status: result.status });
  } catch (e) {
    // Every step is idempotent, so a failure part-way is safe to retry: the
    // page says so and offers "Intentar de nuevo".
    // A bulk step stopped with rows left: nothing was marked deleted yet, and
    // a retry continues where this one stopped (DeletionIncompleteError).
    if (e instanceof DeletionIncompleteError) {
      console.warn('deleteMyAccount incomplete', e.message);
      return Response.json({ ok: false, code: e.code, error: e.code }, { status: e.status });
    }
    if (isRateLimitError(e)) {
      console.warn('deleteMyAccount rate limited');
      return Response.json({ ok: false, code: 'RATE_LIMITED', error: 'RATE_LIMITED' }, { status: 429, headers: { 'Retry-After': '10' } });
    }
    console.error('deleteMyAccount failed', (e as Error)?.message);
    return Response.json({ ok: false, code: 'INTERNAL', error: 'INTERNAL' }, { status: 500 });
  }
});
