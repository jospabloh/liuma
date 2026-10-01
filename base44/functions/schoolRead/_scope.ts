// _scope.ts — WHO may read WHAT inside a school, for every tenant read the app
// makes with the service role (P10, sales-readiness audit F01, 2026-09-29).
//
// IDENTICAL BYTE FOR BYTE in base44/functions/schoolRead/, lumiQuery/ and
// lumiWrite/: Deno functions cannot import across function directories, so
// each carries its own copy, and tests/unit/school-read-scope.test.js fails if
// they drift. Edit one, copy it over the others. The point of sharing it is
// that Lumi (lumiQuery) and the app's own screens (schoolRead) answer from the
// SAME rules, so the chat can never show a family more than the UI would.
//
// Import-free on purpose: `node --test` loads this file directly (Node 22
// strips the type annotations), and the database access below is duck-typed
// (`sr.entities[Name].filter(query, sort, limit, skip)`), so the tests run the
// real planner and executor against an in-memory fake with two schools and
// several families — cross-tenant and cross-family reads are exercised, not
// grepped.
//
// THE MODEL (owner decision, final):
//   - The deployed entity RLS stays strict (platform owner only, or own rows).
//     School users read through here, with the service role.
//   - School, role, classrooms and children are re-derived on EVERY call from
//     the caller's own current UserProfile (selectCurrentProfile — the same
//     deterministic rule as src/lib/tenantSelection.js), TeacherClassroom and
//     ParentStudent. Nothing in the request body can name another school.
//   - A request's filter can only NARROW: the school clause and the role's
//     clause are injected here, a `school_id` in the filter must equal the
//     caller's school, unknown fields/operators are rejected, and every row is
//     re-checked (rowVisible) and projected (hidden fields removed) before it
//     leaves.

export type Role = 'ADMIN' | 'TEACHER' | 'PARENT';

export type Profile = {
  id?: string;
  user_id?: string;
  school_id?: string;
  app_role?: string;
  status?: string;
  onboarding_completed?: boolean;
  created_date?: string;
};

export type Scope = {
  userId: string;
  schoolId: string;
  role: Role;
  profileId?: string;
  classroomIds: string[];
  studentIds: string[];
  // Only loaded when a rule needs it (SupportTicketMessage for a requester).
  ticketIds?: string[];
  // user_ids with an ACTIVE UserProfile in this school. Only loaded when a
  // rule has a `members` check (rows a client can create with any school_id).
  memberUserIds?: string[];
};

// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;
// deno-lint-ignore no-explicit-any
export type Db = any;

export const ROLES: Role[] = ['ADMIN', 'TEACHER', 'PARENT'];

// Mirrors src/lib/tenantSelection.js's selectCurrentUserProfile — the ONE rule
// for "which school am I looking at" (module 14 finding). Newest
// ACTIVE+onboarded profile; else the newest profile at all. Deterministic
// regardless of filter() order.
export function selectCurrentProfile(profiles: Profile[] = []): Profile | null {
  const sorted = [...(profiles || [])].sort((a, b) =>
    String(b.created_date || '').localeCompare(String(a.created_date || '')));
  const eligible = sorted.filter((p) => p.status === 'ACTIVE' && p.onboarding_completed);
  return eligible[0] || sorted[0] || null;
}

// The selected profile must itself be usable. Returns an error code, or null.
// The platform owner is NOT exempt: they read inside their own school profile
// like anyone else (their cross-school screens read the entities directly,
// under the owner-only RLS).
export function profileProblem(profile: Profile | null): string | null {
  if (!profile) return 'NO_PROFILE';
  if (profile.status !== 'ACTIVE') return 'INACTIVE_PROFILE';
  if (!profile.school_id) return 'NO_SCHOOL';
  if (!ROLES.includes(profile.app_role as Role)) return 'INVALID_ROLE';
  return null;
}

// --- The allowlist -----------------------------------------------------------
//
// Per entity: the fields a filter or sort may name, and per role the rule.
//   'school'  → every row of the caller's school.
//   branches  → a row is visible if it matches ANY branch; a branch matches if
//               EVERY one of its fields matches. A field's condition is either
//               a scope set (`{ set: 'classroomIds' }`) or constants
//               (`{ in: [...] }`, `orMissing` = a row without the field counts
//               as the first value, i.e. the schema default).
//   hide      → fields removed from every row for that role (and therefore
//               not filterable or sortable by it — no oracle).
//   members   → fields that must name a user with an ACTIVE UserProfile in
//               the caller's school. For entities whose create RLS let any
//               signed-in user file a row with a school_id of their choosing
//               before P10b (SupportTicket, NoticeDelivery): without it, an
//               outsider's forged row would show up in another school's
//               lists. Checked
//               row by row (never pushed as a giant $in), so such a rule is
//               read in scan mode.
// A role missing from `roles` cannot read that entity at all.
// Output is an ALLOWLIST for non-ADMIN roles: only SYSTEM_FIELDS + `fields`,
// minus `hide`, ever leave (projectRow) — a legacy or undeclared property on
// an old row does not reach a teacher or a parent.

