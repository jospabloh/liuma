import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// The function's own rules, loaded as-is (Node 22 strips the TS types).
import {
  READ_RULES, buildScope, readFor, validateRead, describeScope, rowVisible, projectRow,
  selectCurrentProfile, profileProblem, needsScan, MAX_LIMIT, MAX_SKIP, MAX_SCANS_PER_BATCH,
} from '../../base44/functions/schoolRead/_scope.ts';
import { selectCurrentUserProfile } from '../../src/lib/tenantSelection.js';
import { makeFakeDb } from '../fixtures/fake-entity-db.js';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// P10 (sales-readiness audit F01, 2026-09-29). School users read through the
// schoolRead function (and Lumi through lumiQuery), with the service role,
// scoped by _scope.ts. These tests run the real planner and executor against
// an in-memory database with two schools and several families, and try to
// cross every boundary the module promises to hold.

test('schoolRead, lumiQuery and lumiWrite carry byte-identical copies of _scope.ts', () => {
  const canonical = read('base44/functions/schoolRead/_scope.ts');
  assert.equal(read('base44/functions/lumiQuery/_scope.ts'), canonical);
  assert.equal(read('base44/functions/lumiWrite/_scope.ts'), canonical);
});

test('Lumi answers from the same rules: lumiQuery scopes rows with _scope.ts', () => {
  const core = read('base44/functions/lumiQuery/_lumiCore.ts');
  assert.match(core, /export \{[^}]*rowVisible[^}]*scopeRows[^}]*\} from '\.\/_scope\.ts'/);
  assert.doesNotMatch(core, /export function rowVisible/);
  const entry = read('base44/functions/lumiQuery/entry.ts');
  assert.match(entry, /import \{ buildScope \} from '\.\/_scope\.ts'/);
});

