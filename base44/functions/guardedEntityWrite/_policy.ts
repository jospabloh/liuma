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

// Fields only a server function (notifyParents, sendBulkNotification, the
// payment settlement in ./_payments.ts) may write. Service-role writes
// bypass the fields' own rls.write:false, so they are stripped by hand — on
// CREATE as well as update: a teacher creating an Attendance with
// parent_notified:true, or a DiaryEntry with notified_parent_emails
// pre-filled, would otherwise silently stop the parents' email.
export const SERVER_ONLY_FIELDS: Record<string, string[]> = {
  DiaryEntry: ['parents_notified_at', 'notified_parent_emails'],
  Attendance: ['parent_notified', 'notified_at'],
  // What has been paid (re-derived from PaymentRecords, ./_payments.ts) and
  // when a family was last reminded (sendBulkNotification's).
  ChargeItem: ['amount_paid', 'last_payment_date', 'last_reminder_at', 'reminder_claim_id', 'reminder_sent'],
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
  // P10b: a notice's deliveries, an override's or a pending change's target.
  notice_id: 'Notice',
  user_profile_id: 'UserProfile',
  target_profile_id: 'UserProfile',
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
 *    classroom, that student's). A SCHOOL notice (or any other scope) is
 *    ADMIN-only: since P10b a published notice fans out NoticeDelivery rows
 *    to every family in its audience, and schoolRead already shows a SCHOOL
 *    notice to every parent — no teacher screen ever offered it
 *    (AvisosMaestro sends CLASSROOM only).
 *
 * Also run on an UPDATE that re-targets a record (retargetsRecord), over the
 * stored record merged with the patch, and by the notice fan-out at publish
 * time — so a target can't be moved after the create-time check.
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
    return { ok: false, code: 'SCHOOL_NOTICE_ADMIN_ONLY', message: 'Only a school ADMIN may address the whole school' };
  }
  return { ok: true, reason: 'untargeted' };
}

/**
 * Does this update patch move the record's target (its classroom or, for a
 * Notice, its scope) away from what is stored? Only then does the update
 * re-run decideCreateTargets: an edit that leaves the target alone must keep
 * working even if the author has since lost the classroom or the child moved.
 * student_id never reaches here — it is stripped from every patch.
 */
export function retargetsRecord(existing: Record<string, unknown>, patch: Record<string, unknown>): boolean {
  return ['classroom_id', 'scope'].some((field) =>
    Object.prototype.hasOwnProperty.call(patch || {}, field)
    && String(patch[field] ?? '') !== String(existing?.[field] ?? ''));
}

// ===========================================================================
// P10b (2026-09-29) — the tenant WRITE path.
//
// P10 moved every school read to schoolRead (service role, scoped by the
// caller's profile). The writes were still direct SDK calls against entities
// whose deployed RLS is platform-owner only, so a real school ADMIN could not
// create a classroom, a student, an event, a discount… This function is now
// their only write path too. Owner decision: the entity RLS stays strict (it
// is never loosened), and every rule below is decided with the school and
// role RE-DERIVED from the caller's current UserProfile — never the body.
//
// Mirrored for the client (UI gating only, never trusted) in
// src/lib/authorization/guardedWritePolicy.js; tests/unit/write-path-p10b
// fails if the two role tables drift.
// ===========================================================================

export type Op = 'create' | 'update' | 'delete';

export type FieldType =
  | 'id'
  | 'string'
  | 'text'
  | 'longtext'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'url'
  | 'strings'
  | 'files'
  | 'json'
  | { enum: string[] };

export type SchoolWriteRule = {
  /** Which roles may run each operation. A missing operation is not offered. */
  roles: Partial<Record<Op, string[]>>;
  /** The ONLY fields a client may send (anything else is dropped), and their type. */
  fields: Record<string, FieldType>;
  /** The subset of `fields` an update may change (default: all of them). */
  updateFields?: string[];
  /** Must be present and non-empty on create (and cannot be blanked on update). */
  required?: string[];
  /** Must name a user with an ACTIVE UserProfile in THIS school and one of these roles. */
  userRefs?: Record<string, string[]>;
  /** Operations that stay open while the license is read-only (see licenseExempt). */
  licenseExempt?: Op[];
};