type SetKey = 'classroomIds' | 'studentIds' | 'self' | 'selfProfile' | 'ticketIds';
type Cond = { set: SetKey } | { in: Array<string | boolean>; orMissing?: boolean };
type Branch = Record<string, Cond>;
type RoleRule = { rows: 'school' | Branch[]; hide?: string[]; members?: string[] };
type EntityRule = { fields: string[]; roles: Partial<Record<Role, RoleRule>> };

const set = (key: SetKey): Cond => ({ set: key });
const oneOf = (...values: Array<string | boolean>): Cond => ({ in: values });
const SCHOOL: RoleRule = { rows: 'school' };
// The whole school, minus rows whose `field` does not name a school member.
const SCHOOL_MEMBERS = (...fields: string[]): RoleRule => ({ rows: 'school', members: fields });

// Any record's creator email (`created_by`) is a server field Base44 adds. It
// is another adult's address, so it never leaves for a non-ADMIN.
const ALWAYS_HIDDEN_FOR_NON_ADMIN = ['created_by'];

// Notices/events addressed to the whole school, or to one of the caller's
// classrooms / children. Same reading as Lumi's rules before this module.
const NOTICE_FOR = (extra: Branch[] = []): Branch[] => [
  { scope: { in: ['SCHOOL'], orMissing: true } },
  { scope: oneOf('CLASSROOM'), classroom_id: set('classroomIds') },
  { scope: oneOf('STUDENT'), student_id: set('studentIds') },
  ...extra,
];
const EVENT_FOR: Branch[] = [
  { scope: { in: ['SCHOOL'], orMissing: true } },
  { scope: oneOf('CLASSROOM'), classroom_id: set('classroomIds') },
];

