// Lumi capability gate — UX ONLY, NOT A SECURITY BOUNDARY.
//
// Everything here runs in the browser and every input to it (role, school,
// linked students) comes from the client, so anyone with devtools can forge
// the envelope or skip the gate entirely. Its only jobs are:
//   - keep the quick-action / follow-up chips from offering a role something
//     Lumi is going to refuse anyway, with a friendly Spanish explanation;
//   - hand the agent non-authoritative hints (role, local date, time zone).
// Free-text messages carry no intent and are always "allowed" here on
// purpose: the gate never sees them. What actually limits what Lumi can read
// or write is the backend — entity RLS for the tools the agent calls, and any
// server-side function tools that re-derive the caller's school and role from
// their own UserProfile. Never add a check here and call it enforcement;
// never trust `context.user_role` / `context.school_id` on the server.
//
// `linked_students` is read from `userProfile.linked_students`, which the
// deployed UserProfile schema does not have, so it is always [] in practice
// and the student_scope_mismatch branch is dormant UX, not protection.

import { canReadEntity } from '../authorization/policy.js';
import { formatLocalDate } from '../dates.js';

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

/**
 * The viewer's own clock, so "hoy" / "mañana" resolve to the school's day.
 * `requested_at` is UTC: after 18:00 in Mexico (UTC-6) its date is already
 * tomorrow, and the agent was answering "¿qué tarea hay hoy?" with tomorrow's.
 */
export function buildLocalTimeContext(now = new Date()) {
  let timezone = null;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    timezone = null;
  }
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return {
    local_date: formatLocalDate(now),
    local_time: `${hh}:${mm}`,
    timezone,
    utc_offset_minutes: -now.getTimezoneOffset(),
  };
}

export function buildCapabilityRequest({ intent, prompt, inputs = {}, userProfile = {}, now = new Date() }) {
  const context = { ...buildLumiContext(userProfile), ...buildLocalTimeContext(now) };

  return {
    intent,
    prompt,
    inputs,
    context,
    metadata: {
      user_role: context.user_role,
      school_id: context.school_id,
      linked_students: context.linked_students,
      local_date: context.local_date,
      timezone: context.timezone,
      requested_at: now.toISOString(),
    },
  };
}

export function evaluateCapabilityAccess({ intent, request }) {
  const role = request?.context?.user_role;
  const schoolId = request?.context?.school_id;
  const rule = CAPABILITY_RULES[intent];
  const entity = rule?.entity;

  // Free text has no intent and is not gated here (see the header): only the
  // chips carry an intent, and this only decides whether to offer them.
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
