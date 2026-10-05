// governRoleChange — server-authoritative maker-checker for UserProfile.app_role.
//
// WHY THIS EXISTS
// LIUMA's role-change approval flow (request -> second-admin approval -> apply)
// was enforced only in the PermisosRoles.jsx UI. Because UserProfile.update and
// PendingChange.update RLS grant any admin (and, via the self-branch, any user)
// row access, the maker-checker was bypassable with a direct SDK call:
//   C1 — self-/cross-elevate to ADMIN via UserProfile.update({app_role:'ADMIN'})
//   C2 — approve your own PendingChange (approver == requester)
// This function is the ONLY sanctioned path for role mutations. It runs with the
// caller's token to establish identity (base44.auth.me), re-reads state with the
// service role (authoritative, never client input), enforces the rules below,
// and applies the mutation with the service role.
//
// The predicates here MIRROR src/lib/authorization/roleGovernance.js. The client
// copy is UX only; this copy is the trust boundary — keep them in sync.
//
// Fully closing the raw-SDK bypass additionally requires per-field RLS locking
// UserProfile.app_role (and PendingChange status/approver fields) to the service
// role, plus routing onboarding's initial role write through a service-role
// function. That schema change is staged for owner review/deploy — see
// docs/security-role-governance-remediation.md.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';
import { withDeletionGuard } from './_deletionGuard.ts';
import { readAllPages } from './_pages.ts';

const APP_ROLES = ['ADMIN', 'TEACHER', 'PARENT'];
const OPEN_STATUSES = ['PENDING_ADMIN_APPROVAL', 'PENDING_SECOND_ADMIN_APPROVAL'];

type Profile = {
  id: string;
  user_id?: string;
  school_id?: string;
  app_role?: string;
  status?: string;
  consent_notice_version?: string;
  consent_terms_version?: string;
};

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

type PendingChange = {
  id: string;
  school_id?: string;
  type?: string;
  status?: string;
  requester_profile_id?: string;
  requester_user_id?: string;
  target_profile_id?: string;
  payload?: { from_role?: string; to_role?: string; risk_level?: string };
};

function isHighRiskRoleChange(fromRole?: string, toRole?: string): boolean {
  return fromRole === 'ADMIN' || toRole === 'ADMIN';
}

function initialRequestStatus(fromRole?: string, toRole?: string): string {
  return isHighRiskRoleChange(fromRole, toRole)
    ? 'PENDING_SECOND_ADMIN_APPROVAL'
    : 'PENDING_ADMIN_APPROVAL';
}

