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
