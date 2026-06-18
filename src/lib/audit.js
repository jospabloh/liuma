import { base44 } from '@/api/base44Client';

export const AUDIT_ENTITIES = {
  ATTENDANCE: 'Attendance',
  PAYMENT_RECORD: 'PaymentRecord',
  CHARGE_ITEM: 'ChargeItem',
  USER_PROFILE: 'UserProfile',
  NOTICE: 'Notice',
  DIARY_ENTRY: 'DiaryEntry',
  AI_INTERACTION: 'AiInteraction',
  PERMISSION_CHANGE: 'PermissionChange',
  SUPPORT_TICKET: 'SupportTicket',
};

export const AUDIT_ACTIONS = {
  POLICY_DECISION: 'POLICY_DECISION',
  PERMISSION_CHANGE: 'PERMISSION_CHANGE',
  OWNER_OVERRIDE: 'owner_override',
  ACCESS_DENIED: 'access_denied',
};

export function buildPermissionChangeContext({
  changeType,
  before,
  after,
  actorProfileId,
  reviewerProfileId,
  reason,
  snapshot,
}) {
  return {
    change_type: changeType,
    before,
    after,
    diff: { before, after },
    actor_profile_id: actorProfileId || null,
    reviewer_profile_id: reviewerProfileId || null,
    reason: reason || null,
    changed_at: new Date().toISOString(),
    reviewed_at: reviewerProfileId ? new Date().toISOString() : null,
    snapshot: snapshot || { before, after },
  };
}

export function canReadPermissionChangeAudit({ row, user, userProfile }) {
  if (!row || !user || !userProfile) return false;
  if (row.entity !== AUDIT_ENTITIES.PERMISSION_CHANGE && row.action !== AUDIT_ACTIONS.PERMISSION_CHANGE) {
    return false;
  }

  const isTenantSuperAdmin = userProfile.app_role === 'ADMIN';
  if (!isTenantSuperAdmin) return false;

  const isCreatorAdmin = row.context?.actor_profile_id === userProfile.id;
  const canViewAllTenantPermissionChanges = Boolean(userProfile.can_view_all_tenant_permission_changes);

  return isCreatorAdmin || canViewAllTenantPermissionChanges;
}

export async function logAuditEvent({
  user,
  userProfile,
  entity,
  entityId,
  action,
  reason,
  context,
}) {
  if (!user || !userProfile || !entity || !entityId || !action) return;

  await base44.entities.AuditLog.create({
    school_id: userProfile.school_id,
    actor: user.id,
    role: userProfile.app_role,
    entity,
    entity_id: entityId,
    action,
    timestamp: new Date().toISOString(),
    reason,
    context,
    user_id: user.id,
    user_email: user.email,
    target_type: entity,
    target_id: entityId,
    details: context,
  });
}

export async function logAccessDeniedEvent({
  user,
  userProfile,
  route,
  reason,
  tenantId,
  context = {},
}) {
  const payload = {
    event: AUDIT_ACTIONS.ACCESS_DENIED,
    actor: user?.id || 'anonymous',
    actor_email: user?.email || null,
    route: route || null,
    reason: reason || 'unknown_denial',
    tenant_id: tenantId || userProfile?.school_id || null,
    ...context,
  };

  if (import.meta.env.DEV) {
    console.warn('access_denied', { event: payload.event, route: payload.route, reason: payload.reason });
  }

  if (!user || !userProfile || !route) return;

  return logAuditEvent({
    user,
    userProfile,
    entity: 'Route',
    entityId: route,
    action: AUDIT_ACTIONS.ACCESS_DENIED,
    reason: payload.reason,
    context: payload,
  });
}

export async function logPolicyDecision({
  user,
  userProfile,
  entity,
  action,
  decision,
  reason,
  context = {},
}) {
  if (!user || !userProfile || !entity || !action) return;

  return logAuditEvent({
    user,
    userProfile,
    entity,
    entityId: `${entity}:${action}`,
    action: AUDIT_ACTIONS.POLICY_DECISION,
    reason: reason || `policy_${decision || 'unknown'}`,
    context: {
      ...context,
      policy_entity: entity,
      policy_action: action,
      policy_decision: decision,
    },
  });
}

export function maskAuditContext(context = {}) {
  const piiKeys = ['email', 'phone', 'reference', 'notes_text', 'teacher_message'];
  return Object.entries(context).reduce((acc, [key, value]) => {
    if (piiKeys.includes(key)) {
      acc[key] = '[REDACTED]';
      return acc;
    }

    acc[key] = value;
    return acc;
  }, {});
}