export const READ_RULES: Record<string, EntityRule> = {
  Student: {
    fields: ['school_id', 'classroom_id', 'first_name', 'last_name', 'birth_date', 'photo_url', 'blood_type', 'allergies', 'medical_notes', 'is_active'],
    // Medical fields (allergies, medical_notes, blood_type) reach only the
    // ADMIN, the student's own teachers and the student's own parents —
    // because those are the only rows each role can see at all.
    roles: {
      ADMIN: SCHOOL,
      // The ACTIVE students of the teacher's classrooms — exactly
      // scope.studentIds, the same set Lumi and the other TEACHER rules use.
      // A withdrawn student's medical notes do not stay on the teacher's list.
      TEACHER: { rows: [{ id: set('studentIds') }] },
      PARENT: { rows: [{ id: set('studentIds') }] },
    },
  },
  Classroom: {
    fields: ['school_id', 'name', 'grade', 'capacity', 'is_active'],
    roles: {
      ADMIN: SCHOOL,
      // Names/grades only; teachers see the school's classroom list (calendar
      // labels, assigning a student). No children's data in it.
      TEACHER: SCHOOL,
      PARENT: { rows: [{ id: set('classroomIds') }] },
    },
  },
  TeacherClassroom: {
    fields: ['school_id', 'teacher_id', 'classroom_id', 'is_primary', 'is_active'],
    roles: {
      ADMIN: SCHOOL,
      TEACHER: { rows: [{ classroom_id: set('classroomIds') }] },
    },
  },
  ParentStudent: {
    fields: ['school_id', 'parent_id', 'student_id', 'relationship', 'is_primary', 'status'],
    roles: {
      ADMIN: SCHOOL,
      TEACHER: { rows: [{ student_id: set('studentIds') }] },
      PARENT: { rows: [{ parent_id: set('self') }] },
    },
  },
  UserProfile: {
    fields: ['user_id', 'school_id', 'app_role', 'status', 'phone', 'photo_url', 'onboarding_completed', 'welcome_message_shown', 'pending_notification_recipients', 'is_super_admin'],
    roles: {
      ADMIN: SCHOOL,
      // Who is an active member, and in what role — the same set the member
      // directory (listSchoolMembers) already shows a teacher. Never who is
      // pending, never phones.
      TEACHER: {
        rows: [{ status: oneOf('ACTIVE') }],
        hide: ['phone', 'pending_notification_recipients', 'welcome_message_shown', 'is_super_admin'],
      },
      PARENT: { rows: [{ user_id: set('self') }] },
    },
  },
  EmergencyContact: {
    fields: ['student_id', 'school_id', 'name', 'relationship', 'phone', 'is_authorized_pickup', 'notes', 'added_by_user_id'],
    roles: {
      // The director sees every contact, including the ones parents added
      // (the RLS alone showed an ADMIN only the ones they created).
      ADMIN: SCHOOL,
      PARENT: { rows: [{ student_id: set('studentIds') }] },
    },
  },
  Notice: {
    fields: ['school_id', 'scope', 'classroom_id', 'student_id', 'title', 'content', 'priority', 'author_id', 'author_name', 'is_emergency', 'scheduled_at', 'sent_at', 'expires_at'],
    roles: {
      ADMIN: SCHOOL,
      TEACHER: { rows: NOTICE_FOR([{ author_id: set('self') }]) },
      PARENT: { rows: NOTICE_FOR() },
    },
  },
  NoticeDelivery: {
    fields: ['school_id', 'notice_id', 'recipient_user_id', 'recipient_role', 'student_id', 'classroom_id', 'status', 'sent_at', 'read_at', 'escalation_due_at', 'escalation_status'],
    // Until P10b the NoticeDelivery.create/update RLS only pinned
    // recipient_user_id to the caller, so rows filed before it may carry any
    // school_id/student_id (now guardedEntityWrite derives them). Staff see a
    // row only when its recipient is a member of their school.
    roles: {
      ADMIN: SCHOOL_MEMBERS('recipient_user_id'),
      // A teacher reads the deliveries of their own students' families (the
      // "urgentes sin leer" count on their home) and, since the emergency
      // alert got per-recipient copies (2026-09-30), the ones addressed to
      // them — their own copy of the alert, which they mark read.
      TEACHER: {
        rows: [{ student_id: set('studentIds') }, { recipient_user_id: set('self') }],
        members: ['recipient_user_id'],
      },
      PARENT: { rows: [{ recipient_user_id: set('self') }] },
    },
  },
  Event: {
    fields: ['school_id', 'title', 'description', 'date', 'time', 'end_time', 'location', 'scope', 'classroom_id', 'requires_confirmation', 'has_cost', 'cost_amount', 'cost_concept', 'confirmation_deadline', 'reminder_sent'],
    roles: {
      ADMIN: SCHOOL,
      TEACHER: { rows: EVENT_FOR },
      PARENT: { rows: EVENT_FOR },
    },
  },
  EventResponse: {
    fields: ['school_id', 'event_id', 'student_id', 'parent_id', 'parent_name', 'response', 'payment_status', 'charge_id', 'notes'],
    roles: {
      ADMIN: SCHOOL,
      PARENT: { rows: [{ student_id: set('studentIds') }] },
    },
  },
  Attendance: {
    fields: ['school_id', 'classroom_id', 'student_id', 'date', 'status', 'reason', 'recorded_by', 'recorded_by_name', 'parent_notified', 'notified_at'],
    roles: {
      ADMIN: SCHOOL,
      // Classroom AND student: a row tagged with the teacher's classroom but
      // naming a child who is not (or no longer) in it stays with the ADMIN.
      TEACHER: { rows: [{ classroom_id: set('classroomIds'), student_id: set('studentIds') }] },
      PARENT: { rows: [{ student_id: set('studentIds') }] },
    },
  },
  DiaryEntry: {
    fields: ['bathroom', 'bathroom_pipi', 'bathroom_popo', 'behavior', 'classroom_id', 'date', 'food', 'food_mood', 'general_mood', 'homework_completed', 'incidents', 'learning', 'mood', 'naps', 'needs_clothes', 'needs_diapers', 'needs_ointment', 'needs_other', 'notes_text', 'parent_notes', 'parents_notified_at', 'notified_parent_emails', 'school_id', 'sent_at', 'sent_to_parents', 'sleep_hours', 'sleep_minutes', 'student_id', 'teacher_id', 'teacher_message', 'teacher_name', 'uniform_status'],
    roles: {
      ADMIN: SCHOOL,
      // notified_parent_emails is the parents' addresses (notifyParents'
      // bookkeeping): the director's business, nobody else's.
      TEACHER: { rows: [{ classroom_id: set('classroomIds'), student_id: set('studentIds') }], hide: ['notified_parent_emails'] },
      PARENT: { rows: [{ student_id: set('studentIds') }], hide: ['notified_parent_emails'] },
    },
  },
  Homework: {
    fields: ['school_id', 'classroom_id', 'subject', 'title', 'description', 'due_date', 'assigned_date', 'teacher_id', 'teacher_name', 'attachments'],
    roles: {
      ADMIN: SCHOOL,
      TEACHER: { rows: [{ classroom_id: set('classroomIds') }] },
      PARENT: { rows: [{ classroom_id: set('classroomIds') }] },
    },
  },
  ChargeItem: {
    // amount_paid / last_payment_date: what the family has paid, so Pagos can
    // show a partial payment and the balance (loose-ends pass, 2026-09-30) —
    // without opening PaymentRecord (references, who recorded it) to parents.
    fields: ['amount', 'amount_paid', 'concept_id', 'concept_name', 'concept_type', 'discount_amount', 'discount_id', 'due_date', 'event_id', 'last_payment_date', 'last_reminder_at', 'notes', 'original_amount', 'reminder_sent', 'school_id', 'status', 'student_id'],
    roles: {
      ADMIN: SCHOOL,
      PARENT: { rows: [{ student_id: set('studentIds') }] },
    },
  },
  PaymentConcept: {
    fields: ['school_id', 'name', 'description', 'concept_type', 'default_amount', 'is_recurring', 'recurrence', 'allows_discounts', 'is_active'],
    roles: { ADMIN: SCHOOL },
  },
  Discount: {
    fields: ['school_id', 'name', 'description', 'discount_type', 'discount_value', 'applies_to', 'applicable_to_concepts', 'is_active', 'valid_from', 'valid_until', 'requires_approval'],
    roles: { ADMIN: SCHOOL },
  },
  SchoolSetupGuide: {
    fields: ['school_id', 'step_number', 'step_name', 'description', 'category', 'is_annual', 'school_year', 'is_completed', 'completed_by', 'completed_at', 'last_confirmed_at', 'confirmed_by', 'notes', 'documents'],
    roles: { ADMIN: SCHOOL },
  },
  OfficialDocument: {
    fields: ['description', 'document_type', 'file_url', 'is_current', 'school_id', 'target_audience', 'title', 'uploaded_by', 'uploaded_by_name', 'valid_from', 'valid_until'],
    roles: {
      ADMIN: SCHOOL,
      TEACHER: { rows: [{ target_audience: { in: ['TODOS', 'MAESTROS'], orMissing: true } }] },
      PARENT: { rows: [{ target_audience: { in: ['TODOS', 'PADRES'], orMissing: true } }] },
    },
  },
  WeeklyMenu: {
    fields: ['school_id', 'week_number', 'year', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'is_active'],
    roles: { ADMIN: SCHOOL, TEACHER: SCHOOL, PARENT: SCHOOL },
  },
  AbsenceNotification: {
    fields: ['school_id', 'student_id', 'parent_id', 'parent_name', 'absence_date', 'reason', 'status', 'admin_notes', 'reviewed_by', 'reviewed_at'],
    roles: {
      ADMIN: SCHOOL,
      PARENT: { rows: [{ student_id: set('studentIds') }] },
    },
  },
  UniformOrder: {
    fields: ['school_id', 'student_id', 'parent_id', 'parent_name', 'items', 'measurements', 'status', 'notes', 'admin_notes', 'estimated_delivery'],
    roles: {
      ADMIN: SCHOOL,
      PARENT: { rows: [{ student_id: set('studentIds') }] },
    },
  },
  AuditLog: {
    fields: ['action', 'details', 'ip_address', 'school_id', 'target_id', 'target_type', 'user_email', 'user_id'],
    // The IP of whoever acted (the platform owner included) is not the
    // school's to read.
    roles: { ADMIN: { rows: 'school', hide: ['ip_address'] } },
  },
  PermissionOverride: {
    fields: ['school_id', 'user_profile_id', 'resource', 'action', 'effect', 'reason'],
    roles: {
      ADMIN: SCHOOL,
      // A user may know the overrides that apply to them (the UI hides what
      // guardedEntityWrite would refuse) — never anyone else's.
      TEACHER: { rows: [{ user_profile_id: set('selfProfile') }] },
      PARENT: { rows: [{ user_profile_id: set('selfProfile') }] },
    },
  },
  PendingChange: {
    fields: ['school_id', 'type', 'status', 'requester_profile_id', 'requester_user_id', 'target_profile_id', 'approver_profile_id', 'approver_user_id', 'approved_at', 'payload'],
    roles: { ADMIN: SCHOOL },
  },
  SupportTicket: {
    fields: ['ticket_number', 'school_id', 'requester_user_id', 'requester_profile_id', 'requester_role', 'requester_name', 'subject', 'category', 'priority', 'status', 'tier', 'assignee_role', 'channel_origin', 'ai_attempted', 'ai_resolution_summary', 'sla_due_at', 'first_response_at', 'resolved_at', 'escalated_at', 'client_context', 'ai_brief', 'escalation_notified_recipients'],
    // Until P10b SupportTicket.create RLS only pinned requester_user_id to the
    // caller, so an older ticket's school_id is the requester's claim (now
    // guardedEntityWrite derives it): a ticket reaches a school's queue only
    // when its requester is a member of that school.
    roles: {
      ADMIN: SCHOOL_MEMBERS('requester_user_id'),
      TEACHER: { rows: [{ requester_user_id: set('self') }], hide: ['escalation_notified_recipients', 'ai_brief'] },
      PARENT: { rows: [{ requester_user_id: set('self') }], hide: ['escalation_notified_recipients', 'ai_brief'] },
    },
  },
  SupportTicketMessage: {
    fields: ['ticket_id', 'school_id', 'author_user_id', 'author_role', 'body'],
    roles: {
      ADMIN: SCHOOL,
      // The whole thread of the caller's OWN tickets — staff replies included,
      // which the RLS (author-only) never let a requester read.
      TEACHER: { rows: [{ ticket_id: set('ticketIds') }] },
      PARENT: { rows: [{ ticket_id: set('ticketIds') }] },
    },
  },
};