const ADMIN_ONLY = ['ADMIN'];
const STAFF = ['ADMIN', 'TEACHER'];
const EVERYONE = ['ADMIN', 'TEACHER', 'PARENT'];

const SUPPORT_STATUSES = ['OPEN', 'AI_RESOLVED', 'ESCALATED', 'IN_PROGRESS', 'WAITING_USER', 'RESOLVED', 'CLOSED'];
const SUPPORT_CATEGORIES = ['ACADEMIC', 'PAYMENTS', 'ACCOUNT', 'TECHNICAL', 'FEATURE', 'BILLING', 'OTHER'];
const SUPPORT_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export const SCHOOL_WRITES: Record<string, SchoolWriteRule> = {
  // No delete for Classroom/Student: history (attendance, diaries, charges)
  // keeps pointing at them. They are retired with is_active:false.
  Classroom: {
    roles: { create: ADMIN_ONLY, update: ADMIN_ONLY },
    fields: { name: 'string', grade: 'string', capacity: 'number', is_active: 'boolean' },
    required: ['name'],
  },
  Student: {
    roles: { create: ADMIN_ONLY, update: ADMIN_ONLY },
    fields: {
      classroom_id: 'id',
      first_name: 'string',
      last_name: 'string',
      birth_date: 'date',
      photo_url: 'url',
      blood_type: 'string',
      allergies: 'text',
      medical_notes: 'text',
      is_active: 'boolean',
    },
    required: ['first_name', 'last_name'],
  },
  // Assignments and parent links are what schoolRead derives a teacher's
  // classrooms and a parent's children from — i.e. they GRANT reads. Only a
  // school ADMIN hands them out, and an existing one cannot be re-pointed at
  // another person or classroom/child (updateFields): revoke and re-create.
  TeacherClassroom: {
    roles: { create: ADMIN_ONLY, update: ADMIN_ONLY },
    fields: { teacher_id: 'id', classroom_id: 'id', is_primary: 'boolean', is_active: 'boolean' },
    updateFields: ['is_primary', 'is_active'],
    required: ['teacher_id', 'classroom_id'],
    userRefs: { teacher_id: ['TEACHER', 'ADMIN'] },
  },
  ParentStudent: {
    roles: { create: ADMIN_ONLY, update: ADMIN_ONLY },
    fields: {
      parent_id: 'id',
      student_id: 'id',
      relationship: { enum: ['madre', 'padre', 'tutor', 'abuelo', 'abuela', 'otro'] },
      is_primary: 'boolean',
      status: { enum: ['PENDING', 'ACTIVE', 'REVOKED'] },
    },
    updateFields: ['relationship', 'is_primary', 'status'],
    required: ['parent_id', 'student_id'],
    userRefs: { parent_id: ['PARENT'] },
  },
  Event: {
    roles: { create: ADMIN_ONLY, update: ADMIN_ONLY, delete: ADMIN_ONLY },
    // reminder_sent belongs to sendBulkNotification.
    fields: {
      title: 'string',
      description: 'text',
      date: 'date',
      time: 'string',
      end_time: 'string',
      location: 'string',
      scope: { enum: ['SCHOOL', 'CLASSROOM'] },
      classroom_id: 'id',
      requires_confirmation: 'boolean',
      has_cost: 'boolean',
      cost_amount: 'number',
      cost_concept: 'string',
      confirmation_deadline: 'date',
    },
    required: ['title', 'date'],
  },
  Discount: {
    roles: { create: ADMIN_ONLY, update: ADMIN_ONLY, delete: ADMIN_ONLY },
    fields: {
      name: 'string',
      description: 'text',
      discount_type: { enum: ['PERCENTAGE', 'FIXED_AMOUNT'] },
      discount_value: 'number',
      applies_to: 'strings',
      applicable_to_concepts: 'strings',
      is_active: 'boolean',
      valid_from: 'date',
      valid_until: 'date',
      requires_approval: 'boolean',
    },
    required: ['name', 'discount_type', 'discount_value'],
  },
  OfficialDocument: {
    roles: { create: ADMIN_ONLY, update: ADMIN_ONLY, delete: ADMIN_ONLY },
    // uploaded_by / uploaded_by_name are stamped from the caller.
    fields: {
      title: 'string',
      description: 'text',
      document_type: { enum: ['MENU', 'COMMUNICATION', 'MINUTA', 'UNIFORM_CATALOG'] },
      file_url: 'url',
      target_audience: { enum: ['TODOS', 'PADRES', 'MAESTROS', 'ADMINS'] },
      valid_from: 'date',
      valid_until: 'date',
      is_current: 'boolean',
    },
    required: ['title', 'document_type', 'file_url'],
  },
  SchoolSetupGuide: {
    roles: { create: ADMIN_ONLY, update: ADMIN_ONLY, delete: ADMIN_ONLY },
    // completed_by / confirmed_by and their timestamps are stamped from the
    // caller and the server clock whenever the client touches them.
    fields: {
      step_number: 'number',
      step_name: 'string',
      description: 'text',
      category: { enum: ['GUARDERIA', 'ESCUELA', 'COLEGIO', 'GENERAL'] },
      is_annual: 'boolean',
      school_year: 'string',
      is_completed: 'boolean',
      completed_by: 'string',
      completed_at: 'datetime',
      last_confirmed_at: 'datetime',
      confirmed_by: 'string',
      notes: 'text',
      documents: 'files',
    },
    required: ['step_number', 'step_name', 'category'],
  },
  PermissionOverride: {
    roles: { create: ADMIN_ONLY, update: ADMIN_ONLY, delete: ADMIN_ONLY },
    // Only the overridable resources and the actions the form offers
    // (permissionLabels.js): an override on anything else would be a row
    // nothing enforces.
    fields: {
      user_profile_id: 'id',
      resource: { enum: Object.keys(POLICY_WRITE) },
      action: { enum: ['read', 'write'] },
      effect: { enum: ['allow', 'deny'] },
      reason: 'text',
    },
    required: ['user_profile_id', 'resource', 'action', 'effect'],
  },
  PendingChange: {
    // The PERMISSION_ROLLBACK request of PermisosRoles. ROLE_CHANGE requests
    // belong to governRoleChange. type/status/requester are stamped here.
    roles: { create: ADMIN_ONLY },
    fields: { target_profile_id: 'id', payload: 'json' },
    required: ['target_profile_id', 'payload'],
  },
  // The school's review of a family's request. Creation stays with
  // guardedFamilyWrite.
  AbsenceNotification: {
    roles: { update: ADMIN_ONLY },
    fields: { status: { enum: ['PENDING', 'APPROVED', 'REJECTED'] }, admin_notes: 'text' },
  },
  UniformOrder: {
    roles: { update: ADMIN_ONLY },
    fields: {
      status: { enum: ['PENDING', 'PROCESSING', 'READY', 'DELIVERED', 'CANCELLED'] },
      admin_notes: 'text',
      estimated_delivery: 'date',
    },
  },
  // create = fan out ONE notice to its audience (planNoticeDeliveries): the
  // client names the notice, the server picks the recipients and the school.
  // update = the recipient marking their own copy read/acknowledged.
  NoticeDelivery: {
    roles: { create: STAFF, update: EVERYONE },
    fields: {
      notice_id: 'id',
      status: { enum: ['READ', 'ACKNOWLEDGED'] },
      escalation_status: { enum: ['ESCALATED'] },
    },
    updateFields: ['status', 'escalation_status'],
    required: ['notice_id'],
    // Reading a notice is not a write the license should stop.
    licenseExempt: ['update'],
  },
  SupportTicket: {
    roles: { create: EVERYONE, update: ADMIN_ONLY },
    fields: {
      ticket_number: 'string',
      subject: 'string',
      category: { enum: SUPPORT_CATEGORIES },
      priority: { enum: SUPPORT_PRIORITIES },
      channel_origin: { enum: ['LUMI_AI', 'MANUAL'] },
      ai_attempted: 'boolean',
      ai_resolution_summary: 'longtext',
      client_context: 'longtext',
      ai_brief: 'json',
      // update only (a director working the ticket):
      status: { enum: SUPPORT_STATUSES },
      first_response_at: 'datetime',
      resolved_at: 'datetime',
      escalated_at: 'datetime',
      tier: { enum: ['PLATFORM'] },
    },
    updateFields: ['status', 'first_response_at', 'resolved_at', 'escalated_at', 'tier'],
    required: ['ticket_number', 'subject'],
    // A school whose license lapsed must still be able to ask for help —
    // BILLING tickets are exactly how it gets out of that state.
    licenseExempt: ['create', 'update'],
  },
};

