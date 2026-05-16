import { canReadEntity } from '@/lib/authorization/policy';

export const LUMI_INTENTS = {
  HOMEWORK_LOOKUP: 'homework_lookup',
  ATTENDANCE_STATUS: 'attendance_status',
  NOTICES_SUMMARY: 'notices_summary',
  PAYMENT_REMINDERS: 'payment_reminders',
  BEHAVIOR_RECAP: 'behavior_recap',
  SCHEDULE_APPOINTMENTS: 'schedule_appointments',
};

const INTENT_ENTITY = {
  [LUMI_INTENTS.HOMEWORK_LOOKUP]: 'Homework',
  [LUMI_INTENTS.ATTENDANCE_STATUS]: 'Attendance',
  [LUMI_INTENTS.NOTICES_SUMMARY]: 'Notice',
  [LUMI_INTENTS.PAYMENT_REMINDERS]: 'ChargeItem',
  [LUMI_INTENTS.BEHAVIOR_RECAP]: 'DiaryEntry',
  [LUMI_INTENTS.SCHEDULE_APPOINTMENTS]: 'Notice',
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
  const entity = INTENT_ENTITY[intent];

  if (!intent) return { allowed: true };

  if (!role || !entity || !canReadEntity(role, entity)) {
    return {
      allowed: false,
      denial: {
        reason_code: 'policy_forbidden',
        reason: `Role ${role || 'UNKNOWN'} cannot access capability ${intent}`,
      },
    };
  }

  const linkedStudents = request?.context?.linked_students || [];
  const studentId = request?.inputs?.student_id;

  if (role === 'PARENT' && studentId && !linkedStudents.includes(studentId)) {
    return {
      allowed: false,
      denial: {
        reason_code: 'student_scope_mismatch',
        reason: 'Requested student is not linked to this account',
      },
    };
  }

  return { allowed: true };
}

export function buildDeniedCapabilityResponse({ intent, denial }) {
  return {
    status: 'denied',
    intent,
    message: `No pude completar la solicitud: ${denial.reason}`,
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