// Fields every Base44 record has; filterable/sortable for any readable entity.
const SYSTEM_FIELDS = ['id', 'created_date', 'updated_date'];

// Own keys only: `READ_RULES['constructor']` must not resolve to a rule.
function ruleOf(entity: string): EntityRule | null {
  return Object.prototype.hasOwnProperty.call(READ_RULES, entity) ? READ_RULES[entity] : null;
}

function roleRuleOf(role: string, entity: string): RoleRule | null {
  const rule = ruleOf(entity);
  if (!rule || !ROLES.includes(role as Role)) return null;
  return Object.prototype.hasOwnProperty.call(rule.roles, role) ? rule.roles[role as Role] || null : null;
}

export function canRead(role: string, entity: string): boolean {
  return !!roleRuleOf(role, entity);
}

function roleRule(scope: Scope, entity: string): RoleRule | null {
  return roleRuleOf(scope.role, entity);
}

export function hiddenFields(role: string, entity: string): string[] {
  const rule = roleRuleOf(role, entity);
  if (!rule) return [];
  return role === 'ADMIN' ? [...(rule.hide || [])] : [...ALWAYS_HIDDEN_FOR_NON_ADMIN, ...(rule.hide || [])];
}

/** Fields a filter or sort may name, for this role. */
export function allowedFields(role: string, entity: string): string[] {
  const rule = ruleOf(entity);
  if (!rule || !canRead(role, entity)) return [];
  const hidden = new Set(hiddenFields(role, entity));
  return [...SYSTEM_FIELDS, ...rule.fields].filter((f) => !hidden.has(f));
}

