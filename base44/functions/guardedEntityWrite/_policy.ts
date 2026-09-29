// Pure decision rules for guardedEntityWrite — no Deno globals, no SDK, no
// imports, so the same file is loaded by the function (./_policy.ts) and by
// `node --test` (tests/unit/guarded-write-authorship.test.js), which exercises
// these rules for real instead of grepping the function's source.
//
// Keep POLICY_WRITE in sync by hand with src/lib/authorization/policy.js's
// POLICY (Deno functions can't import across directories).

export const POLICY_WRITE: Record<string, string[]> = {
  Notice: ['ADMIN', 'TEACHER'],
  Attendance: ['ADMIN', 'TEACHER'],
  Homework: ['ADMIN', 'TEACHER'],
  DiaryEntry: ['ADMIN', 'TEACHER'],
  ChargeItem: ['ADMIN'],
  PaymentConcept: ['ADMIN'],
  PaymentRecord: ['ADMIN'],
};

// Each of these entities' own RLS pinned this field to `{{user.id}}` before
// P7 made create/update service-role only. Every real call site sends the
// caller's own id/name here, so overriding rather than trusting the client's
// value costs no legitimate use and closes attribution spoofing (Base44
// security scan, 2026-09-28). It is also what "the author" means for the
// update rule below.
export const ATTRIBUTION_FIELDS: Record<string, { id: string; name?: string }> = {
  Attendance: { id: 'recorded_by', name: 'recorded_by_name' },
  PaymentRecord: { id: 'recorded_by' },
  DiaryEntry: { id: 'teacher_id', name: 'teacher_name' },
  Homework: { id: 'teacher_id', name: 'teacher_name' },
  Notice: { id: 'author_id', name: 'author_name' },
};

// Fields only notifyParents (service role) may write. Service-role writes
// bypass the fields' own rls.write:false, so they are stripped by hand — on
// CREATE as well as update: a teacher creating an Attendance with
// parent_notified:true, or a DiaryEntry with notified_parent_emails
// pre-filled, would otherwise silently stop the parents' email.
export const SERVER_ONLY_FIELDS: Record<string, string[]> = {
  DiaryEntry: ['parents_notified_at', 'notified_parent_emails'],
  Attendance: ['parent_notified', 'notified_at'],
};

// Client-supplied references that must point at a record of the SAME school.
// school_id itself is tied to the caller's profile, but without this a
// teacher could file a record in their own school against a classroom (or,
// for an admin, an event/concept/charge) of another school.
export const REFERENCE_ENTITIES: Record<string, string> = {
  classroom_id: 'Classroom',
  concept_id: 'PaymentConcept',
  discount_id: 'Discount',
  event_id: 'Event',
  charge_id: 'ChargeItem',
};

/** Copy of `data` without the entity's server-only fields. */
export function stripServerOnlyFields(entity: string, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(data || {}) };
  for (const field of SERVER_ONLY_FIELDS[entity] || []) delete out[field];
  return out;
}

/** [field, entityName, id] for every non-empty reference present in `data`. */
export function referencesToCheck(data: Record<string, unknown>): Array<[string, string, string]> {
  const refs: Array<[string, string, string]> = [];
  for (const [field, entityName] of Object.entries(REFERENCE_ENTITIES)) {
    const value = data?.[field];
    if (typeof value === 'string' && value) refs.push([field, entityName, value]);
  }
  return refs;
}

export type ModifyDecision = { ok: true; reason: string } | { ok: false; code: string; message: string };

/**
 * May this caller UPDATE or DELETE an existing record? Runs after the role
 * policy and PermissionOverride check, which answer "may this user write
 * this entity at all" — this answers "this particular record".
 *
 *  - delete: ADMIN only. Deleting a colleague's diary entry or a day's
 *    attendance is destructive and was already admin-only in the entity RLS.
 *  - update: ADMIN, or the record's author (its attribution field), or — for
 *    Attendance only — a teacher currently assigned to the record's
 *    classroom, so a co-teacher can correct the day's list without having
 *    been the one who first took it.
 */