function hasOtherActiveAdmin(profiles: Profile[], actorProfileId?: string, targetProfileId?: string): boolean {
  return profiles.some((p) =>
    p.id !== actorProfileId &&
    p.id !== targetProfileId &&
    p.app_role === 'ADMIN' &&
    p.status === 'ACTIVE');
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
    const action = body?.action;
    if (action !== 'request' && action !== 'decide') {
      return bad(400, 'BAD_ACTION', 'action must be "request" or "decide"');
    }

    // Every write checked against a concurrent deletion (./_deletionGuard.ts).
    const sr = guarded(base44.asServiceRole, String(user.id));

    // Establish the caller's authority from the backend, not from the request.
    // The caller must hold an ACTIVE ADMIN profile; that profile's school is the
    // only tenant this call may act on.
    //
    // Módulo 18: sorted by -created_date before picking (same fix, same
    // reasoning, as exportSchoolData's twin comment) — an admin of more than
    // one school used to get Base44 filter()'s unspecified order here, which
    // could silently act on the wrong school (module 14 finding, 2026-08-23).
    const callerProfiles: Profile[] = await sr.entities.UserProfile.filter({ user_id: user.id }, '-created_date');
    const callerProfile = callerProfiles.find((p) => p.app_role === 'ADMIN' && p.status === 'ACTIVE') || null;
    if (!callerProfile) return bad(403, 'NOT_ADMIN', 'Requires an active ADMIN profile');
    if (!profileConsentIsCurrent(callerProfile)) return bad(403, 'CONSENT_REQUIRED', 'Accept the current privacy notice first');
    const schoolId = callerProfile.school_id;

    // Every profile of the school, paged (./_pages.ts): the target lookup and
    // the "another ACTIVE ADMIN exists" check must see all of them, not the
    // SDK's default first page (Codex review of PR #197, round 10).
    const profilesRead = await readAllPages(sr.entities.UserProfile, { school_id: schoolId });
    if (!profilesRead.complete) return bad(503, 'RECIPIENTS_INCOMPLETE', 'Too many profiles to read at once');
    const schoolProfiles = profilesRead.rows as Profile[];

    if (action === 'request') {
      const targetProfileId = String(body?.targetProfileId || '');
      const toRole = String(body?.toRole || '');
      const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
      if (!targetProfileId || !toRole) return bad(400, 'MISSING_PARAMS', 'targetProfileId and toRole required');
      if (!reason) return bad(400, 'REASON_REQUIRED', 'A reason is required for any change');

      const target = schoolProfiles.find((p) => p.id === targetProfileId) || null;
      if (!target) return bad(404, 'TARGET_NOT_FOUND', 'Target profile not found in your school');
      if (!APP_ROLES.includes(toRole)) return bad(400, 'INVALID_ROLE', 'Invalid destination role');
      if (target.app_role === toRole) return bad(400, 'NO_CHANGE', 'Target already has that role');

      const isAdminDemotion = target.app_role === 'ADMIN' && toRole !== 'ADMIN';
      if (isAdminDemotion && !hasOtherActiveAdmin(schoolProfiles, callerProfile.id, target.id)) {
        return bad(409, 'LAST_ADMIN', 'Another active ADMIN must exist before this change');
      }

      // Reject duplicate open requests for the same target.
      const existing: PendingChange[] = await sr.entities.PendingChange.filter({
        school_id: schoolId,
        target_profile_id: targetProfileId,
        type: 'ROLE_CHANGE',
      });
      if (existing.some((c) => OPEN_STATUSES.includes(String(c.status)))) {
        return bad(409, 'OPEN_REQUEST_EXISTS', 'An open request already exists for this user');
      }

      const change = await sr.entities.PendingChange.create({
        school_id: schoolId,
        type: 'ROLE_CHANGE',
        status: initialRequestStatus(target.app_role, toRole),
        requester_profile_id: callerProfile.id,
        requester_user_id: user.id,
        target_profile_id: targetProfileId,
        payload: {
          from_role: target.app_role,
          to_role: toRole,
          risk_level: isHighRiskRoleChange(target.app_role, toRole) ? 'HIGH' : 'NORMAL',
          reason,
        },
      });
      return Response.json({ ok: true, change });
    }

    // action === 'decide'
    const changeId = String(body?.changeId || '');
    const decision = body?.decision;
    if (!changeId) return bad(400, 'MISSING_PARAMS', 'changeId required');
    if (decision !== 'approve' && decision !== 'reject') {
      return bad(400, 'INVALID_DECISION', 'decision must be "approve" or "reject"');
    }

    const change: PendingChange | null = await sr.entities.PendingChange.get(changeId).catch(() => null);
    if (!change) return bad(404, 'CHANGE_NOT_FOUND', 'Pending change not found');
    if (change.school_id !== schoolId) return bad(403, 'CROSS_TENANT', 'Change belongs to another school');
    // Only role changes are decided here. A PERMISSION_ROLLBACK request
    // (guardedEntityWrite, P10b) shares the entity; approving one through this
    // path would apply a role change nobody asked for.
    if (change.type && change.type !== 'ROLE_CHANGE') return bad(409, 'NOT_A_ROLE_CHANGE', 'This request is not a role change');
    if (!OPEN_STATUSES.includes(String(change.status))) {
      return bad(409, 'NOT_OPEN', 'This request was already resolved');
    }

    // C2: the approver must not be the requester — check both identity axes.
    if (
      change.requester_profile_id === callerProfile.id ||
      (change.requester_user_id && change.requester_user_id === user.id)
    ) {
      return bad(403, 'SELF_APPROVAL', 'The approver cannot be the requester');
    }

    const target = schoolProfiles.find((p) => p.id === change.target_profile_id) || null;
    const toRole = change.payload?.to_role;

    if (decision === 'approve') {
      if (!target) return bad(404, 'TARGET_NOT_FOUND', 'Target profile no longer exists');
      if (!APP_ROLES.includes(String(toRole))) return bad(400, 'INVALID_ROLE', 'Request has an invalid destination role');
      const isAdminDemotion = target.app_role === 'ADMIN' && toRole !== 'ADMIN';
      if (isAdminDemotion && !hasOtherActiveAdmin(schoolProfiles, callerProfile.id, target.id)) {
        return bad(409, 'LAST_ADMIN', 'Another active ADMIN must exist before approving this change');
      }
    }

    const resolvedStatus = decision === 'approve' ? 'APPROVED' : 'REJECTED';
    const updatedChange = await sr.entities.PendingChange.update(changeId, {
      status: resolvedStatus,
      approver_profile_id: callerProfile.id,
      approver_user_id: user.id,
      approved_at: new Date().toISOString(),
    });

    let appliedProfile: Profile | null = null;
    if (decision === 'approve') {
      // `target` was resolved from change.target_profile_id and is non-null on
      // this path (checked above), so this is the same id, typed as a string.
      appliedProfile = await sr.entities.UserProfile.update(String(change.target_profile_id), { app_role: toRole });
    }

    return Response.json({ ok: true, change: updatedChange, applied: appliedProfile });
  } catch (e) {
    // The detail goes to the log; a raw SDK error can name entities or ids.
    console.error('governRoleChange failed', (e as Error)?.message);
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
