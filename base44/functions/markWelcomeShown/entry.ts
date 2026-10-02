// markWelcomeShown — the one UserProfile field a user writes on their own row
// (P10 review, 2026-09-29).
//
// WHY THIS EXISTS. schoolRead reads a whole school with the service role,
// scoped ONLY by the caller's own UserProfile (school_id, app_role, status).
// Those fields are locked per field in UserProfile.jsonc (P7), but nobody has
// verified that the live engine enforces a per-field `rls.write` on a user's
// own row. So UserProfile.update is now service-role only at the ENTITY level
// — isolation no longer rests on per-field enforcement — and the welcome
// modal's "don't show again" (Home.jsx, the only client write of a profile)
// comes through here.
//
// Request: { profileId } → { ok }. The profile must be the caller's own; the
// only field written is welcome_message_shown: true. Nothing else from the
// body reaches the write.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';

function bad(status: number, code: string): Response {
  return Response.json({ ok: false, code, error: code }, { status });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return bad(401, 'UNAUTHENTICATED');
    // A deletion of this account started or finished (deleteMyAccount): no
    // access here, whatever consent stamp a race may have left behind.
    // auth.me() returns the User's custom fields, so this costs no read.
    if (accountDeletionBlocked(user)) return Response.json({ ok: false, code: 'ACCOUNT_DELETION_IN_PROGRESS', error: 'ACCOUNT_DELETION_IN_PROGRESS' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const profileId = String(body?.profileId || '');
    if (!profileId) return bad(400, 'MISSING_PROFILE');

    const sr = base44.asServiceRole;
    const profile: { id?: string; user_id?: string } | null = await sr.entities.UserProfile.get(profileId).catch(() => null);
    if (!profile || String(profile.user_id || '') !== String(user.id)) return bad(404, 'NOT_FOUND');

    await sr.entities.UserProfile.update(profileId, { welcome_message_shown: true });
    return Response.json({ ok: true });
  } catch (e) {
    console.error('markWelcomeShown failed', (e as Error)?.message);
    return Response.json({ ok: false, code: 'INTERNAL', error: 'INTERNAL' }, { status: 500 });
  }
});

// MIRRORS myConsent/_consent.ts#accountDeletionStartedAt/accountDeletedAt.
// Identical in every consent-gated function; tests/unit/account-deletion.test.js
// checks the copies and where each one is called.
function accountDeletionBlocked(user: unknown): boolean {
  const u = (user ?? {}) as {
    account_deletion_started_at?: unknown;
    account_deleted_at?: unknown;
    data?: { account_deletion_started_at?: unknown; account_deleted_at?: unknown } | null;
  };
  const started = u.account_deletion_started_at ?? u.data?.account_deletion_started_at;
  const deleted = u.account_deleted_at ?? u.data?.account_deleted_at;
  return (typeof started === 'string' && started !== '') || (typeof deleted === 'string' && deleted !== '');
}