function setValues(scope: Scope, key: SetKey): string[] {
  switch (key) {
    case 'classroomIds': return scope.classroomIds || [];
    case 'studentIds': return scope.studentIds || [];
    case 'self': return scope.userId ? [scope.userId] : [];
    case 'selfProfile': return scope.profileId ? [scope.profileId] : [];
    case 'ticketIds': return scope.ticketIds || [];
  }
  return [];
}

function condValues(scope: Scope, cond: Cond): Array<string | boolean> {
  return 'set' in cond ? setValues(scope, cond.set) : cond.in;
}

function condMatches(scope: Scope, cond: Cond, value: unknown): boolean {
  if ('set' in cond) {
    const s = String(value ?? '');
    return !!s && setValues(scope, cond.set).includes(s);
  }
  const effective = (value === undefined || value === null || value === '') && cond.orMissing ? cond.in[0] : value;
  return cond.in.some((v) => v === effective);
}

/** Every row must belong to the caller's school and match the role's rule. */
export function rowVisible(scope: Scope, entity: string, row: Row): boolean {
  if (!row || typeof row !== 'object') return false;
  if (!scope?.schoolId || String(row.school_id || '') !== scope.schoolId) return false;
  const rule = roleRule(scope, entity);
  if (!rule) return false;
  // Unloaded member set = nobody is a member: fail closed.
  const members = scope.memberUserIds || [];
  if ((rule.members || []).some((field) => !members.includes(String(row[field] ?? '')))) return false;
  if (rule.rows === 'school') return true;
  return rule.rows.some((branch) =>
    Object.entries(branch).every(([field, cond]) => condMatches(scope, cond, row[field])));
}

/**
 * Copy of the row with only what this role may see. ADMIN: every stored
 * field minus the rule's `hide`. Everyone else: an allowlist — SYSTEM_FIELDS
 * plus the rule's `fields`, minus hidden ones — so a Base44 system field
 * (created_by_id…) or a legacy property on an old row never leaves.
 */
export function projectRow(scope: Scope, entity: string, row: Row): Row {
  const hidden = new Set(hiddenFields(scope.role, entity));
  if (scope.role === 'ADMIN') {
    const out: Row = { ...row };
    for (const field of hidden) delete out[field];
    return out;
  }
  const out: Row = {};
  for (const field of allowedFields(scope.role, entity)) {
    if (!hidden.has(field) && Object.prototype.hasOwnProperty.call(row, field)) out[field] = row[field];
  }
  return out;
}

/** Visible rows only, each projected. What every caller hands back. */
export function scopeRows<T extends Row>(scope: Scope, entity: string, rows: T[] = []): T[] {
  return (rows || []).filter((row) => rowVisible(scope, entity, row))
    .map((row) => projectRow(scope, entity, row) as T);
}

// --- Request validation ------------------------------------------------------

export const MAX_LIMIT = 1000;
export const DEFAULT_LIMIT = 200;
export const MAX_SKIP = 20000;
export const MAX_IN_VALUES = 500;
export const MAX_BATCH = 12;
// Scan-mode reads (see needsScan) walk up to SCAN_CAP raw rows each; one batch
// may carry at most this many, so a single call cannot fan out into dozens of
// 1000-row service-role queries.
export const MAX_SCANS_PER_BATCH = 3;
// Rules with several branches (Notice, Event for non-ADMIN) are read by
// scanning the school's rows in order and keeping the visible ones; this caps
// how many raw rows one request may walk.
export const SCAN_CAP = 5000;
const SCAN_PAGE = 1000;