export function decideModifyExisting(input: {
  entity: string;
  operation: string;
  appRole: string;
  userId: string;
  existing: Record<string, unknown>;
  assignedClassroomIds?: string[];
}): ModifyDecision {
  const { entity, operation, appRole, userId, existing } = input;
  if (appRole === 'ADMIN') return { ok: true, reason: 'admin' };
  if (operation === 'delete') {
    return { ok: false, code: 'DELETE_ADMIN_ONLY', message: 'Only a school ADMIN may delete this record' };
  }
  const attribution = ATTRIBUTION_FIELDS[entity];
  if (attribution && userId && String(existing?.[attribution.id] || '') === userId) {
    return { ok: true, reason: 'author' };
  }
  const classroomId = String(existing?.classroom_id || '');
  if (entity === 'Attendance' && classroomId && (input.assignedClassroomIds || []).includes(classroomId)) {
    return { ok: true, reason: 'assigned_teacher' };
  }
  return { ok: false, code: 'NOT_AUTHOR', message: 'Only the author or a school ADMIN may edit this record' };
}

// Records a TEACHER files against a classroom. schoolRead shows them to that
// classroom's teachers and to the named child's parents (P10), so the
// classroom and child a non-ADMIN names on create must be their own.
export const CLASSROOM_BOUND_ENTITIES = ['Attendance', 'DiaryEntry', 'Homework'];

/**
 * May this non-ADMIN caller CREATE a record aimed at these targets? Runs after
 * the role policy/override check and the same-school reference checks.
 *
 *  - Attendance / DiaryEntry / Homework: classroom_id must be one of the
 *    caller's ACTIVE TeacherClassroom rows, and a named student must
 *    currently be in that classroom.
 *  - Notice: a CLASSROOM notice must target one of the caller's classrooms;
 *    a STUDENT notice a student of one of them (and, if it also names a
 *    classroom, that student's). A SCHOOL notice is unchanged.
 *
 * `studentClassroomId` is the named student's CURRENT classroom (null when no
 * student is named or found). ADMIN is never restricted here.
 */
export function decideCreateTargets(input: {
  entity: string;
  appRole: string;
  data: Record<string, unknown>;
  assignedClassroomIds: string[];
  studentClassroomId: string | null;
}): ModifyDecision {
  const { entity, appRole, data } = input;
  if (appRole === 'ADMIN') return { ok: true, reason: 'admin' };
  const assigned = input.assignedClassroomIds || [];
  const classroomId = typeof data?.classroom_id === 'string' ? data.classroom_id : '';
  const studentId = typeof data?.student_id === 'string' ? data.student_id : '';
  const notAssigned: ModifyDecision = { ok: false, code: 'CLASSROOM_NOT_ASSIGNED', message: 'That classroom is not assigned to you' };
  const wrongClassroom: ModifyDecision = { ok: false, code: 'STUDENT_NOT_IN_CLASSROOM', message: 'That student is not in that classroom' };

  if (CLASSROOM_BOUND_ENTITIES.includes(entity)) {
    if (!classroomId || !assigned.includes(classroomId)) return notAssigned;
    if (studentId && input.studentClassroomId !== classroomId) return wrongClassroom;
    return { ok: true, reason: 'assigned_teacher' };
  }
  if (entity === 'Notice') {
    const scope = typeof data?.scope === 'string' && data.scope ? data.scope : 'SCHOOL';
    if (scope === 'CLASSROOM') {
      return classroomId && assigned.includes(classroomId) ? { ok: true, reason: 'assigned_teacher' } : notAssigned;
    }
    if (scope === 'STUDENT') {
      if (!studentId || !input.studentClassroomId || !assigned.includes(input.studentClassroomId)) return notAssigned;
      if (classroomId && classroomId !== input.studentClassroomId) return wrongClassroom;
      return { ok: true, reason: 'assigned_teacher' };
    }
  }
  return { ok: true, reason: 'untargeted' };
}
