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
  if (!operation || !actorProfile || !targetTenantId || !actorTenantId) return { allowed: false, reason: 'missing_context' };
  if (!isHighRiskOperation(operation)) return { allowed: false, reason: 'default_deny' };
  if (actorProfile.app_role !== 'ADMIN') return { allowed: false, reason: 'admin_only' };
  if (targetTenantId !== actorTenantId) return { allowed: false, reason: 'cross_tenant_denied' };
  if (!reason?.trim() || !approvalReason?.trim()) return { allowed: false, reason: 'reason_required' };

  const appOwnerExempt = appOwnerProfileId && requesterProfileId === appOwnerProfileId;
  if (!appOwnerExempt) {
    if (!hasSecondAdminApproval) return { allowed: false, reason: 'second_admin_required' };
    if (!approverProfileId) return { allowed: false, reason: 'second_admin_required' };
    if (requesterProfileId === approverProfileId) return { allowed: false, reason: 'self_approval_denied' };
  }

  return { allowed: true, reason: 'approved' };
}

export { DANGER_ZONE_OPERATIONS };