function ownRule(entity: string): SchoolWriteRule | null {
  return Object.prototype.hasOwnProperty.call(SCHOOL_WRITES, entity) ? SCHOOL_WRITES[entity] : null;
}

export function schoolWriteRule(entity: string): SchoolWriteRule | null {
  return ownRule(entity);
}

/** Every entity this function writes, and which roles may run each op. */
export function guardedWriteTable(): Record<string, Partial<Record<Op, string[]>>> {
  const table: Record<string, Partial<Record<Op, string[]>>> = {};
  for (const [entity, roles] of Object.entries(POLICY_WRITE)) {
    // update: the author or an ADMIN (decideModifyExisting); delete: ADMIN.
    table[entity] = { create: [...roles], update: [...roles], delete: roles.filter((r) => r === 'ADMIN') };
  }
  for (const [entity, rule] of Object.entries(SCHOOL_WRITES)) {
    const ops: Partial<Record<Op, string[]>> = {};
    for (const op of ['create', 'update', 'delete'] as Op[]) if (rule.roles[op]) ops[op] = [...(rule.roles[op] as string[])];
    table[entity] = ops;
  }
  return table;
}

// --- Field cleaning ---------------------------------------------------------

const MAX_STRING = 300;
const MAX_TEXT = 5000;
const MAX_LONGTEXT = 20000;
const MAX_JSON = 50000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// http(s) only: these land in an <a href>/<img src>, and a javascript: URL
// there is script in every other user's browser. Parsed rather than matched
// by a whitespace-free regex: Core.UploadFile may hand back a file_url with
// the original file name in it ("Menú semanal.pdf"), and rejecting that would
// also block every later edit of a setup step that carries it (…step is
// re-sent whole).
function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 2000) return false;
  if (!/^https?:\/\//i.test(value.trim())) return false;
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname;
  } catch {
    return false;
  }
}

