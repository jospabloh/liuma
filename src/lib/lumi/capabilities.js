import { canReadEntity } from '../authorization/policy.js';

export const CAPABILITY_ACTIONS = {
  VIEW: 'view',
  ADD: 'add',
  EDIT: 'edit',
  DELETE: 'delete',
  APPROVE: 'approve',
  EXPORT: 'export',
  MANAGE_PERMISSIONS: 'manage_permissions',
};

export const LUMI_INTENTS = {
  HOMEWORK_LOOKUP: 'homework_lookup',
  ATTENDANCE_STATUS: 'attendance_status',
  NOTICES_SUMMARY: 'notices_summary',
  PAYMENT_REMINDERS: 'payment_reminders',
  BEHAVIOR_RECAP: 'behavior_recap',
  SCHEDULE_APPOINTMENTS: 'schedule_appointments',
  SUPPORT_REQUEST: 'support_request',
};

export const CAPABILITY_RULES = {
  [LUMI_INTENTS.HOMEWORK_LOOKUP]: { entity: 'Homework', allowed_roles: ['ADMIN','TEACHER','PARENT'], required_entity_filters: ['school_id'], safe_denial_response: 'No tengo permiso para consultar tareas con este perfil.' },
  [LUMI_INTENTS.ATTENDANCE_STATUS]: { entity: 'Attendance', allowed_roles: ['ADMIN','TEACHER','PARENT'], required_entity_filters: ['school_id'], safe_denial_response: 'No puedo compartir resumen de asistencia con este acceso.' },
  [LUMI_INTENTS.NOTICES_SUMMARY]: { entity: 'Notice', allowed_roles: ['ADMIN','TEACHER','PARENT'], required_entity_filters: ['school_id'], safe_denial_response: 'No puedo resumir avisos para este perfil.' },
  [LUMI_INTENTS.PAYMENT_REMINDERS]: { entity: 'ChargeItem', allowed_roles: ['ADMIN','PARENT'], required_entity_filters: ['school_id'], safe_denial_response: 'No puedo dar seguimiento de pagos con este acceso.' },
  [LUMI_INTENTS.BEHAVIOR_RECAP]: { entity: 'DiaryEntry', allowed_roles: ['ADMIN','TEACHER','PARENT'], required_entity_filters: ['school_id'], safe_denial_response: 'No puedo compartir reportes de conducta con este acceso.' },
  [LUMI_INTENTS.SCHEDULE_APPOINTMENTS]: { entity: 'Notice', allowed_roles: ['ADMIN','TEACHER','PARENT'], required_entity_filters: ['school_id'], safe_denial_response: 'No puedo revisar anuncios o eventos con este acceso.' },
  [LUMI_INTENTS.SUPPORT_REQUEST]: { entity: 'SupportTicket', allowed_roles: ['ADMIN','TEACHER','PARENT'], required_entity_filters: ['school_id'], safe_denial_response: 'No puedo abrir una solicitud de soporte con este acceso.' },
};

function toLinkedStudentIds(userProfile) {
  const linked = userProfile?.linked_students;
  if (!Array.isArray(linked)) return [];

  return linked
    .map((student) => student?.id || student?.student_id)
    .filter(Boolean);
}

export function buildLumiContext(userProfile = {}) {
  return {
    user_role: userProfile?.app_role || 'PARENT',
    school_id: userProfile?.school_id || null,
    linked_students: toLinkedStudentIds(userProfile),
  };
}

export function buildCapabilityRequest({ intent, prompt, inputs = {}, userProfile = {} }) {
  const context = buildLumiContext(userProfile);

  return {
    intent,
    prompt,
    inputs,
    context,
    metadata: {
      user_role: context.user_role,
      school_id: context.school_id,
      linked_students: context.linked_students,
      requested_at: new Date().toISOString(),
    },
  };
}

export function evaluateCapabilityAccess({ intent, request }) {
  const role = request?.context?.user_role;
  const schoolId = request?.context?.school_id;
  const rule = CAPABILITY_RULES[intent];
  const entity = rule?.entity;

  if (!intent) return { allowed: true };


  if (!role || !rule || !entity || !canReadEntity(role, entity) || !rule.allowed_roles.includes(role)) {
    return {
      allowed: false,
      denial: {
        reason_code: 'policy_forbidden',
        reason: `Role ${role || 'UNKNOWN'} cannot access capability ${intent}`,
        safe_message: rule?.safe_denial_response || 'No tengo permiso para completar esta solicitud.',
      },
    };
  }

  const linkedStudents = request?.context?.linked_students || [];
  if (!schoolId) {
    return {
      allowed: false,
      denial: {
        reason_code: 'missing_scope',
        reason: 'Missing tenant scope for capability request',
        safe_message: rule.safe_denial_response,
      },
    };
  }
  const studentId = request?.inputs?.student_id;

  if (role === 'PARENT' && studentId && !linkedStudents.includes(studentId)) {
    return {
      allowed: false,
      denial: {
        reason_code: 'student_scope_mismatch',
        reason: 'Requested student is not linked to this account',
        safe_message: rule.safe_denial_response,
      },
    };
  }

  return {
    allowed: true,
    rule,
  };
}

export function buildDeniedCapabilityResponse({ intent, denial }) {
  return {
    status: 'denied',
    intent,
    message: denial.safe_message || `No pude completar la solicitud: ${denial.reason}`,
    safe_alternative: 'Puedo ayudarte con una consulta permitida, por ejemplo tareas, avisos o asistencia dentro de tu perfil.',
    data: {},
    meta: {
      capability: intent,
      requested_at: new Date().toISOString(),
      sources: [],
      missing_inputs: [],
    },
    denial,
  };
}
