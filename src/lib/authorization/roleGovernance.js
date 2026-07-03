// Maker-checker governance rules for UserProfile.app_role changes.
//
// SECURITY NOTE: These are pure, framework-agnostic predicates. The
// AUTHORITATIVE enforcement lives server-side in
// base44/functions/governRoleChange/entry.ts, which mirrors the same rules and
// runs with the service role. The client uses this module only for pre-submit
// UX (disabling buttons, showing messages). Never treat a client-side pass as
// authorization — the raw Base44 SDK is reachable outside this UI.
//
// Findings addressed (see docs/security-role-governance-remediation.md):
//   C1 — an admin (or, via the RLS self-branch, ANY user) could self-elevate to
//        ADMIN with a direct UserProfile.update, bypassing maker-checker.
//   C2 — a requester could approve their own PendingChange because the
//        approver != requester rule was enforced only in the client.

export const APP_ROLES = ['ADMIN', 'TEACHER', 'PARENT'];

export const ROLE_CHANGE_STATUS = {
  PENDING_ADMIN_APPROVAL: 'PENDING_ADMIN_APPROVAL',
  PENDING_SECOND_ADMIN_APPROVAL: 'PENDING_SECOND_ADMIN_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};

export const OPEN_STATUSES = [
  ROLE_CHANGE_STATUS.PENDING_ADMIN_APPROVAL,
  ROLE_CHANGE_STATUS.PENDING_SECOND_ADMIN_APPROVAL,
];

// A change that touches the ADMIN tier (grant or revoke) is high risk and needs
// a second admin's approval.
export function isHighRiskRoleChange(fromRole, toRole) {
  return fromRole === 'ADMIN' || toRole === 'ADMIN';
}

export function initialRequestStatus(fromRole, toRole) {
  return isHighRiskRoleChange(fromRole, toRole)
    ? ROLE_CHANGE_STATUS.PENDING_SECOND_ADMIN_APPROVAL
    : ROLE_CHANGE_STATUS.PENDING_ADMIN_APPROVAL;
}

// Is there another ACTIVE admin in the school, besides the actor and the target,
// who could keep managing permissions if the target loses ADMIN? Mirrors
// adminSafety.hasOtherActiveAdminWithManagePermissions so both the request and
// the approval step apply the same last-admin guard.
export function hasOtherActiveAdmin({ profiles = [], actorProfileId, targetProfileId }) {
  return profiles.some((profile) => (
    profile.id !== actorProfileId &&
    profile.id !== targetProfileId &&
    profile.app_role === 'ADMIN' &&
    profile.status === 'ACTIVE'
  ));
}

function fail(code, message) {
  return { ok: false, code, message };
}

const OK = { ok: true, code: null, message: null };

// Validate a request to change target's role. Does NOT apply anything.
export function validateRoleChangeRequest({ requesterProfile, targetProfile, toRole, profiles = [] }) {
  if (!requesterProfile || requesterProfile.app_role !== 'ADMIN') {
    return fail('NOT_ADMIN', 'Solo un administrador puede solicitar cambios de rol.');
  }
  if (!targetProfile) {
    return fail('TARGET_NOT_FOUND', 'No se encontró el perfil objetivo.');
  }
  if (targetProfile.school_id !== requesterProfile.school_id) {
    return fail('CROSS_TENANT', 'No puedes cambiar el rol de un usuario de otra escuela.');
  }
  if (!APP_ROLES.includes(toRole)) {
    return fail('INVALID_ROLE', 'Rol destino inválido.');
  }
  if (targetProfile.app_role === toRole) {
    return fail('NO_CHANGE', 'Selecciona un rol distinto al actual.');
  }
  // Demoting an admin out of ADMIN must leave another active admin standing.
  const isAdminDemotion = targetProfile.app_role === 'ADMIN' && toRole !== 'ADMIN';
  if (isAdminDemotion && !hasOtherActiveAdmin({
    profiles,
    actorProfileId: requesterProfile.id,
    targetProfileId: targetProfile.id,
  })) {
    return fail('LAST_ADMIN', 'Debe existir otro ADMIN activo antes de este cambio.');
  }
  return OK;
}

// Validate a decision (approve/reject) on an open PendingChange. This is where
// C2 is closed: the approver must not be the requester.
export function validateRoleChangeDecision({ change, approverProfile, targetProfile, profiles = [], decision }) {
  if (!approverProfile || approverProfile.app_role !== 'ADMIN') {
    return fail('NOT_ADMIN', 'Solo un administrador puede resolver una solicitud.');
  }
  if (!change) {
    return fail('CHANGE_NOT_FOUND', 'No se encontró la solicitud.');
  }
  if (decision !== 'approve' && decision !== 'reject') {
    return fail('INVALID_DECISION', 'Decisión inválida.');
  }
  if (!OPEN_STATUSES.includes(change.status)) {
    return fail('NOT_OPEN', 'La solicitud ya fue resuelta.');
  }
  if (change.school_id !== approverProfile.school_id) {
    return fail('CROSS_TENANT', 'No puedes resolver una solicitud de otra escuela.');
  }
  // C2: approver != requester — checked on BOTH the profile id and the user id
  // so neither identity axis can be spoofed independently.
  if (
    change.requester_profile_id === approverProfile.id ||
    (change.requester_user_id && change.requester_user_id === approverProfile.user_id)
  ) {
    return fail('SELF_APPROVAL', 'El aprobador no puede ser el mismo solicitante.');
  }
  if (decision === 'approve') {
    const toRole = change.payload?.to_role;
    if (!APP_ROLES.includes(toRole)) {
      return fail('INVALID_ROLE', 'La solicitud tiene un rol destino inválido.');
    }
    const isAdminDemotion = targetProfile?.app_role === 'ADMIN' && toRole !== 'ADMIN';
    if (isAdminDemotion && !hasOtherActiveAdmin({
      profiles,
      actorProfileId: approverProfile.id,
      targetProfileId: targetProfile?.id,
    })) {
      return fail('LAST_ADMIN', 'Debe existir otro ADMIN activo antes de aprobar este cambio.');
    }
  }
  return OK;
}
