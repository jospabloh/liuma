// recordAuditEvent — the only client path into AuditLog.
//
// WHY THIS EXISTS (P7, 2026-09-29)
// AuditLog's create RLS was "data.user_id is you", so any signed-in user
// could write any action, with any role and details, into any school's log —
// which makes the log worthless as evidence. Create is now service-role only.
// Backend functions write their own rows directly; the client's remaining
// audit calls (src/lib/audit.js) come through here, where:
//
//   - user_id, user_email, actor and role come from the authenticated user
//     and their own profile, never from the request;
//   - the caller must have a profile in the school the row is filed under;
//   - each action needs a minimum standing (./_policy.ts ACTION_TIER): a
//     parent can't log 'USER_APPROVED', nobody can log the server's own
//     RECORD_* actions.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';
import { withDeletionGuard } from './_deletionGuard.ts';
import { boundDetails, decideAuditWrite } from './_policy.ts';

function bad(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, code, error: message }, { status });
}

function short(value: unknown, max = 300): string | null {
  if (value === undefined || value === null || value === '') return null;
  return String(value).slice(0, max);
}

Deno.serve(withDeletionGuard(async (req, guarded) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return bad(401, 'UNAUTHENTICATED', 'Unauthorized');
    // A deletion of this account started or finished (deleteMyAccount): no
    // access here, whatever consent stamp a race may have left behind.
    // auth.me() returns the User's custom fields, so this costs no read.
    if (accountDeletionBlocked(user)) return Response.json({ ok: false, code: 'ACCOUNT_DELETION_IN_PROGRESS', error: 'ACCOUNT_DELETION_IN_PROGRESS' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const schoolId = String(body?.schoolId || '');
    const action = String(body?.action || '');
    if (!schoolId) return bad(400, 'MISSING_SCHOOL', 'schoolId is required');
    if (!action) return bad(400, 'MISSING_ACTION', 'action is required');

    // Every write checked against a concurrent deletion (./_deletionGuard.ts).
    const sr = guarded(base44.asServiceRole, String(user.id));
    const isPlatformOwner = user.role === 'admin';
    const profiles: Array<{ app_role?: string; status?: string }> = await sr.entities.UserProfile.filter({
      user_id: user.id,
      school_id: schoolId,
    });

    const decision = decideAuditWrite({ action, isPlatformOwner, profiles });
    if (!decision.ok) return bad(403, decision.code, decision.message);

    const activeProfile = profiles.find((p) => p.status === 'ACTIVE') || profiles[0] || null;
    const role = isPlatformOwner && !activeProfile ? 'OWNER' : String(activeProfile?.app_role || '');
    const context = boundDetails(body?.context);
    const entity = short(body?.entity, 100);
    const entityId = short(body?.entityId);

    const row = await sr.entities.AuditLog.create({
      school_id: schoolId,
      user_id: user.id,
      user_email: user.email,
      actor: user.id,
      role,
      action,
      entity,
      entity_id: entityId,
      target_type: entity,
      target_id: entityId,
      reason: short(body?.reason, 500),
      context,
      details: context,
      timestamp: new Date().toISOString(),
    });
    return Response.json({ ok: true, id: row?.id || null });
  } catch (e) {
    // The detail goes to the log; a raw SDK error can name entities or ids.
    console.error('recordAuditEvent failed', (e as Error)?.message);
    return Response.json({ ok: false, code: 'INTERNAL', error: 'INTERNAL' }, { status: 500 });
  }
}));

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