type Cleaned = { ok: true; value: unknown } | { ok: false };

/**
 * Coerce one client value to its declared type, or reject it. Empty
 * (null/undefined/'') always becomes null — a field can be cleared; whether it
 * may be is the `required` check's call.
 */
export function cleanFieldValue(type: FieldType, value: unknown): Cleaned {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof type === 'object') {
    return typeof value === 'string' && type.enum.includes(value) ? { ok: true, value } : { ok: false };
  }
  switch (type) {
    case 'id':
      return typeof value === 'string' && ID_RE.test(value) ? { ok: true, value } : { ok: false };
    case 'string':
    case 'text':
    case 'longtext': {
      if (typeof value !== 'string' && typeof value !== 'number') return { ok: false };
      const max = type === 'string' ? MAX_STRING : type === 'text' ? MAX_TEXT : MAX_LONGTEXT;
      return { ok: true, value: String(value).trim().slice(0, max) };
    }
    case 'number': {
      const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    case 'boolean':
      return typeof value === 'boolean' ? { ok: true, value } : { ok: false };
    case 'date':
      return typeof value === 'string' && DATE_RE.test(value) ? { ok: true, value } : { ok: false };
    case 'datetime':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? { ok: true, value } : { ok: false };
    case 'url':
      return isHttpUrl(value) ? { ok: true, value: value.trim() } : { ok: false };
    case 'strings':
      if (!Array.isArray(value) || value.length > 50) return { ok: false };
      if (!value.every((v) => typeof v === 'string')) return { ok: false };
      return { ok: true, value: value.map((v) => String(v).slice(0, 100)) };
    case 'files': {
      if (!Array.isArray(value) || value.length > 50) return { ok: false };
      const files = [];
      for (const item of value) {
        const it = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        if (!isHttpUrl(it.url)) return { ok: false };
        files.push({ name: typeof it.name === 'string' ? it.name.slice(0, 200) : '', url: it.url.trim() });
      }
      return { ok: true, value: files };
    }
    case 'json': {
      if (typeof value !== 'object') return { ok: false };
      let size = 0;
      try {
        size = JSON.stringify(value).length;
      } catch {
        return { ok: false };
      }
      return size <= MAX_JSON ? { ok: true, value } : { ok: false };
    }
  }
  return { ok: false };
}