test('the function never takes the school from the request body', () => {
  const entry = read('base44/functions/schoolRead/entry.ts');
  assert.doesNotMatch(entry, /body\??\.(school_id|schoolId)/);
  assert.match(entry, /UserProfile\.filter\(\{ user_id: user\.id \}/);
  assert.match(entry, /selectCurrentProfile\(profiles\)/);
});

test('the current profile is the same deterministic pick as the front end', () => {
  const profiles = [
    { id: 'old', status: 'ACTIVE', onboarding_completed: true, created_date: '2026-01-01', school_id: 'A' },
    { id: 'new', status: 'ACTIVE', onboarding_completed: true, created_date: '2026-06-01', school_id: 'B' },
    { id: 'pending', status: 'PENDING', created_date: '2026-09-01', school_id: 'C' },
  ];
  for (const input of [profiles, [...profiles].reverse()]) {
    assert.equal(selectCurrentProfile(input).id, selectCurrentUserProfile(input).id);
  }
  assert.equal(profileProblem(null), 'NO_PROFILE');
  assert.equal(profileProblem({ status: 'PENDING', school_id: 'A', app_role: 'ADMIN' }), 'INACTIVE_PROFILE');
  assert.equal(profileProblem({ status: 'ACTIVE', school_id: 'A', app_role: 'OWNER' }), 'INVALID_ROLE');
});

test('every allowlisted entity and field exists in the entity schema', () => {
  for (const [entity, rule] of Object.entries(READ_RULES)) {
    const schema = read(`base44/entities/${entity}.jsonc`);
    for (const field of rule.fields) {
      assert.match(schema, new RegExp(`"${field}"\\s*:`), `${entity}.${field} is not in ${entity}.jsonc`);
    }
    assert.ok(rule.fields.includes('school_id'), `${entity} must be tenant-scoped by school_id`);
  }
});

// --- A two-school world -----------------------------------------------------

const t = (id, created) => ({ id, created_date: created || `2026-09-${String(10 + (id.length % 9)).padStart(2, '0')}T12:00:00Z` });

// `extra` rows are appended to the base tables (new tables are added).
function world(extra = {}) {
  const tables = {
    UserProfile: [
      { ...t('pAdminA'), user_id: 'adminA', school_id: 'A', app_role: 'ADMIN', status: 'ACTIVE', onboarding_completed: true, phone: '449-000-0001' },
      { ...t('pTeacherA'), user_id: 'teacherA', school_id: 'A', app_role: 'TEACHER', status: 'ACTIVE', onboarding_completed: true, phone: '449-000-0002' },
      { ...t('pParentA1'), user_id: 'parentA1', school_id: 'A', app_role: 'PARENT', status: 'ACTIVE', onboarding_completed: true, phone: '449-000-0003' },
      { ...t('pParentA2'), user_id: 'parentA2', school_id: 'A', app_role: 'PARENT', status: 'ACTIVE', onboarding_completed: true, phone: '449-000-0004' },
      { ...t('pPendingA'), user_id: 'pendingA', school_id: 'A', app_role: 'PARENT', status: 'PENDING', phone: '449-000-0005' },
      { ...t('pStray'), user_id: 'stray', school_id: 'A', app_role: 'PARENT', status: 'ACTIVE', onboarding_completed: true },
      { ...t('pAdminB'), user_id: 'adminB', school_id: 'B', app_role: 'ADMIN', status: 'ACTIVE', onboarding_completed: true, phone: '55-000-0001' },
    ],
    Classroom: [
      { ...t('cA1'), school_id: 'A', name: 'Maternal' },
      { ...t('cA2'), school_id: 'A', name: 'Kínder 1' },
      { ...t('cB1'), school_id: 'B', name: 'Salón B' },
    ],
    TeacherClassroom: [
      { ...t('tc1'), school_id: 'A', teacher_id: 'teacherA', classroom_id: 'cA1', is_active: true },
      { ...t('tc2'), school_id: 'A', teacher_id: 'teacherA', classroom_id: 'cA2', is_active: false },
      // A stray assignment row filed under school B must not widen school A.
      { ...t('tc3'), school_id: 'B', teacher_id: 'teacherA', classroom_id: 'cB1', is_active: true },
    ],
    Student: [
      { ...t('sA1'), school_id: 'A', classroom_id: 'cA1', first_name: 'Ana', last_name: 'Uno', allergies: 'nuez', medical_notes: 'asma', is_active: true },
      { ...t('sA2'), school_id: 'A', classroom_id: 'cA1', first_name: 'Beto', last_name: 'Dos', allergies: 'lácteos', is_active: true },
      { ...t('sA3'), school_id: 'A', classroom_id: 'cA2', first_name: 'Caro', last_name: 'Tres', is_active: true },
      { ...t('sB1'), school_id: 'B', classroom_id: 'cB1', first_name: 'Dani', last_name: 'Bé', medical_notes: 'epilepsia', is_active: true },
    ],
    ParentStudent: [
      { ...t('ps1'), school_id: 'A', parent_id: 'parentA1', student_id: 'sA1', status: 'ACTIVE' },
      { ...t('ps2'), school_id: 'A', parent_id: 'parentA2', student_id: 'sA3', status: 'ACTIVE' },
      { ...t('ps3'), school_id: 'A', parent_id: 'parentA2', student_id: 'sA2', status: 'REVOKED' },
      // A link row in school A pointing at a student of school B.
      { ...t('ps4'), school_id: 'A', parent_id: 'stray', student_id: 'sB1', status: 'ACTIVE' },
    ],
    EmergencyContact: [
      { ...t('ec1'), school_id: 'A', student_id: 'sA1', name: 'Abuela Uno', phone: '1', added_by_user_id: 'parentA1', created_by: 'parent1@example.com' },
      { ...t('ec2'), school_id: 'A', student_id: 'sA1', name: 'Tía Uno', phone: '2', added_by_user_id: 'adminA' },
      { ...t('ec3'), school_id: 'A', student_id: 'sA3', name: 'Abuelo Tres', phone: '3', added_by_user_id: 'parentA2' },
      { ...t('ec4'), school_id: 'B', student_id: 'sB1', name: 'Contacto B', phone: '4', added_by_user_id: 'x' },
    ],
    Notice: [
      { ...t('nSchool', '2026-09-20T10:00:00Z'), school_id: 'A', scope: 'SCHOOL', title: 'Junta', author_id: 'adminA' },
      { ...t('nLegacy', '2026-09-19T10:00:00Z'), school_id: 'A', title: 'Sin alcance (legado)', author_id: 'adminA' },
      { ...t('nClassA1', '2026-09-18T10:00:00Z'), school_id: 'A', scope: 'CLASSROOM', classroom_id: 'cA1', title: 'Maternal', author_id: 'teacherA' },
      { ...t('nClassA2', '2026-09-17T10:00:00Z'), school_id: 'A', scope: 'CLASSROOM', classroom_id: 'cA2', title: 'Kínder', author_id: 'adminA' },
      { ...t('nStudentA1', '2026-09-16T10:00:00Z'), school_id: 'A', scope: 'STUDENT', student_id: 'sA1', title: 'Para Ana', author_id: 'teacherA' },
      { ...t('nStudentA2', '2026-09-15T10:00:00Z'), school_id: 'A', scope: 'STUDENT', student_id: 'sA2', title: 'Para Beto', author_id: 'teacherA' },
      { ...t('nSchoolB', '2026-09-21T10:00:00Z'), school_id: 'B', scope: 'SCHOOL', title: 'Escuela B', author_id: 'adminB' },
    ],
    DiaryEntry: [
      { ...t('d1'), school_id: 'A', classroom_id: 'cA1', student_id: 'sA1', date: '2026-09-29', notified_parent_emails: ['parent1@example.com'], teacher_id: 'teacherA' },
      { ...t('d2'), school_id: 'A', classroom_id: 'cA1', student_id: 'sA2', date: '2026-09-29', teacher_id: 'teacherA' },
      { ...t('d3'), school_id: 'A', classroom_id: 'cA2', student_id: 'sA3', date: '2026-09-29', teacher_id: 'other' },
    ],
    Attendance: [
      { ...t('a1'), school_id: 'A', classroom_id: 'cA1', student_id: 'sA1', date: '2026-09-29', status: 'PRESENT' },
      { ...t('a3'), school_id: 'A', classroom_id: 'cA2', student_id: 'sA3', date: '2026-09-29', status: 'ABSENT' },
      { ...t('aB'), school_id: 'B', classroom_id: 'cB1', student_id: 'sB1', date: '2026-09-29', status: 'PRESENT' },
    ],
    ChargeItem: [
      { ...t('ch1'), school_id: 'A', student_id: 'sA1', amount: 100, status: 'PENDING' },
      { ...t('ch3'), school_id: 'A', student_id: 'sA3', amount: 300, status: 'PENDING' },
    ],
    OfficialDocument: [
      { ...t('docAll'), school_id: 'A', title: 'Menú', target_audience: 'TODOS' },
      { ...t('docParents'), school_id: 'A', title: 'Uniformes', target_audience: 'PADRES' },
      { ...t('docTeachers'), school_id: 'A', title: 'Minuta', target_audience: 'MAESTROS' },
      { ...t('docAdmins'), school_id: 'A', title: 'Interno', target_audience: 'ADMINS' },
      { ...t('docNoAudience'), school_id: 'A', title: 'Circular (legado)' },
    ],
    PermissionOverride: [
      { ...t('po1'), school_id: 'A', user_profile_id: 'pTeacherA', resource: 'Homework', action: 'write', effect: 'deny' },
      { ...t('po2'), school_id: 'A', user_profile_id: 'pOtherTeacher', resource: 'Notice', action: 'write', effect: 'deny' },
    ],
    SupportTicket: [
      { ...t('tk1'), school_id: 'A', requester_user_id: 'parentA1', subject: 'Pago', escalation_notified_recipients: ['owner@example.com'] },
      { ...t('tk2'), school_id: 'A', requester_user_id: 'parentA2', subject: 'Otro' },
    ],
    SupportTicketMessage: [
      { ...t('m1', '2026-09-20T01:00:00Z'), school_id: 'A', ticket_id: 'tk1', author_user_id: 'parentA1', author_role: 'REQUESTER', body: 'Hola' },
      { ...t('m2', '2026-09-20T02:00:00Z'), school_id: 'A', ticket_id: 'tk1', author_user_id: 'adminA', author_role: 'SCHOOL_ADMIN', body: 'Respuesta de la escuela' },
      { ...t('m3', '2026-09-20T03:00:00Z'), school_id: 'A', ticket_id: 'tk2', author_user_id: 'adminA', author_role: 'SCHOOL_ADMIN', body: 'Privado de otra familia' },
    ],
    AuditLog: [{ ...t('al1'), school_id: 'A', action: 'X' }],
    PendingChange: [{ ...t('pc1'), school_id: 'A', type: 'ROLE_CHANGE' }],
    Discount: [{ ...t('dc1'), school_id: 'A', name: 'Hermanos' }],
  };
  for (const [name, rows] of Object.entries(extra)) tables[name] = [...(tables[name] || []), ...rows];
  return makeFakeDb(tables);
}

async function scopeFor(db, userId, options) {
  const profiles = await db.entities.UserProfile.filter({ user_id: userId });
  const profile = selectCurrentProfile(profiles);
  assert.equal(profileProblem(profile), null);
  return buildScope(db, userId, profile, options);
}

async function rowsOf(db, userId, req) {
  const { scope } = await scopeFor(db, userId);
  const out = await readFor(db, scope, req);
  assert.equal(out.ok, true, `expected rows, got ${JSON.stringify(out)}`);
  return out.rows;
}

async function refusal(db, userId, req) {
  const { scope } = await scopeFor(db, userId);
  const out = await readFor(db, scope, req);
  assert.equal(out.ok, false, `expected a refusal, got ${out.rows?.length} rows`);
  return out;
}

const ids = (rows) => rows.map((r) => r.id).sort();

// --- Cross-tenant ----------------------------------------------------------

test('an ADMIN reads their whole school and never another', async () => {
  const db = world();
  assert.deepEqual(ids(await rowsOf(db, 'adminA', { entity: 'Student' })), ['sA1', 'sA2', 'sA3']);
  assert.deepEqual(ids(await rowsOf(db, 'adminB', { entity: 'Student' })), ['sB1']);
  // Naming the other school is refused, not silently answered.
  const out = await refusal(db, 'adminA', { entity: 'Student', filter: { school_id: 'B' } });
  assert.equal(out.code, 'SCHOOL_MISMATCH');
  assert.equal(out.status, 403);
  // …and so is every trick to widen the school clause.
  for (const school_id of [{ $ne: 'A' }, { $in: ['A', 'B'] }, { $nin: ['A'] }, ['A', 'B'], null]) {
    assert.equal((await refusal(db, 'adminA', { entity: 'Student', filter: { school_id } })).code, 'SCHOOL_MISMATCH');
  }
  // Asking for a school-B record by id from school A finds nothing.
  assert.deepEqual(await rowsOf(db, 'adminA', { entity: 'Student', filter: { id: 'sB1' } }), []);
  assert.deepEqual(await rowsOf(db, 'adminA', { entity: 'Notice', filter: { id: 'nSchoolB' } }), []);
});

test('every query the planner sends carries the caller\'s school', async () => {
  const db = world();
  await rowsOf(db, 'parentA1', { entity: 'Notice' });
  await rowsOf(db, 'teacherA', { entity: 'Attendance' });
  await rowsOf(db, 'adminA', { entity: 'EmergencyContact' });
  for (const call of db.calls) {
    if (call.entity === 'UserProfile' && call.query.user_id && !call.query.school_id) continue; // own profile lookup
    assert.equal(call.query.school_id, 'A', `${call.entity} query without the school clause: ${JSON.stringify(call.query)}`);
  }
});

// --- Cross-family / cross-classroom -----------------------------------------

test('a PARENT sees their own children only — never a classmate of the same classroom', async () => {
  const db = world();
  const own = await rowsOf(db, 'parentA1', { entity: 'Student' });
  assert.deepEqual(ids(own), ['sA1']);
  // The child's medical notes reach the child's own parent.
  assert.equal(own[0].medical_notes, 'asma');
  // Same classroom, another family: nothing.
  assert.deepEqual(ids(await rowsOf(db, 'parentA1', { entity: 'Student', filter: { classroom_id: 'cA1' } })), ['sA1']);
  assert.deepEqual(await rowsOf(db, 'parentA1', { entity: 'Student', filter: { id: 'sA2' } }), []);
  assert.deepEqual(await rowsOf(db, 'parentA1', { entity: 'Student', filter: { id: { $in: ['sA2', 'sA3', 'sB1'] } } }), []);
  // A REVOKED link grants nothing.
  assert.deepEqual(ids(await rowsOf(db, 'parentA2', { entity: 'Student' })), ['sA3']);
});

test('a PARENT reads family records of their own children only', async () => {
  const db = world();
  assert.deepEqual(ids(await rowsOf(db, 'parentA1', { entity: 'Attendance' })), ['a1']);
  assert.deepEqual(ids(await rowsOf(db, 'parentA1', { entity: 'DiaryEntry' })), ['d1']);
  assert.deepEqual(ids(await rowsOf(db, 'parentA1', { entity: 'ChargeItem' })), ['ch1']);
  assert.deepEqual(await rowsOf(db, 'parentA1', { entity: 'ChargeItem', filter: { student_id: 'sA3' } }), []);
  // Their children's emergency contacts — including one the school added.
  assert.deepEqual(ids(await rowsOf(db, 'parentA1', { entity: 'EmergencyContact' })), ['ec1', 'ec2']);
  assert.deepEqual(await rowsOf(db, 'parentA1', { entity: 'EmergencyContact', filter: { student_id: 'sA3' } }), []);
});

test('a stray link to a student of another school grants nothing', async () => {
  const db = world();
  const { scope, students } = await scopeFor(db, 'stray');
  assert.deepEqual(scope.studentIds, []);
  assert.deepEqual(students, []);
  assert.deepEqual(await rowsOf(db, 'stray', { entity: 'Student', filter: { id: 'sB1' } }), []);
  assert.deepEqual(await rowsOf(db, 'stray', { entity: 'Attendance' }), []);
});

test('a TEACHER sees their active classrooms only', async () => {
  const db = world();
  const { scope } = await scopeFor(db, 'teacherA');
  // tc2 is inactive; tc3 is filed under another school.
  assert.deepEqual(scope.classroomIds, ['cA1']);
  const students = await rowsOf(db, 'teacherA', { entity: 'Student' });
  assert.deepEqual(ids(students), ['sA1', 'sA2']);
  // A teacher sees the medical notes of their own students (safety), no one else's.
  assert.equal(students.find((s) => s.id === 'sA1').allergies, 'nuez');
  assert.deepEqual(await rowsOf(db, 'teacherA', { entity: 'Student', filter: { classroom_id: 'cA2' } }), []);
  assert.deepEqual(ids(await rowsOf(db, 'teacherA', { entity: 'Attendance' })), ['a1']);
  assert.deepEqual(ids(await rowsOf(db, 'teacherA', { entity: 'DiaryEntry' })), ['d1', 'd2']);
  // Not a family's money, not the school's governance.
  for (const entity of ['ChargeItem', 'EmergencyContact', 'AuditLog', 'PendingChange', 'Discount', 'PaymentConcept', 'SchoolSetupGuide']) {
    assert.equal((await refusal(db, 'teacherA', { entity })).code, 'NOT_ALLOWED_FOR_ROLE', entity);
  }
});

test('notices reach their audience: school-wide, own classroom, own child', async () => {
  const db = world();
  assert.deepEqual(ids(await rowsOf(db, 'parentA1', { entity: 'Notice' })),
    ['nClassA1', 'nLegacy', 'nSchool', 'nStudentA1']);
  assert.deepEqual(ids(await rowsOf(db, 'parentA2', { entity: 'Notice' })),
    ['nClassA2', 'nLegacy', 'nSchool']);
  // A teacher: school-wide + their classroom + their students + what they wrote.
  assert.deepEqual(ids(await rowsOf(db, 'teacherA', { entity: 'Notice' })),
    ['nClassA1', 'nLegacy', 'nSchool', 'nStudentA1', 'nStudentA2']);
  // Filtering by another family's student notice still yields nothing.
  assert.deepEqual(await rowsOf(db, 'parentA1', { entity: 'Notice', filter: { student_id: 'sA2' } }), []);
});

test('scan-mode reads keep order, limit and skip over visible rows only', async () => {
  const db = world();
  const { scope } = await scopeFor(db, 'parentA1');
  const first = await readFor(db, scope, { entity: 'Notice', sort: '-created_date', limit: 2 });
  assert.deepEqual(first.rows.map((r) => r.id), ['nSchool', 'nLegacy']);
  assert.equal(first.has_more, true);
  const second = await readFor(db, scope, { entity: 'Notice', sort: '-created_date', limit: 2, skip: 2 });
  assert.deepEqual(second.rows.map((r) => r.id), ['nClassA1', 'nStudentA1']);
  assert.equal(second.has_more, false);
});

test('documents follow their audience', async () => {
  const db = world();
  assert.deepEqual(ids(await rowsOf(db, 'parentA1', { entity: 'OfficialDocument' })), ['docAll', 'docNoAudience', 'docParents']);
  assert.deepEqual(ids(await rowsOf(db, 'teacherA', { entity: 'OfficialDocument' })), ['docAll', 'docNoAudience', 'docTeachers']);
  assert.equal((await rowsOf(db, 'adminA', { entity: 'OfficialDocument' })).length, 5);
});

test('a requester reads the whole thread of their own ticket, staff replies included — and no other', async () => {
  const db = world();
  const thread = await rowsOf(db, 'parentA1', { entity: 'SupportTicketMessage', filter: { ticket_id: 'tk1' }, sort: 'created_date' });
  assert.deepEqual(thread.map((m) => m.id), ['m1', 'm2']);
  assert.equal(thread[1].author_role, 'SCHOOL_ADMIN');
  assert.deepEqual(await rowsOf(db, 'parentA1', { entity: 'SupportTicketMessage', filter: { ticket_id: 'tk2' } }), []);
  assert.deepEqual(ids(await rowsOf(db, 'parentA1', { entity: 'SupportTicketMessage' })), ['m1', 'm2']);
  // The ticket itself, without who else was alerted about it.
  const tickets = await rowsOf(db, 'parentA1', { entity: 'SupportTicket' });
  assert.deepEqual(ids(tickets), ['tk1']);
  assert.equal('escalation_notified_recipients' in tickets[0], false);
  // The school's director sees every thread of the school.
  assert.equal((await rowsOf(db, 'adminA', { entity: 'SupportTicketMessage' })).length, 3);
});

test('permission overrides: a user sees only their own', async () => {
  const db = world();
  assert.deepEqual(ids(await rowsOf(db, 'teacherA', { entity: 'PermissionOverride' })), ['po1']);
  assert.deepEqual(ids(await rowsOf(db, 'adminA', { entity: 'PermissionOverride' })), ['po1', 'po2']);
});

// --- Projection -------------------------------------------------------------

test('hidden fields never leave, and cannot be filtered or sorted on', async () => {
  const db = world();
  const teacherView = await rowsOf(db, 'teacherA', { entity: 'UserProfile' });
  // Active members only; no phones, no pending applicants.
  assert.ok(teacherView.every((p) => p.status === 'ACTIVE' && !('phone' in p)));
  assert.ok(!teacherView.some((p) => p.id === 'pPendingA' || p.school_id !== 'A'));
  assert.equal((await refusal(db, 'teacherA', { entity: 'UserProfile', filter: { phone: '449-000-0003' } })).code, 'FIELD_NOT_ALLOWED');
  assert.equal((await refusal(db, 'teacherA', { entity: 'UserProfile', sort: 'phone' })).code, 'INVALID_SORT');
  // A parent sees only their own profile.
  assert.deepEqual(ids(await rowsOf(db, 'parentA1', { entity: 'UserProfile' })), ['pParentA1']);
  // Parents' addresses on a diary entry, and another adult's creator email.
  const diary = await rowsOf(db, 'parentA1', { entity: 'DiaryEntry' });
  assert.equal('notified_parent_emails' in diary[0], false);
  const contacts = await rowsOf(db, 'parentA1', { entity: 'EmergencyContact' });
  assert.ok(contacts.every((c) => !('created_by' in c)));
  // The director keeps them.
  const adminDiary = await rowsOf(db, 'adminA', { entity: 'DiaryEntry', filter: { id: 'd1' } });
  assert.deepEqual(adminDiary[0].notified_parent_emails, ['parent1@example.com']);
  assert.equal(projectRow({ role: 'ADMIN', schoolId: 'A' }, 'EmergencyContact', { created_by: 'x' }).created_by, 'x');
});

// --- Filter injection ---------------------------------------------------------

test('filters can only narrow: unknown fields and operators are refused', () => {
  const scope = { userId: 'u', schoolId: 'A', role: 'PARENT', classroomIds: ['cA1'], studentIds: ['sA1'] };
  const code = (req) => validateRead(scope, { entity: 'Attendance', ...req }).code;
  assert.equal(code({ filter: { $or: [{ school_id: 'B' }] } }), 'INVALID_FILTER');
  assert.equal(code({ filter: { $and: [{}] } }), 'INVALID_FILTER');
  assert.equal(code({ filter: { student_id: { $regex: '.*' } } }), 'INVALID_FILTER');
  assert.equal(code({ filter: { student_id: { $exists: true } } }), 'INVALID_FILTER');
  assert.equal(code({ filter: { student_id: { $not: { $eq: 'x' } } } }), 'INVALID_FILTER');
  assert.equal(code({ filter: { student_id: { $in: [{ $ne: null }] } } }), 'INVALID_FILTER');
  assert.equal(code({ filter: { student_id: { nested: 'object' } } }), 'INVALID_FILTER');
  assert.equal(code({ filter: { 'data.school_id': 'B' } }), 'FIELD_NOT_ALLOWED');
  assert.equal(code({ filter: { created_by_id: 'u' } }), 'FIELD_NOT_ALLOWED');
  assert.equal(code({ filter: JSON.parse('{"__proto__": {"x": 1}}') }), 'FIELD_NOT_ALLOWED');
  assert.equal(code({ filter: 'school_id=B' }), 'INVALID_FILTER');
  assert.equal(code({ sort: { $natural: 1 } }), 'INVALID_SORT');
  assert.equal(code({ skip: MAX_SKIP + 1 }), 'INVALID_SKIP');
  assert.equal(code({ limit: -1 }), 'INVALID_LIMIT');
  assert.equal(validateRead(scope, { entity: 'Attendance', limit: 99999 }).limit, MAX_LIMIT);
  assert.equal(validateRead(scope, { entity: 'User' }).code, 'UNKNOWN_ENTITY');
  assert.equal(validateRead(scope, { entity: 'SchoolSubscription' }).code, 'UNKNOWN_ENTITY');
  assert.equal(validateRead(scope, { entity: 'constructor' }).code, 'UNKNOWN_ENTITY');
  assert.equal(validateRead(scope, { entity: 'AuditLog' }).code, 'NOT_ALLOWED_FOR_ROLE');
  // Allowed shapes pass through normalized.
  const ok = validateRead(scope, { entity: 'Attendance', filter: { school_id: 'A', student_id: ['sA1'], date: { $gte: '2026-09-01', $lte: '2026-09-30' } } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.filter, { student_id: { $in: ['sA1'] }, date: { $gte: '2026-09-01', $lte: '2026-09-30' } });
});

test('a narrowing operator on a scoped field cannot escape the role clause', async () => {
  const db = world();
  // $ne / $nin on the field the parent is scoped by still intersect with the children.
  assert.deepEqual(ids(await rowsOf(db, 'parentA1', { entity: 'Attendance', filter: { student_id: { $ne: 'nobody' } } })), ['a1']);
  assert.deepEqual(ids(await rowsOf(db, 'parentA1', { entity: 'Attendance', filter: { student_id: { $nin: [] } } })), ['a1']);
  assert.deepEqual(ids(await rowsOf(db, 'teacherA', { entity: 'Student', filter: { classroom_id: { $gte: '' } } })), ['sA1', 'sA2']);
});

// --- context ------------------------------------------------------------------

test('context describes the caller from the server\'s own derivation', async () => {
  const db = world();
  const parent = describeScope(await scopeFor(db, 'parentA1', { withClassrooms: true }));
  assert.equal(parent.role, 'PARENT');
  assert.equal(parent.school_id, 'A');
  assert.deepEqual(parent.link_student_ids, ['sA1']);
  assert.deepEqual(parent.students.map((s) => s.id), ['sA1']);
  assert.deepEqual(parent.classrooms.map((c) => c.id), ['cA1']);
  const teacher = describeScope(await scopeFor(db, 'teacherA'));
  assert.deepEqual(teacher.classroom_ids, ['cA1']);
  assert.deepEqual(teacher.students.map((s) => s.id).sort(), ['sA1', 'sA2']);
  const admin = describeScope(await scopeFor(db, 'adminA'));
  assert.deepEqual(admin.students, []);
});

test('rowVisible rejects anything without the caller\'s school', () => {
  const admin = { userId: 'a', schoolId: 'A', role: 'ADMIN', classroomIds: [], studentIds: [] };
  assert.equal(rowVisible(admin, 'Student', { school_id: 'A' }), true);
  assert.equal(rowVisible(admin, 'Student', { school_id: 'B' }), false);
  assert.equal(rowVisible(admin, 'Student', { id: 'no-school' }), false);
  assert.equal(rowVisible({ ...admin, schoolId: '' }, 'Student', { school_id: '' }), false);
  assert.equal(rowVisible(admin, 'Nope', { school_id: 'A' }), false);
});

// --- Review follow-ups (2026-09-29) -------------------------------------------

test('a row an outsider filed with another school\'s school_id never reaches that school\'s staff', async () => {
  // SupportTicket/NoticeDelivery create RLS pins only the requester/recipient
  // to the caller, so school_id is theirs to choose. adminB is a member of B only.
  const db = world({
    SupportTicket: [{ ...t('tkForged'), school_id: 'A', requester_user_id: 'adminB', subject: 'Falso' }],
    NoticeDelivery: [
      { ...t('nd1'), school_id: 'A', notice_id: 'nSchool', recipient_user_id: 'parentA1', student_id: 'sA1', status: 'SENT' },
      { ...t('ndForged'), school_id: 'A', notice_id: 'nSchool', recipient_user_id: 'adminB', student_id: 'sA1', status: 'SENT' },
      { ...t('ndPending'), school_id: 'A', notice_id: 'nSchool', recipient_user_id: 'pendingA', student_id: 'sA1', status: 'SENT' },
    ],
  });
  assert.deepEqual(ids(await rowsOf(db, 'adminA', { entity: 'SupportTicket' })), ['tk1', 'tk2']);
  assert.deepEqual(ids(await rowsOf(db, 'adminA', { entity: 'NoticeDelivery' })), ['nd1']);
  assert.deepEqual(ids(await rowsOf(db, 'teacherA', { entity: 'NoticeDelivery' })), ['nd1']);
  // Nor does the forger, reading from their own school B.
  assert.deepEqual(ids(await rowsOf(db, 'adminB', { entity: 'NoticeDelivery' })), []);
  // A member check that never loaded fails closed.
  const bare = { userId: 'adminA', schoolId: 'A', role: 'ADMIN', classroomIds: [], studentIds: [] };
  assert.equal(rowVisible(bare, 'SupportTicket', { school_id: 'A', requester_user_id: 'parentA1' }), false);
});

test('a TEACHER sees a diary/attendance row only when its student is in their classroom', async () => {
  // Filed under the teacher's classroom cA1, but naming sA3 (of cA2).
  const db = world({
    DiaryEntry: [{ ...t('dMisfiled'), school_id: 'A', classroom_id: 'cA1', student_id: 'sA3', date: '2026-09-29', parent_notes: 'privado' }],
    Attendance: [{ ...t('aMisfiled'), school_id: 'A', classroom_id: 'cA1', student_id: 'sA3', date: '2026-09-29', status: 'ABSENT' }],
  });
  assert.deepEqual(ids(await rowsOf(db, 'teacherA', { entity: 'DiaryEntry' })), ['d1', 'd2']);
  assert.deepEqual(ids(await rowsOf(db, 'teacherA', { entity: 'Attendance' })), ['a1']);
});

test('a TEACHER does not keep a withdrawn student (or their medical notes) on the list', async () => {
  const db = world({ Student: [{ ...t('sA4'), school_id: 'A', classroom_id: 'cA1', first_name: 'Eva', medical_notes: 'x', is_active: false }] });
  assert.deepEqual(ids(await rowsOf(db, 'teacherA', { entity: 'Student' })), ['sA1', 'sA2']);
  assert.deepEqual(await rowsOf(db, 'teacherA', { entity: 'Student', filter: { id: 'sA4' } }), []);
});

test('a PARENT link that is not ACTIVE grants nothing, even if the store ignored the status filter', async () => {
  const db = world();
  const original = db.entities.ParentStudent.filter;
  // Simulate an engine that drops the status clause.
  db.entities.ParentStudent.filter = (query, ...rest) => {
    const { status: _ignored, ...loose } = query || {};
    return original(loose, ...rest);
  };
  const { scope } = await scopeFor(db, 'parentA2');
  assert.deepEqual(scope.studentIds, ['sA3']);
});

test('context never returns the id of a stray link\'s student', async () => {
  const db = world();
  assert.deepEqual(describeScope(await scopeFor(db, 'stray')).link_student_ids, []);
});

test('non-ADMIN output is an allowlist: undeclared properties never leave', async () => {
  const db = world({
    EmergencyContact: [{ ...t('ecX'), school_id: 'A', student_id: 'sA1', name: 'X', created_by_id: 'u-secret', legacy_ssn: '123' }],
  });
  const row = (await rowsOf(db, 'parentA1', { entity: 'EmergencyContact', filter: { id: 'ecX' } }))[0];
  assert.equal(row.name, 'X');
  assert.equal(row.id, 'ecX');
  assert.ok(row.created_date);
  assert.equal('created_by_id' in row, false);
  assert.equal('legacy_ssn' in row, false);
  // The director still gets the stored row.
  const adminRow = (await rowsOf(db, 'adminA', { entity: 'EmergencyContact', filter: { id: 'ecX' } }))[0];
  assert.equal(adminRow.created_by_id, 'u-secret');
});

test('a school ADMIN does not read the IP address in the audit log', async () => {
  const db = world({ AuditLog: [{ ...t('alIp'), school_id: 'A', action: 'Y', ip_address: '10.0.0.1', user_email: 'owner@example.com' }] });
  const rows = await rowsOf(db, 'adminA', { entity: 'AuditLog', filter: { id: 'alIp' } });
  assert.equal('ip_address' in rows[0], false);
  assert.equal((await refusal(db, 'adminA', { entity: 'AuditLog', filter: { ip_address: '10.0.0.1' } })).code, 'FIELD_NOT_ALLOWED');
});

test('scan-mode rules are the ones the batch cap counts', () => {
  assert.equal(needsScan('PARENT', 'Notice'), true);
  assert.equal(needsScan('TEACHER', 'Event'), true);
  assert.equal(needsScan('PARENT', 'OfficialDocument'), true);
  assert.equal(needsScan('ADMIN', 'SupportTicket'), true);
  assert.equal(needsScan('ADMIN', 'Student'), false);
  assert.equal(needsScan('PARENT', 'Attendance'), false);
  assert.equal(needsScan('TEACHER', 'UserProfile'), false);
  assert.ok(MAX_SCANS_PER_BATCH >= 2, 'OperacionDiaria/TeacherHome batch two scan reads');
  const entry = read('base44/functions/schoolRead/entry.ts');
  assert.match(entry, /needsScan\(scope\.role/);
  assert.match(entry, /TOO_MANY_SCANS/);
  // A 500 never echoes the raw error.
  assert.doesNotMatch(entry, /error: \(e as Error\)\.message/);
});
