import { base44 } from '@/api/base44Client';

export const AUDIT_ENTITIES = {
  ATTENDANCE: 'Attendance',
  PAYMENT_RECORD: 'PaymentRecord',
  CHARGE_ITEM: 'ChargeItem',
  USER_PROFILE: 'UserProfile',
  NOTICE: 'Notice',
  DIARY_ENTRY: 'DiaryEntry',
  AI_INTERACTION: 'AiInteraction',
};

export const AUDIT_ACTIONS = {
  POLICY_DECISION: 'POLICY_DECISION',
};

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