// --- Support routing / SLA (copies of src/lib/support/routing.js and sla.js) --

const PLATFORM_CATEGORIES = ['TECHNICAL', 'FEATURE', 'BILLING'];
const SLA_BUSINESS_DAYS: Record<string, number> = { URGENT: 1, HIGH: 2, NORMAL: 3, LOW: 5 };
const PLATFORM_SLA_HOURS = 48;

/** MIRRORS src/lib/support/routing.js#resolveSupportRouting. */
export function supportRouting(requesterRole: string, category: string): { tier: string; assigneeRole: string } {
  if (requesterRole === 'ADMIN' || PLATFORM_CATEGORIES.includes(category || 'OTHER')) {
    return { tier: 'PLATFORM', assigneeRole: 'OWNER' };
  }
  return { tier: 'SCHOOL_ADMIN', assigneeRole: 'SCHOOL_ADMIN' };
}

/** MIRRORS src/lib/support/sla.js#computeSlaDueAt. */
export function supportSlaDueAt(priority: string, tier: string, from: Date): string {
  if (tier === 'PLATFORM') return new Date(from.getTime() + PLATFORM_SLA_HOURS * 3600 * 1000).toISOString();
  const result = new Date(from.getTime());
  let remaining = SLA_BUSINESS_DAYS[priority] ?? SLA_BUSINESS_DAYS.NORMAL;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result.toISOString();
}

// --- Building the record ----------------------------------------------------

export type WriteCtx = {
  userId: string;
  userName: string;
  userEmail?: string;
  profileId: string;
  role: string;
  schoolId: string;
  now: Date;
  existing?: Record<string, unknown> | null;
};

export type BuiltWrite = { ok: true; data: Record<string, unknown> } | { ok: false; code: string; message: string };

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function stampServerFields(entity: string, operation: Op, data: Record<string, unknown>, ctx: WriteCtx): void {
  const nowIso = ctx.now.toISOString();
  const create = operation === 'create';
  const defaultTo = (field: string, value: unknown) => {
    if (create && isBlank(data[field])) data[field] = value;
  };
  switch (entity) {
    case 'Classroom':
    case 'Student':
      defaultTo('is_active', true);
      break;
    case 'TeacherClassroom':
      defaultTo('is_active', true);
      defaultTo('is_primary', false);
      break;
    case 'ParentStudent':
      defaultTo('status', 'ACTIVE');
      defaultTo('is_primary', false);
      break;
    case 'Event':
      // A school-wide event names no classroom; a stray id would make it
      // look classroom-scoped to anyone reading the raw row.
      if ('scope' in data || 'classroom_id' in data) {
        const scope = data.scope ?? ctx.existing?.scope ?? 'SCHOOL';
        if (scope !== 'CLASSROOM') data.classroom_id = null;
      }
      break;
    case 'OfficialDocument':
      if (create) {
        data.uploaded_by = ctx.userId;
        data.uploaded_by_name = ctx.userName;
      }
      defaultTo('is_current', true);
      break;
    case 'SchoolSetupGuide': {
      // "Who did this, and when" is the caller and the server clock — never
      // someone the client names — and it changes only when the state does.
      // ConfiguracionInicial sends the whole step (`...step`) on every edit,
      // so saving a note must not re-stamp who completed it.
      const prev = ctx.existing || {};
      const completing = create
        ? data.is_completed === true
        : 'is_completed' in data && Boolean(data.is_completed) !== Boolean(prev.is_completed);
      const confirming = 'last_confirmed_at' in data && !isBlank(data.last_confirmed_at)
        && data.last_confirmed_at !== prev.last_confirmed_at;
      for (const field of ['completed_by', 'completed_at', 'confirmed_by', 'last_confirmed_at']) delete data[field];
      if (create || completing) {
        const done = data.is_completed === true;
        data.completed_by = done ? ctx.userId : null;
        data.completed_at = done ? nowIso : null;
      }
      if (confirming) {
        data.confirmed_by = ctx.userId;
        data.last_confirmed_at = nowIso;
      }
      defaultTo('is_completed', false);
      break;
    }
    case 'PendingChange':
      data.type = 'PERMISSION_ROLLBACK';
      data.status = 'PENDING_SECOND_ADMIN_APPROVAL';
      data.requester_profile_id = ctx.profileId;
      data.requester_user_id = ctx.userId;
      break;
    case 'AbsenceNotification':
      if ('status' in data) {
        data.reviewed_by = ctx.userId;
        data.reviewed_at = nowIso;
      }
      break;
    case 'NoticeDelivery':
      if (!create && data.status && isBlank(ctx.existing?.read_at)) data.read_at = nowIso;
      break;
    case 'SupportTicket':
      if (create) {
        const category = String(data.category || 'OTHER');
        const priority = String(data.priority || 'NORMAL');
        const routing = supportRouting(ctx.role, category);
        Object.assign(data, {
          requester_user_id: ctx.userId,
          requester_profile_id: ctx.profileId,
          requester_role: ctx.role,
          requester_name: ctx.userName || ctx.userEmail || 'Usuario',
          category,
          priority,
          channel_origin: data.channel_origin || 'MANUAL',
          ai_attempted: data.ai_attempted === true,
          status: 'ESCALATED',
          tier: routing.tier,
          assignee_role: routing.assigneeRole,
          sla_due_at: supportSlaDueAt(priority, routing.tier, ctx.now),
          first_response_at: null,
          resolved_at: null,
          escalated_at: nowIso,
        });
      } else {
        for (const field of ['first_response_at', 'resolved_at', 'escalated_at']) {
          if (field in data) data[field] = isBlank(data[field]) ? null : nowIso;
        }
        if (data.tier === 'PLATFORM') {
          // Hand-off to soporte: fresh platform clock, owner assignee.
          data.assignee_role = 'OWNER';
          data.sla_due_at = supportSlaDueAt(String(ctx.existing?.priority || 'NORMAL'), 'PLATFORM', ctx.now);
        } else {
          delete data.tier;
        }
      }
      break;
  }
}