const OPERATORS = ['$eq', '$ne', '$in', '$nin', '$gt', '$gte', '$lt', '$lte'];
const LIST_OPERATORS = ['$in', '$nin'];

type Scalar = string | number | boolean | null;
export type Filter = Record<string, unknown>;
export type ReadRequest = { entity?: unknown; filter?: unknown; sort?: unknown; limit?: unknown; skip?: unknown };
export type ValidRead = { ok: true; entity: string; filter: Filter; sort: string; limit: number; skip: number };
export type Refusal = { ok: false; code: string; status: number; field?: string };

function isScalar(v: unknown): v is Scalar {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function refuse(code: string, status: number, field?: string): Refusal {
  return field ? { ok: false, code, status, field } : { ok: false, code, status };
}

// One field's condition, normalized: scalars stay, arrays become $in, operator
// objects are checked key by key. Returns null when the shape is not allowed.
function normalizeCondition(value: unknown): unknown {
  if (isScalar(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > MAX_IN_VALUES || !value.every(isScalar)) return null;
    return { $in: value };
  }
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length === 0) return null;
  const out: Record<string, unknown> = {};
  for (const op of keys) {
    if (!OPERATORS.includes(op)) return null;
    const operand = value[op];
    if (LIST_OPERATORS.includes(op)) {
      if (!Array.isArray(operand) || operand.length > MAX_IN_VALUES || !operand.every(isScalar)) return null;
    } else if (!isScalar(operand)) {
      return null;
    }
    out[op] = operand;
  }
  return out;
}

// The school named by a filter's school_id, when it names exactly one.
function namedSchool(cond: unknown): string | null {
  if (typeof cond === 'string') return cond;
  if (isPlainObject(cond)) {
    const keys = Object.keys(cond);
    if (keys.length === 1 && keys[0] === '$eq' && typeof cond.$eq === 'string') return cond.$eq;
    if (keys.length === 1 && keys[0] === '$in' && Array.isArray(cond.$in)) {
      const unique = [...new Set(cond.$in)];
      if (unique.length === 1 && typeof unique[0] === 'string') return unique[0];
    }
  }
  return null;
}

/**
 * Validate one read request for this caller. The returned filter has NO
 * school clause (planQuery injects it); a school_id in the request is only
 * accepted when it is the caller's own school.
 */
export function validateRead(scope: Scope, req: ReadRequest): ValidRead | Refusal {
  const entity = typeof req?.entity === 'string' ? req.entity : '';
  if (!ruleOf(entity)) return refuse('UNKNOWN_ENTITY', 400);
  if (!canRead(scope.role, entity)) return refuse('NOT_ALLOWED_FOR_ROLE', 403);

  const allowed = new Set(allowedFields(scope.role, entity));
  const raw = req.filter === undefined || req.filter === null ? {} : req.filter;
  if (!isPlainObject(raw)) return refuse('INVALID_FILTER', 400);

  const filter: Filter = {};
  for (const [field, value] of Object.entries(raw)) {
    if (field.startsWith('$')) return refuse('INVALID_FILTER', 400, field);
    if (field === 'school_id') {
      if (namedSchool(value) !== scope.schoolId) return refuse('SCHOOL_MISMATCH', 403, field);
      continue;
    }
    if (!allowed.has(field)) return refuse('FIELD_NOT_ALLOWED', 400, field);
    const cond = normalizeCondition(value);
    if (cond === null) return refuse('INVALID_FILTER', 400, field);
    filter[field] = cond;
  }

  let sort = '-created_date';
  if (req.sort !== undefined && req.sort !== null && req.sort !== '') {
    if (typeof req.sort !== 'string') return refuse('INVALID_SORT', 400);
    const field = req.sort.replace(/^[-+]/, '');
    if (!allowed.has(field)) return refuse('INVALID_SORT', 400, field);
    sort = req.sort;
  }

  const limitNum = req.limit === undefined || req.limit === null ? DEFAULT_LIMIT : Number(req.limit);
  if (!Number.isInteger(limitNum) || limitNum < 1) return refuse('INVALID_LIMIT', 400);
  const skipNum = req.skip === undefined || req.skip === null ? 0 : Number(req.skip);
  if (!Number.isInteger(skipNum) || skipNum < 0 || skipNum > MAX_SKIP) return refuse('INVALID_SKIP', 400);

  return { ok: true, entity, filter, sort, limit: Math.min(limitNum, MAX_LIMIT), skip: skipNum };
}

// --- Planning ----------------------------------------------------------------

export type Plan =
  | { mode: 'empty' }
  | { mode: 'push'; query: Filter }
  | { mode: 'scan'; query: Filter };

