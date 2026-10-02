// approveProfile — the one sanctioned way to approve or reject a PENDING
// UserProfile (Aprobaciones.jsx).
//
// WHY THIS EXISTS (sales-readiness audit, package P8, 2026-09-29).
// Aprobaciones used to call `UserProfile.update(profileId, { status })`
// straight from the browser. Nothing on that path checked that the approver
// was an ADMIN of the TARGET's school: the page filtered its own list by the
// caller's school, but the write itself took any profile id. And under the
// deployed RLS a school ADMIN can't update someone else's profile at all
// (UserProfile update is own-row OR platform owner), so the button simply
// failed for the people it exists for.
//
// Authority model, in order:
//   1. Caller must be authenticated.
//   2. The target profile is re-read with the service role; its school comes
//      from the STORED row, never from the request.
//   3. The caller must hold an ACTIVE ADMIN profile in that same school
//      (platform owner — user.role === 'admin' — bypasses, same convention
//      as every other function here).
//   4. The target must currently be PENDING. This is an approval queue, not
//      a general status editor: reactivating a SUSPENDED user or suspending
//      an ACTIVE one is a different decision and does not go through here.
//   5. The role the user ends up with is the APPROVING ADMIN's choice
//      (`body.role`, allowlist ADMIN/TEACHER/PARENT), never what the
//      applicant picked in onboarding: the stored role is only the
//      applicant's request, and the audit row keeps both. Omitted `role`
//      keeps the requested one. Handing out ADMIN still needs a second
//      director (governRoleChange), so one director cannot pick it here.
//   6. Nobody approves their own profile, even an ADMIN of the school with a
//      second, pending profile — self-activation is exactly what an approval
//      step exists to prevent.
// The write and its AuditLog row both happen with the service role.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';
import { withDeletionGuard } from './_deletionGuard.ts';

const DECISIONS: Record<string, { status: string; action: string }> = {
  approve: { status: 'ACTIVE', action: 'USER_APPROVED' },
  reject: { status: 'SUSPENDED', action: 'USER_SUSPENDED' },
};

const APP_ROLES = ['ADMIN', 'TEACHER', 'PARENT'];

type Profile = { id: string; user_id?: string; school_id?: string; app_role?: string; status?: string; consent_notice_version?: string; consent_terms_version?: string };
// Accepting the current Aviso de Privacidad and Términos is mandatory to use
// LIUMA (v1.9.0). MIRRORS schoolRead/_scope.ts#profileConsentIsCurrent and
// src/lib/consent/privacyNotice.js; tests/unit/consent-gate.test.js checks
// every copy of the versions.
const CONSENT_NOTICE_VERSION = '2026-10-02';
const CONSENT_TERMS_VERSION = '2026-10-02';
function profileConsentIsCurrent(profile: { consent_notice_version?: unknown; consent_terms_version?: unknown } | null): boolean {
  return Boolean(profile)
    && profile!.consent_notice_version === CONSENT_NOTICE_VERSION
    && profile!.consent_terms_version === CONSENT_TERMS_VERSION;
}


function bad(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, code, error: message }, { status });
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
    const profileId = String(body?.profileId || '');
    const decision = DECISIONS[String(body?.decision || '')];
    if (!profileId) return bad(400, 'MISSING_PROFILE', 'profileId is required');
    if (!decision) return bad(400, 'BAD_DECISION', 'decision must be "approve" or "reject"');
    const rawRole = body?.role;
    if (rawRole !== undefined && rawRole !== null && rawRole !== '' && !APP_ROLES.includes(String(rawRole))) {
      return bad(400, 'INVALID_ROLE', 'role must be ADMIN, TEACHER or PARENT');
    }

    // Every write checked against a concurrent deletion (./_deletionGuard.ts).
    const sr = guarded(base44.asServiceRole, String(user.id));
    const target: Profile | null = await sr.entities.UserProfile.get(profileId).catch(() => null);
    if (!target?.school_id) return bad(404, 'NOT_FOUND', 'Profile not found');
    if (target.status !== 'PENDING') return bad(409, 'NOT_PENDING', 'Only a PENDING profile can be approved or rejected');
    if (target.user_id === user.id) return bad(403, 'SELF_APPROVAL', 'You cannot approve or reject your own profile');

    const isPlatformOwner = user.role === 'admin';
    let callerProfile: Profile | null = null;
    if (!isPlatformOwner) {
      const callerProfiles: Profile[] = await sr.entities.UserProfile.filter(
        { user_id: user.id, school_id: target.school_id },
        '-created_date',
      );
      callerProfile = callerProfiles.find((p) => p.app_role === 'ADMIN' && p.status === 'ACTIVE') || null;
      if (!callerProfile) return bad(403, 'NOT_ADMIN', 'Requires an active ADMIN profile in the target\'s school');
      if (!profileConsentIsCurrent(callerProfile)) return bad(403, 'CONSENT_REQUIRED', 'Accept the current privacy notice first');
    }

    // Activating an ADMIN is a role grant, and role grants to ADMIN need a
    // second director (governRoleChange's maker-checker). Onboarding never
    // creates a PENDING ADMIN (provisionOnboardingProfile), so this only
    // stops a row that should not exist from being activated by one person.
    // Judged on the role the profile would END UP with (the admin's choice, or
    // the requested one when none was sent).
    const finalRole = decision.status === 'ACTIVE' && rawRole ? String(rawRole) : String(target.app_role || '');
    if (decision.status === 'ACTIVE' && !APP_ROLES.includes(finalRole)) {
      return bad(409, 'INVALID_ROLE', 'The profile has no valid role; choose one to approve it');
    }
    if (finalRole === 'ADMIN' && decision.status === 'ACTIVE' && !isPlatformOwner) {
      return bad(403, 'ADMIN_NEEDS_GOVERNANCE', 'An ADMIN profile cannot be activated through the approval queue');
    }

    // Role changes only on approval; a rejection never rewrites app_role.
    const patch: Record<string, string> = { status: decision.status };
    if (decision.status === 'ACTIVE' && finalRole && finalRole !== target.app_role) patch.app_role = finalRole;
    await sr.entities.UserProfile.update(target.id, patch);

    // Best-effort: the approval already happened; a failed audit row must not
    // turn it into an error the admin would retry.
    await sr.entities.AuditLog.create({
      school_id: target.school_id,
      user_id: user.id,
      user_email: user.email,
      action: decision.action,
      target_type: 'UserProfile',
      target_id: target.id,
      details: {
        from_status: 'PENDING',
        to_status: decision.status,
        requested_role: target.app_role,
        assigned_role: decision.status === 'ACTIVE' ? finalRole : target.app_role,
        actor_profile_id: callerProfile?.id || null,
        via: 'approveProfile',
      },
    }).catch(() => null);

    return Response.json({
      ok: true,
      profileId: target.id,
      status: decision.status,
      appRole: decision.status === 'ACTIVE' ? finalRole : target.app_role,
    });
  } catch (e) {
    return Response.json({ ok: false, code: 'INTERNAL', error: (e as Error).message }, { status: 500 });
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
