import { DENIAL_REASON_CODES } from './policy.js';

const DANGER_ZONE_OPERATIONS = {
  DELETE_TENANT: 'DELETE_TENANT',
  SUSPEND_TENANT: 'SUSPEND_TENANT',
  RESET_TENANT_DATA: 'RESET_TENANT_DATA',
  TRANSFER_TENANT_OWNERSHIP: 'TRANSFER_TENANT_OWNERSHIP',
};

const HIGH_RISK_OPERATIONS = new Set(Object.values(DANGER_ZONE_OPERATIONS));

const ROLLBACK_SUPPORT = {
  [DANGER_ZONE_OPERATIONS.DELETE_TENANT]: 'NO_ROLLBACK_UNLESS_SNAPSHOT',
  [DANGER_ZONE_OPERATIONS.SUSPEND_TENANT]: 'SUSPEND_UNSUSPEND',
  [DANGER_ZONE_OPERATIONS.RESET_TENANT_DATA]: 'NO_ROLLBACK_UNLESS_SNAPSHOT',
  [DANGER_ZONE_OPERATIONS.TRANSFER_TENANT_OWNERSHIP]: 'TRANSFER_REVERSAL_FLOW',
};

export function isHighRiskOperation(operation) {
  return HIGH_RISK_OPERATIONS.has(operation);
}

export function getRollbackPolicy(operation) {
  return ROLLBACK_SUPPORT[operation] || 'NO_ROLLBACK_UNLESS_SNAPSHOT';
}

export function buildDangerZoneAuditEvent({ operation, requestedBy, approvedBy, reason, before, after, outcome }) {
  return {
    operation,
    requested_by: requestedBy || null,
    approved_by: approvedBy || null,
    reason: reason || null,
    before_state: before || null,
    after_state: after || null,
    timestamp: new Date().toISOString(),
    outcome: outcome || 'UNKNOWN',
  };
}

export function evaluateDangerZoneRequest({
  operation,
  actorProfile,
  requesterProfileId,
  approverProfileId,
  targetTenantId,
  actorTenantId,
  reason,
  approvalReason,
  appOwnerProfileId,
  hasSecondAdminApproval,
}) {
  if (!operation || !actorProfile || !targetTenantId || !actorTenantId) return { allowed: false, reason: DENIAL_REASON_CODES.MISSING_CONTEXT, reason_code: DENIAL_REASON_CODES.MISSING_CONTEXT };
  if (!isHighRiskOperation(operation)) return { allowed: false, reason: DENIAL_REASON_CODES.DEFAULT_DENY, reason_code: DENIAL_REASON_CODES.DEFAULT_DENY };
  if (actorProfile.app_role !== 'ADMIN') return { allowed: false, reason: DENIAL_REASON_CODES.ADMIN_ONLY, reason_code: DENIAL_REASON_CODES.ADMIN_ONLY };
  if (targetTenantId !== actorTenantId) return { allowed: false, reason: DENIAL_REASON_CODES.CROSS_TENANT_DENIED, reason_code: DENIAL_REASON_CODES.CROSS_TENANT_DENIED };
  if (!reason?.trim() || !approvalReason?.trim()) return { allowed: false, reason: DENIAL_REASON_CODES.REASON_REQUIRED, reason_code: DENIAL_REASON_CODES.REASON_REQUIRED };

  const appOwnerExempt = appOwnerProfileId && requesterProfileId === appOwnerProfileId;
  if (!appOwnerExempt) {
    if (!hasSecondAdminApproval) return { allowed: false, reason: DENIAL_REASON_CODES.SECOND_ADMIN_REQUIRED, reason_code: DENIAL_REASON_CODES.SECOND_ADMIN_REQUIRED };
    if (!approverProfileId) return { allowed: false, reason: DENIAL_REASON_CODES.SECOND_ADMIN_REQUIRED, reason_code: DENIAL_REASON_CODES.SECOND_ADMIN_REQUIRED };
    if (requesterProfileId === approverProfileId) return { allowed: false, reason: DENIAL_REASON_CODES.SELF_APPROVAL_DENIED, reason_code: DENIAL_REASON_CODES.SELF_APPROVAL_DENIED };
  }

  return { allowed: true, reason: 'approved' };
}

export { DANGER_ZONE_OPERATIONS };