/**
 * The record (create) or patch (update) to write, built ONLY from the
 * entity's allowlisted fields plus server-stamped ones. school_id is set from
 * ctx on create and never part of a patch; nothing else a client sends
 * (attribution, status machinery, another school's id) survives.
 */
export function buildSchoolWrite(entity: string, operation: Op, input: Record<string, unknown>, ctx: WriteCtx): BuiltWrite {
  const rule = ownRule(entity);
  if (!rule) return { ok: false, code: 'UNKNOWN_ENTITY', message: 'Unsupported entity' };
  if (operation === 'delete') return { ok: true, data: {} };
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const allowed = operation === 'update' ? rule.updateFields || Object.keys(rule.fields) : Object.keys(rule.fields);
  const data: Record<string, unknown> = {};
  for (const field of allowed) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
    const cleaned = cleanFieldValue(rule.fields[field], source[field]);
    if (!cleaned.ok) return { ok: false, code: 'INVALID_FIELD', message: `${field} is not valid` };
    data[field] = cleaned.value;
  }
  for (const field of rule.required || []) {
    const missing = operation === 'create' ? isBlank(data[field]) : field in data && isBlank(data[field]);
    if (missing) return { ok: false, code: 'MISSING_FIELDS', message: `${field} is required` };
  }
  stampServerFields(entity, operation, data, ctx);
  if (operation === 'create') data.school_id = ctx.schoolId;
  if (operation === 'update' && Object.keys(data).length === 0) {
    return { ok: false, code: 'EMPTY_PATCH', message: 'Nothing to update' };
  }
  return { ok: true, data };
}

/** [field, allowedRoles, userId] for every user reference the record carries. */
export function userReferencesToCheck(entity: string, data: Record<string, unknown>): Array<[string, string[], string]> {
  const rule = ownRule(entity);
  const out: Array<[string, string[], string]> = [];
  for (const [field, roles] of Object.entries(rule?.userRefs || {})) {
    const value = data?.[field];
    if (typeof value === 'string' && value) out.push([field, roles, value]);
  }
  return out;
}

