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

const APP_ROLES = ['ADMIN', 'TEACHER', 'PARENT'];
const OPEN_STATUSES = ['PENDING_ADMIN_APPROVAL', 'PENDING_SECOND_ADMIN_APPROVAL'];

type Profile = {
  id: string;
  user_id?: string;
  school_id?: string;
  app_role?: string;
  status?: string;
};

type PendingChange = {
  id: string;
  school_id?: string;
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me().catch(() => null);
    if (!user) return bad(401, 'UNAUTHENTICATED', 'Unauthorized');

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    if (action !== 'request' && action !== 'decide') {
      return bad(400, 'BAD_ACTION', 'action must be "request" or "decide"');
    }

    const sr = base44.asServiceRole;

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
    const schoolId = callerProfile.school_id;

    const schoolProfiles: Profile[] = await sr.entities.UserProfile.filter({ school_id: schoolId });

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
      appliedProfile = await sr.entities.UserProfile.update(change.target_profile_id, { app_role: toRole });
    }

    return Response.json({ ok: true, change: updatedChange, applied: appliedProfile });
  } catch (e) {
    return Response.json({ ok: false, code: 'INTERNAL', error: (e as Error).message }, { status: 500 });
  }
});