// Narrow one field's (already normalized) condition to the allowed values.
// Returns undefined when nothing can match. Only equality and $in are
// meaningful on an id/enum field the role is scoped by, so any other operator
// on such a field is combined with the allowed $in (it can only narrow).
function intersect(current: unknown, allowedValues: Array<string | boolean>): unknown {
  const allowed = allowedValues.map((v) => v);
  if (current === undefined) return allowed.length ? { $in: allowed } : undefined;
  if (isScalar(current)) return allowed.includes(current as string) ? current : undefined;
  const ops = { ...(current as Record<string, unknown>) };
  let candidates = allowed;
  if ('$eq' in ops) {
    candidates = candidates.filter((v) => v === ops.$eq);
    delete ops.$eq;
  }
  if (Array.isArray(ops.$in)) {
    const wanted = ops.$in as unknown[];
    candidates = candidates.filter((v) => wanted.includes(v));
  }
  if (candidates.length === 0) return undefined;
  ops.$in = candidates;
  return ops;
}

/**
 * Whether this role's reads of this entity walk the school's rows and filter
 * them (several branches, a constant with orMissing, or a `members` check)
 * instead of pushing the whole rule into the query.
 */
export function needsScan(role: string, entity: string): boolean {
  const rule = roleRuleOf(role, entity);
  if (!rule) return false;
  if (rule.members && rule.members.length) return true;
  if (rule.rows === 'school') return false;
  if (rule.rows.length !== 1) return true;
  return Object.values(rule.rows[0]).some((cond) => !('set' in cond) && !!cond.orMissing);
}

/** The database query for a validated request, school clause injected. */
export function planQuery(scope: Scope, entity: string, filter: Filter): Plan {
  const rule = roleRule(scope, entity);
  if (!rule || !scope.schoolId) return { mode: 'empty' };
  const base: Filter = { ...filter, school_id: scope.schoolId };
  if (needsScan(scope.role, entity)) return { mode: 'scan', query: base };
  if (rule.rows === 'school') return { mode: 'push', query: base };

  // One branch: push every condition of it into the query itself, so limit
  // and skip count only rows the caller can see.
  const query: Filter = { ...base };
  // (A constant with orMissing can't be pushed safely — a missing field is
  // not a value to $in — so needsScan already sent that rule to scan mode.)
  for (const [field, cond] of Object.entries(rule.rows[0])) {
    const values = condValues(scope, cond);
    const narrowed = intersect(query[field], values);
    if (narrowed === undefined) return { mode: 'empty' };
    query[field] = narrowed;
  }
  return { mode: 'push', query };
}

// --- Execution ---------------------------------------------------------------

export type ReadResult = { ok: true; rows: Row[]; has_more: boolean; truncated?: boolean };

function handle(db: Db, entity: string) {
  const h = db?.entities?.[entity];
  if (!h || typeof h.filter !== 'function') throw new Error(`entity ${entity} unavailable`);
  return h;
}

/** Run a validated read for this scope. */
export async function executeRead(db: Db, scope: Scope, read: ValidRead): Promise<ReadResult> {
  const plan = planQuery(scope, read.entity, read.filter);
  if (plan.mode === 'empty') return { ok: true, rows: [], has_more: false };
  const h = handle(db, read.entity);

  if (plan.mode === 'push') {
    const raw: Row[] = (await h.filter(plan.query, read.sort, read.limit + 1, read.skip)) || [];
    const has_more = raw.length > read.limit;
    return { ok: true, rows: scopeRows(scope, read.entity, raw.slice(0, read.limit)), has_more };
  }

  // scan: walk the school's rows in the requested order, keep the visible ones.
  const need = read.skip + read.limit + 1;
  const visible: Row[] = [];
  let offset = 0;
  let truncated = false;
  while (visible.length < need) {
    if (offset >= SCAN_CAP) { truncated = true; break; }
    const page: Row[] = (await h.filter(plan.query, read.sort, SCAN_PAGE, offset)) || [];
    for (const row of page) if (rowVisible(scope, read.entity, row)) visible.push(row);
    offset += page.length;
    if (page.length < SCAN_PAGE) break;
  }
  const window = visible.slice(read.skip, read.skip + read.limit);
  const out: ReadResult = {
    ok: true,
    rows: window.map((row) => projectRow(scope, read.entity, row)),
    has_more: visible.length > read.skip + read.limit || truncated,
  };
  if (truncated) out.truncated = true;
  return out;
}

/** Load a scope set some rule needs but buildScope skips by default. */
export async function ensureScopeSets(db: Db, scope: Scope, entity: string): Promise<void> {
  const rule = roleRule(scope, entity);
  if (!rule) return;
  if (rule.members && rule.members.length && !scope.memberUserIds) {
    const profiles: Row[] = (await handle(db, 'UserProfile').filter(
      { school_id: scope.schoolId, status: 'ACTIVE' }, '-created_date', 5000)) || [];
    scope.memberUserIds = uniq(profiles.filter((p) => String(p.school_id) === scope.schoolId && p.status === 'ACTIVE')
      .map((p) => p.user_id));
  }
  if (rule.rows === 'school') return;
  const needsTickets = rule.rows.some((b) => Object.values(b).some((c) => 'set' in c && c.set === 'ticketIds'));
  if (needsTickets && !scope.ticketIds) {
    const own: Row[] = (await handle(db, 'SupportTicket').filter(
      { school_id: scope.schoolId, requester_user_id: scope.userId }, '-created_date', 5000)) || [];
    scope.ticketIds = own.filter((t) => String(t.school_id) === scope.schoolId && String(t.requester_user_id) === scope.userId)
      .map((t) => String(t.id));
  }
}