/**
 * Record-level rule for a non-owner's update/delete of a SCHOOL_WRITES
 * entity, after the role check. The school match is already done.
 */
export function decideSchoolRecord(input: {
  entity: string;
  operation: string;
  appRole: string;
  userId: string;
  existing: Record<string, unknown>;
}): ModifyDecision {
  const { entity, operation, userId, existing } = input;
  if (entity === 'NoticeDelivery' && operation === 'update') {
    return String(existing?.recipient_user_id || '') === userId
      ? { ok: true, reason: 'recipient' }
      : { ok: false, code: 'NOT_RECIPIENT', message: 'Only the recipient may update this delivery' };
  }
  if (entity === 'SupportTicket' && operation === 'update') {
    // A director works the tickets routed to them; once a ticket is with
    // soporte (PLATFORM) only the platform owner moves it.
    return existing?.tier === 'SCHOOL_ADMIN'
      ? { ok: true, reason: 'school_tier' }
      : { ok: false, code: 'TICKET_NOT_SCHOOL_TIER', message: 'This ticket is handled by LIUMA support' };
  }
  return { ok: true, reason: input.appRole === 'ADMIN' ? 'admin' : 'role' };
}

/** May this operation skip the license read-only gate? */
export function licenseExempt(entity: string, operation: string): boolean {
  const rule = ownRule(entity);
  return !!rule && (rule.licenseExempt || []).includes(operation as Op);
}

// Patches that only TAKE AWAY access: revoking a parent link, removing a
// teacher from a classroom. schoolRead derives a parent's children and a
// teacher's classrooms from exactly these rows, so a director whose license
// lapsed must still be able to cut them (a custody change does not wait for
// a renewal). Exact match only — the patch may carry nothing else.
const REVOKING_PATCHES: Record<string, [string, unknown]> = {
  ParentStudent: ['status', 'REVOKED'],
  TeacherClassroom: ['is_active', false],
};

/** Is this update a pure revocation that the license gate must not block? */
export function licenseExemptPatch(entity: string, operation: string, input: Record<string, unknown>): boolean {
  if (operation !== 'update' || !Object.prototype.hasOwnProperty.call(REVOKING_PATCHES, entity)) return false;
  const [field, value] = REVOKING_PATCHES[entity];
  const keys = Object.keys(input && typeof input === 'object' ? input : {});
  return keys.length === 1 && keys[0] === field && input[field] === value;
}

// Updates that GRANT access again: re-activating a teacher assignment or a
// parent link. Its person must still be an ACTIVE member with the right role
// (userRefs), exactly as on create — they may have left or changed role since.
export function reactivatesGrant(entity: string, patch: Record<string, unknown>): boolean {
  if (entity === 'TeacherClassroom') return patch?.is_active === true;
  if (entity === 'ParentStudent') return patch?.status === 'ACTIVE';
  return false;
}

// --- Notice fan-out -----------------------------------------------------------

/**
 * The NoticeDelivery rows one notice needs: one per ACTIVE parent link (whose
 * parent still has an ACTIVE PARENT profile in the school, when
 * activeParentIds is given) of every ACTIVE student of THIS school in the
 * notice's audience (the whole
 * school, one classroom, or one child), minus the rows that already exist
 * (so a retry does not double-send). Recipients, school and dates never come
 * from the client.
 */
export function planNoticeDeliveries(input: {
  notice: Record<string, unknown>;
  students: Array<Record<string, unknown>>;
  links: Array<Record<string, unknown>>;
  existing: Array<Record<string, unknown>>;
  schoolId: string;
  now: Date;
  /** user_ids with an ACTIVE PARENT profile in this school; a link whose parent left is skipped. */
  activeParentIds?: string[] | null;
}): Array<Record<string, unknown>> {
  const { notice, schoolId, now } = input;
  if (!schoolId || String(notice?.school_id || '') !== schoolId) return [];
  const scope = String(notice.scope || 'SCHOOL');
  const inAudience = (s: Record<string, unknown>) => {
    if (String(s.school_id || '') !== schoolId || s.is_active === false) return false;
    if (scope === 'CLASSROOM') return !!notice.classroom_id && s.classroom_id === notice.classroom_id;
    if (scope === 'STUDENT') return !!notice.student_id && s.id === notice.student_id;
    return scope === 'SCHOOL';
  };
  const studentIds = new Set(input.students.filter(inAudience).map((s) => String(s.id)));
  const seen = new Set(
    input.existing
      .filter((d) => String(d.notice_id || '') === String(notice.id))
      .map((d) => `${d.recipient_user_id}|${d.student_id}`),
  );
  const nowIso = now.toISOString();
  const escalationDueAt = notice.priority === 'URGENT' ? new Date(now.getTime() + 24 * 3600 * 1000).toISOString() : null;
  const members = input.activeParentIds ? new Set(input.activeParentIds.map(String)) : null;
  const rows: Array<Record<string, unknown>> = [];
  for (const link of input.links) {
    const parentId = String(link.parent_id || '');
    const studentId = String(link.student_id || '');
    if (!parentId || !studentIds.has(studentId) || link.status !== 'ACTIVE') continue;
    if (members && !members.has(parentId)) continue;
    if (link.school_id && String(link.school_id) !== schoolId) continue;
    const key = `${parentId}|${studentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      school_id: schoolId,
      notice_id: String(notice.id),
      recipient_user_id: parentId,
      recipient_role: 'PARENT',
      student_id: studentId,
      classroom_id: notice.classroom_id || null,
      status: 'SENT',
      sent_at: notice.sent_at || nowIso,
      escalation_due_at: escalationDueAt,
    });
  }
  return rows;
}

// --- Caller and license (shared by both write paths) -------------------------

export type CallerProfile = {
  id?: string;
  user_id?: string;
  school_id?: string;
  app_role?: string;
  status?: string;
  onboarding_completed?: boolean;
  created_date?: string;
};

// MIRRORS schoolRead/_scope.ts#selectCurrentProfile (and
// src/lib/tenantSelection.js): the ONE rule for "which school am I in", so a
// write lands in the school the screens read from. Tested for equality.
export function selectCurrentProfile(profiles: CallerProfile[] = []): CallerProfile | null {
  const sorted = [...(profiles || [])].sort((a, b) =>
    String(b.created_date || '').localeCompare(String(a.created_date || '')));
  const eligible = sorted.filter((p) => p.status === 'ACTIVE' && p.onboarding_completed);
  return eligible[0] || sorted[0] || null;
}

// MIRRORS schoolRead/_scope.ts#profileProblem.
export function profileProblem(profile: CallerProfile | null): string | null {
  if (!profile) return 'NO_PROFILE';
  if (profile.status !== 'ACTIVE') return 'INACTIVE_PROFILE';
  if (!profile.school_id) return 'NO_SCHOOL';
  if (!['ADMIN', 'TEACHER', 'PARENT'].includes(String(profile.app_role))) return 'INVALID_ROLE';
  return null;
}

export const READ_ONLY_STATUSES = ['view_only', 'suspended', 'inactive', 'canceled'];

// Owner decision (2026-09-29): a missing or expired license FAILS CLOSED to
// read-only. Before this the gate was `if (sub && ...)`, so a school with no
// SchoolSubscription row — every school in production — could write forever,
// and a trial past its 30 days never locked (Mission Control's lifecycle cron
// only counts days past license_expires_at, which a trial row does not have,
// so nothing else ends a trial). MIRRORS
// src/lib/license/licenseModel.js#resolveEffectiveLicense and
// getMySubscription/entry.ts; tests/unit/license-lifecycle.test.js checks the
// copies.
export function effectiveLicenseIsReadOnly(
  sub: { subscription_status?: string; license_tier?: string; trial_end_date?: string } | null,
  now: Date,
): boolean {
  if (!sub) return true;
  const status = String(sub.subscription_status || 'trial');
  if (READ_ONLY_STATUSES.includes(status)) return true;
  if (sub.license_tier === 'founder') return false;
  if (status === 'trial') {
    const end = Date.parse(String(sub.trial_end_date || ''));
    return Number.isNaN(end) || end <= now.getTime();
  }
  // Paid + past license_expires_at stays writable: Mission Control owns that
  // grace period and writes view_only when it ends.
  return false;
}