// --- Scope ------------------------------------------------------------------

export type ScopeBundle = { scope: Scope; students: Row[]; classrooms: Row[]; linkStudentIds: string[] };

const uniq = (values: unknown[]): string[] => [...new Set(values.map((v) => String(v ?? '')).filter(Boolean))];

/**
 * Re-derive what this caller can see, from their own profile and the school's
 * link tables — read with the service role, never from the request.
 *   ADMIN:   the whole school.
 *   TEACHER: classrooms with an active TeacherClassroom for them; the ACTIVE
 *            students of those classrooms.
 *   PARENT:  children with an ACTIVE ParentStudent link to them IN THIS
 *            SCHOOL (a Student of another school behind a stray link is
 *            dropped); those children's classrooms.
 * Also returns the Student rows it had to load anyway; the Classroom rows only
 * when asked (`withClassrooms`, for `context`), so a plain read costs no
 * extra query.
 */
export async function buildScope(
  db: Db, userId: string, profile: Profile, { withClassrooms = false }: { withClassrooms?: boolean } = {},
): Promise<ScopeBundle> {
  const schoolId = String(profile.school_id || '');
  const role = profile.app_role as Role;
  const scope: Scope = { userId, schoolId, role, profileId: profile.id ? String(profile.id) : undefined, classroomIds: [], studentIds: [] };
  let students: Row[] = [];
  let classrooms: Row[] = [];
  let linkStudentIds: string[] = [];

  if (role === 'PARENT') {
    const links: Row[] = (await handle(db, 'ParentStudent').filter(
      { parent_id: userId, school_id: schoolId, status: 'ACTIVE' }, '-created_date', 1000)) || [];
    linkStudentIds = uniq(links.filter((l) => String(l.school_id) === schoolId && String(l.parent_id) === userId
      && l.status === 'ACTIVE')
      .map((l) => l.student_id));
    if (linkStudentIds.length) {
      const rows: Row[] = (await handle(db, 'Student').filter(
        { school_id: schoolId, id: { $in: linkStudentIds } }, 'first_name', linkStudentIds.length)) || [];
      students = rows.filter((s) => String(s.school_id) === schoolId && linkStudentIds.includes(String(s.id)));
    }
    scope.studentIds = students.map((s) => String(s.id));
    scope.classroomIds = uniq(students.map((s) => s.classroom_id));
  } else if (role === 'TEACHER') {
    const assignments: Row[] = (await handle(db, 'TeacherClassroom').filter(
      { teacher_id: userId, school_id: schoolId }, '-created_date', 1000)) || [];
    scope.classroomIds = uniq(assignments
      .filter((a) => String(a.school_id) === schoolId && String(a.teacher_id) === userId && a.is_active !== false)
      .map((a) => a.classroom_id));
    if (scope.classroomIds.length) {
      const rows: Row[] = (await handle(db, 'Student').filter(
        { school_id: schoolId, classroom_id: { $in: scope.classroomIds } }, 'first_name', 5000)) || [];
      students = rows.filter((s) => String(s.school_id) === schoolId
        && scope.classroomIds.includes(String(s.classroom_id)) && s.is_active !== false);
    }
    scope.studentIds = students.map((s) => String(s.id));
  }

  if (withClassrooms && role !== 'ADMIN' && scope.classroomIds.length) {
    const rows: Row[] = (await handle(db, 'Classroom').filter(
      { school_id: schoolId, id: { $in: scope.classroomIds } }, 'name', scope.classroomIds.length)) || [];
    classrooms = rows.filter((c) => String(c.school_id) === schoolId && scope.classroomIds.includes(String(c.id)));
  }
  return { scope, students, classrooms, linkStudentIds };
}

/** What `context` returns: who the caller is here, and their linked records. */
export function describeScope(bundle: ScopeBundle): Row {
  const { scope } = bundle;
  return {
    role: scope.role,
    school_id: scope.schoolId,
    profile_id: scope.profileId || null,
    classroom_ids: scope.classroomIds,
    student_ids: scope.studentIds,
    // Only links that resolved to a Student of this school: a stray link's id
    // (a student of another school) never leaves.
    link_student_ids: bundle.linkStudentIds.filter((id) => scope.studentIds.includes(id)),
    students: scopeRows(scope, 'Student', bundle.students),
    classrooms: scopeRows(scope, 'Classroom', bundle.classrooms),
  };
}

/** Validate + load + execute one request. Refusals come back, never throw. */
export async function readFor(db: Db, scope: Scope, req: ReadRequest): Promise<ReadResult | Refusal> {
  const read = validateRead(scope, req);
  if (!read.ok) return read;
  await ensureScopeSets(db, scope, read.entity);
  return executeRead(db, scope, read);
}
