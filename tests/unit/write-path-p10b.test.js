import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeFakeDb } from '../fixtures/fake-entity-db.js';
// The real function code, loaded as-is (Node 22 strips the TS types).
import { runSchoolWrite } from '../../base44/functions/guardedEntityWrite/_schoolWrite.ts';
import {
  SCHOOL_WRITES,
  POLICY_WRITE,
  decideCreateTargets,
  guardedWriteTable,
  selectCurrentProfile as writeSelect,
  profileProblem as writeProblem,
  supportRouting,
  supportSlaDueAt,
} from '../../base44/functions/guardedEntityWrite/_policy.ts';
import { selectCurrentProfile as readSelect, profileProblem as readProblem } from '../../base44/functions/schoolRead/_scope.ts';
import { GUARDED_WRITE_ROLES, canGuardedWrite } from '../../src/lib/authorization/guardedWritePolicy.js';
import { resolveSupportRouting } from '../../src/lib/support/routing.js';
import { computeSlaDueAt } from '../../src/lib/support/sla.js';

// P10b (2026-09-29). Every school entity whose deployed RLS is platform-owner
// only is written through guardedEntityWrite, which re-derives the caller's
// school and role from their own current UserProfile. These tests run the
// real write path (runSchoolWrite) against an in-memory database with two
// schools, and pin that the client can no longer reach those entities
// directly.

const ROOT = new URL('../../', import.meta.url);
const NOW = new Date('2026-09-29T15:00:00.000Z');
const PLATFORM_ONLY = { user_condition: { role: 'admin' } };

function read(rel) {
  return fs.readFileSync(new URL(rel, ROOT), 'utf8');
}
function readJsonc(rel) {
  return JSON.parse(read(rel).replace(/^\s*\/\/.*$/gm, ''));
}

const USERS = {
  adminA: { id: 'u-adminA', full_name: 'Directora A', email: 'a@a.mx' },
  teacherA: { id: 'u-teacherA', full_name: 'Maestra A', email: 't@a.mx' },
  parentA: { id: 'u-parentA', full_name: 'Mamá A', email: 'p@a.mx' },
  parentA2: { id: 'u-parentA2', full_name: 'Papá A2', email: 'p2@a.mx' },
  adminB: { id: 'u-adminB', full_name: 'Director B', email: 'a@b.mx' },
  parentB: { id: 'u-parentB', full_name: 'Mamá B', email: 'p@b.mx' },
  pending: { id: 'u-pending', full_name: 'Nuevo', email: 'n@a.mx' },
  stranger: { id: 'u-stranger', full_name: 'Nadie', email: 'x@x.mx' },
  owner: { id: 'u-owner', role: 'admin', full_name: 'Plataforma', email: 'o@liuma.mx' },
};

const profile = (id, userId, schoolId, role, status = 'ACTIVE') => ({
  id, user_id: userId, school_id: schoolId, app_role: role, status, onboarding_completed: true, created_date: '2026-09-01T00:00:00Z',
});

function freshDb({ subscriptions } = {}) {
  return makeFakeDb({
    UserProfile: [
      profile('p-adminA', 'u-adminA', 'sA', 'ADMIN'),
      profile('p-teacherA', 'u-teacherA', 'sA', 'TEACHER'),
      profile('p-parentA', 'u-parentA', 'sA', 'PARENT'),
      profile('p-parentA2', 'u-parentA2', 'sA', 'PARENT'),
      profile('p-adminB', 'u-adminB', 'sB', 'ADMIN'),
      profile('p-parentB', 'u-parentB', 'sB', 'PARENT'),
      profile('p-pending', 'u-pending', 'sA', 'TEACHER', 'PENDING'),
    ],
    SchoolSubscription: subscriptions || [
      { id: 'subA', school_id: 'sA', subscription_status: 'active', license_tier: 'growth' },
      { id: 'subB', school_id: 'sB', subscription_status: 'active', license_tier: 'growth' },
    ],
    Classroom: [
      { id: 'cA1', school_id: 'sA', name: '1A', is_active: true },
      { id: 'cA2', school_id: 'sA', name: '2A', is_active: true },
      { id: 'cB1', school_id: 'sB', name: '1B', is_active: true },
    ],
    Student: [
      { id: 'stuA1', school_id: 'sA', classroom_id: 'cA1', first_name: 'Ana', last_name: 'A', is_active: true },
      { id: 'stuA2', school_id: 'sA', classroom_id: 'cA2', first_name: 'Beto', last_name: 'A', is_active: true },
      { id: 'stuA3', school_id: 'sA', classroom_id: 'cA1', first_name: 'Caro', last_name: 'A', is_active: false },
      { id: 'stuB1', school_id: 'sB', classroom_id: 'cB1', first_name: 'Dani', last_name: 'B', is_active: true },
    ],
    TeacherClassroom: [{ id: 'tcA1', school_id: 'sA', teacher_id: 'u-teacherA', classroom_id: 'cA1', is_active: true }],
    ParentStudent: [
      { id: 'psA1', school_id: 'sA', parent_id: 'u-parentA', student_id: 'stuA1', status: 'ACTIVE' },
      { id: 'psA3', school_id: 'sA', parent_id: 'u-parentA2', student_id: 'stuA3', status: 'ACTIVE' },
      { id: 'psA2r', school_id: 'sA', parent_id: 'u-parentA2', student_id: 'stuA2', status: 'REVOKED' },
      // A forged/legacy link claiming school B for a school-A child.
      { id: 'psX', school_id: 'sB', parent_id: 'u-parentB', student_id: 'stuA2', status: 'ACTIVE' },
      { id: 'psB1', school_id: 'sB', parent_id: 'u-parentB', student_id: 'stuB1', status: 'ACTIVE' },
    ],
    Notice: [
      { id: 'nA1', school_id: 'sA', scope: 'CLASSROOM', classroom_id: 'cA1', author_id: 'u-teacherA', priority: 'URGENT', sent_at: '2026-09-29T14:00:00.000Z' },
      { id: 'nA2', school_id: 'sA', scope: 'SCHOOL', author_id: 'u-adminA', priority: 'NORMAL' },
      { id: 'nB1', school_id: 'sB', scope: 'SCHOOL', author_id: 'u-adminB', priority: 'NORMAL' },
    ],
    NoticeDelivery: [
      { id: 'dA1', school_id: 'sA', notice_id: 'nA2', recipient_user_id: 'u-parentA', student_id: 'stuA1', status: 'SENT' },
    ],
    Event: [
      { id: 'eA1', school_id: 'sA', title: 'Festival', date: '2026-10-10', scope: 'SCHOOL' },
      { id: 'eB1', school_id: 'sB', title: 'Kermés', date: '2026-10-11', scope: 'SCHOOL' },
    ],
    SupportTicket: [
      { id: 'tA1', school_id: 'sA', requester_user_id: 'u-parentA', tier: 'SCHOOL_ADMIN', status: 'ESCALATED', priority: 'NORMAL' },
      { id: 'tA2', school_id: 'sA', requester_user_id: 'u-adminA', tier: 'PLATFORM', status: 'ESCALATED', priority: 'NORMAL' },
    ],
    PermissionOverride: [
      { id: 'poA', school_id: 'sA', user_profile_id: 'p-teacherA', resource: 'Homework', action: 'write', effect: 'deny' },
      { id: 'poB', school_id: 'sB', user_profile_id: 'p-parentB', resource: 'Notice', action: 'write', effect: 'deny' },
    ],
    AbsenceNotification: [
      { id: 'abA', school_id: 'sA', student_id: 'stuA1', parent_id: 'u-parentA', status: 'PENDING' },
      { id: 'abB', school_id: 'sB', student_id: 'stuB1', parent_id: 'u-parentB', status: 'PENDING' },
    ],
    UniformOrder: [],
    Discount: [],
    OfficialDocument: [],
    SchoolSetupGuide: [{ id: 'sgA', school_id: 'sA', step_number: 1, step_name: 'Paso', category: 'GENERAL', is_completed: false }],
    PendingChange: [],
    AuditLog: [],
  });
}

// runSchoolWrite takes the service-role client (`sr.entities[Name]`).
async function write(userKey, body, db = freshDb()) {
  const result = await runSchoolWrite({ sr: { entities: db.entities }, user: USERS[userKey], body, now: NOW });
  return { ...result, db, dataWrites: db.writes.filter((w) => w.entity !== 'AuditLog') };
}

// --- who and where --------------------------------------------------------

test('a school ADMIN creates a classroom in THEIR school without naming it', async () => {
  const r = await write('adminA', { entity: 'Classroom', operation: 'create', data: { name: '3A', grade: '3' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.record.school_id, 'sA');
  assert.equal(r.body.record.is_active, true);
  const audit = r.db.writes.find((w) => w.entity === 'AuditLog');
  assert.equal(audit.data.action, 'RECORD_CREATED');
  assert.equal(audit.data.school_id, 'sA');
});

test('a forged school_id is refused, never honored — on create', async () => {
  for (const [entity, data] of [
    ['Classroom', { name: 'X', school_id: 'sB' }],
    ['Event', { title: 'X', date: '2026-10-01', school_id: 'sB' }],
    ['SupportTicket', { ticket_number: 'T-1', subject: 'Ayuda', school_id: 'sB' }],
    ['NoticeDelivery', { notice_id: 'nA2', school_id: 'sB' }],
  ]) {
    const who = entity === 'SupportTicket' ? 'parentA' : 'adminA';
    const r = await write(who, { entity, operation: 'create', data });
    assert.equal(r.status, 403, entity);
    assert.equal(r.body.code, 'SCHOOL_MISMATCH', entity);
    assert.deepEqual(r.dataWrites, [], entity);
  }
});

test('update/delete take the school from the STORED record and it must be the caller\'s', async () => {
  let r = await write('adminA', { entity: 'Classroom', operation: 'update', id: 'cB1', data: { name: 'mío' } });
  assert.equal(r.body.code, 'SCHOOL_MISMATCH');
  r = await write('adminA', { entity: 'Event', operation: 'delete', id: 'eB1' });
  assert.equal(r.body.code, 'SCHOOL_MISMATCH');
  r = await write('adminA', { entity: 'AbsenceNotification', operation: 'update', id: 'abB', data: { status: 'APPROVED' } });
  assert.equal(r.body.code, 'SCHOOL_MISMATCH');
  assert.deepEqual(r.dataWrites, []);
});

test('an update cannot move a record to another school or re-point a grant', async () => {
  const db = freshDb();
  let r = await write('adminA', { entity: 'Student', operation: 'update', id: 'stuA1', data: { school_id: 'sB', first_name: 'Ana María', created_by: 'x' } }, db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.dataWrites.at(-1).data, { first_name: 'Ana María' });
  r = await write('adminA', { entity: 'TeacherClassroom', operation: 'update', id: 'tcA1', data: { teacher_id: 'u-adminA', classroom_id: 'cA2', is_active: false } }, db);
  assert.equal(r.status, 200);
  assert.deepEqual(r.dataWrites.at(-1).data, { is_active: false });
});

test('no usable profile, no write — and the profile is the current one, not one the body picks', async () => {
  let r = await write('pending', { entity: 'Classroom', operation: 'create', data: { name: 'X' } });
  assert.equal(r.body.code, 'INACTIVE_PROFILE');
  r = await write('stranger', { entity: 'SupportTicket', operation: 'create', data: { ticket_number: 'T', subject: 'x', school_id: 'sA' } });
  assert.equal(r.body.code, 'NO_PROFILE');
  assert.deepEqual(r.dataWrites, []);
});

// --- roles -----------------------------------------------------------------

test('teachers and parents cannot write staff entities', async () => {
  const cases = [
    ['Classroom', { name: 'X' }],
    ['Student', { first_name: 'X', last_name: 'Y' }],
    ['TeacherClassroom', { teacher_id: 'u-teacherA', classroom_id: 'cA2' }], // a teacher assigning themselves
    ['ParentStudent', { parent_id: 'u-parentA', student_id: 'stuA2' }], // a parent claiming another child
    ['Event', { title: 'X', date: '2026-10-01' }],
    ['Discount', { name: 'X', discount_type: 'FIXED_AMOUNT', discount_value: 100 }],
    ['OfficialDocument', { title: 'X', document_type: 'MENU', file_url: 'https://f/x.pdf' }],
    ['SchoolSetupGuide', { step_number: 1, step_name: 'X', category: 'GENERAL' }],
    ['PermissionOverride', { user_profile_id: 'p-teacherA', resource: 'Homework', action: 'write', effect: 'allow' }],
    ['PendingChange', { target_profile_id: 'p-teacherA', payload: { override_id: 'poA' } }],
  ];
  for (const who of ['teacherA', 'parentA']) {
    for (const [entity, data] of cases) {
      const r = await write(who, { entity, operation: 'create', data });
      assert.equal(r.status, 403, `${who} ${entity}`);
      assert.equal(r.body.code, 'FORBIDDEN', `${who} ${entity}`);
      assert.deepEqual(r.dataWrites, [], `${who} ${entity}`);
    }
  }
  const r = await write('parentA', { entity: 'NoticeDelivery', operation: 'create', data: { notice_id: 'nA2' } });
  assert.equal(r.body.code, 'FORBIDDEN');
  const review = await write('teacherA', { entity: 'AbsenceNotification', operation: 'update', id: 'abA', data: { status: 'APPROVED' } });
  assert.equal(review.body.code, 'FORBIDDEN');
});

test('students and classrooms are retired, never deleted', async () => {
  for (const entity of ['Student', 'Classroom', 'TeacherClassroom', 'ParentStudent']) {
    const r = await write('adminA', { entity, operation: 'delete', id: 'x' });
    assert.equal(r.status, 400, entity);
    assert.equal(r.body.code, 'BAD_OPERATION', entity);
  }
});

// --- references --------------------------------------------------------------

test('every referenced id must belong to the same school', async () => {
  const cases = [
    [{ entity: 'Student', data: { first_name: 'X', last_name: 'Y', classroom_id: 'cB1' } }, 'REFERENCE_NOT_IN_SCHOOL'],
    [{ entity: 'ParentStudent', data: { parent_id: 'u-parentA', student_id: 'stuB1' } }, 'STUDENT_NOT_IN_SCHOOL'],
    [{ entity: 'ParentStudent', data: { parent_id: 'u-parentB', student_id: 'stuA1' } }, 'USER_NOT_IN_SCHOOL'],
    // right school, wrong role: a teacher is not a parent
    [{ entity: 'ParentStudent', data: { parent_id: 'u-teacherA', student_id: 'stuA1' } }, 'USER_NOT_IN_SCHOOL'],
    // not ACTIVE yet
    [{ entity: 'TeacherClassroom', data: { teacher_id: 'u-pending', classroom_id: 'cA1' } }, 'USER_NOT_IN_SCHOOL'],
    [{ entity: 'TeacherClassroom', data: { teacher_id: 'u-teacherA', classroom_id: 'cB1' } }, 'REFERENCE_NOT_IN_SCHOOL'],
    [{ entity: 'Event', data: { title: 'X', date: '2026-10-01', scope: 'CLASSROOM', classroom_id: 'cB1' } }, 'REFERENCE_NOT_IN_SCHOOL'],
    [{ entity: 'PermissionOverride', data: { user_profile_id: 'p-parentB', resource: 'Notice', action: 'write', effect: 'allow' } }, 'REFERENCE_NOT_IN_SCHOOL'],
    [{ entity: 'PendingChange', data: { target_profile_id: 'p-parentB', payload: { override_id: 'poB' } } }, 'REFERENCE_NOT_IN_SCHOOL'],
    // an override of this school, but aimed at someone else
    [{ entity: 'PendingChange', data: { target_profile_id: 'p-parentA', payload: { override_id: 'poA' } } }, 'REFERENCE_NOT_IN_SCHOOL'],
  ];
  for (const [body, code] of cases) {
    const r = await write('adminA', { ...body, operation: 'create' });
    assert.equal(r.status, 400, `${body.entity} ${JSON.stringify(body.data)}`);
    assert.equal(r.body.code, code, `${body.entity} ${JSON.stringify(body.data)}`);
    assert.deepEqual(r.dataWrites, []);
  }
  const moved = await write('adminA', { entity: 'Student', operation: 'update', id: 'stuA1', data: { classroom_id: 'cB1' } });
  assert.equal(moved.body.code, 'REFERENCE_NOT_IN_SCHOOL');
});

test('an ADMIN links a parent of their school to a child of their school', async () => {
  const r = await write('adminA', { entity: 'ParentStudent', operation: 'create', data: { parent_id: 'u-parentA2', student_id: 'stuA1', relationship: 'padre' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.record.school_id, 'sA');
  assert.equal(r.body.record.status, 'ACTIVE');
  const bad = await write('adminA', { entity: 'ParentStudent', operation: 'create', data: { parent_id: 'u-parentA2', student_id: 'stuA1', relationship: 'vecino' } });
  assert.equal(bad.body.code, 'INVALID_FIELD');
});

// --- fields -------------------------------------------------------------------

test('only allowlisted, typed fields survive; attribution is the caller', async () => {
  let r = await write('adminA', { entity: 'OfficialDocument', operation: 'create', data: { title: 'X', document_type: 'MENU', file_url: 'javascript:alert(1)' } });
  assert.equal(r.body.code, 'INVALID_FIELD');
  r = await write('adminA', { entity: 'OfficialDocument', operation: 'create', data: { title: 'Menú', document_type: 'MENU', file_url: 'https://files/x.pdf', uploaded_by: 'u-someone', uploaded_by_name: 'Otra' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.record.uploaded_by, 'u-adminA');
  assert.equal(r.body.record.uploaded_by_name, 'Directora A');

  r = await write('adminA', { entity: 'SchoolSetupGuide', operation: 'update', id: 'sgA', data: { id: 'sgA', school_id: 'sB', is_completed: true, completed_by: 'u-someone', completed_at: '2020-01-01T00:00:00Z' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.dataWrites.at(-1).data, { is_completed: true, completed_by: 'u-adminA', completed_at: NOW.toISOString() });
  // Saving a note sends the whole step back: who completed it does not change.
  r = await write('adminA', { entity: 'SchoolSetupGuide', operation: 'update', id: 'sgA', data: { is_completed: true, completed_by: 'u-someone', completed_at: NOW.toISOString(), notes: 'listo' } }, r.db);
  assert.deepEqual(r.dataWrites.at(-1).data, { is_completed: true, notes: 'listo' });
  r = await write('adminA', { entity: 'SchoolSetupGuide', operation: 'update', id: 'sgA', data: { last_confirmed_at: '2026-01-01T00:00:00Z', confirmed_by: 'u-someone' } }, r.db);
  assert.deepEqual(r.dataWrites.at(-1).data, { confirmed_by: 'u-adminA', last_confirmed_at: NOW.toISOString() });

  r = await write('adminA', { entity: 'PendingChange', operation: 'create', data: { target_profile_id: 'p-teacherA', payload: { override_id: 'poA' }, status: 'APPROVED', requester_user_id: 'u-other' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.record.status, 'PENDING_SECOND_ADMIN_APPROVAL');
  assert.equal(r.body.record.type, 'PERMISSION_ROLLBACK');
  assert.equal(r.body.record.requester_user_id, 'u-adminA');
  assert.equal(r.body.record.requester_profile_id, 'p-adminA');

  r = await write('adminA', { entity: 'AbsenceNotification', operation: 'update', id: 'abA', data: { status: 'APPROVED', reviewed_by: 'u-x', parent_id: 'u-x' } });
  assert.deepEqual(r.dataWrites.at(-1).data, { status: 'APPROVED', reviewed_by: 'u-adminA', reviewed_at: NOW.toISOString() });

  r = await write('adminA', { entity: 'PermissionOverride', operation: 'create', data: { user_profile_id: 'p-teacherA', resource: 'Classroom', action: 'write', effect: 'allow' } });
  assert.equal(r.body.code, 'INVALID_FIELD', 'an override on a resource nothing enforces');
});

// --- license -------------------------------------------------------------------

test('a read-only license stops school writes but not support tickets or reading a notice', async () => {
  const db = () => freshDb({ subscriptions: [{ id: 'subA', school_id: 'sA', subscription_status: 'trial', trial_end_date: '2026-09-01' }] });
  let r = await write('adminA', { entity: 'Classroom', operation: 'create', data: { name: 'X' } }, db());
  assert.equal(r.body.code, 'WRITE_BLOCKED');
  r = await write('adminA', { entity: 'SupportTicket', operation: 'create', data: { ticket_number: 'T-9', subject: 'Pago', category: 'BILLING' } }, db());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await write('parentA', { entity: 'NoticeDelivery', operation: 'update', id: 'dA1', data: { status: 'READ' } }, db());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // No subscription row at all: fails closed, same as the overridable entities.
  r = await write('adminA', { entity: 'Event', operation: 'create', data: { title: 'X', date: '2026-10-01' } }, freshDb({ subscriptions: [] }));
  assert.equal(r.body.code, 'WRITE_BLOCKED');
});

// --- support tickets -------------------------------------------------------------

test('a support ticket\'s school, requester, tier and SLA come from the server', async () => {
  const r = await write('parentA', {
    entity: 'SupportTicket',
    operation: 'create',
    data: {
      ticket_number: 'LIU-2026-0001', subject: 'No abre', category: 'TECHNICAL', priority: 'HIGH',
      requester_user_id: 'u-adminA', requester_role: 'ADMIN', status: 'CLOSED', tier: 'PLATFORM', sla_due_at: '2099-01-01T00:00:00Z',
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const t = r.body.record;
  assert.equal(t.school_id, 'sA');
  assert.equal(t.requester_user_id, 'u-parentA');
  assert.equal(t.requester_profile_id, 'p-parentA');
  assert.equal(t.requester_role, 'PARENT');
  assert.equal(t.status, 'ESCALATED');
  assert.equal(t.tier, 'PLATFORM'); // TECHNICAL goes to soporte
  assert.equal(t.sla_due_at, new Date(NOW.getTime() + 48 * 3600 * 1000).toISOString());

  const school = await write('parentA', { entity: 'SupportTicket', operation: 'create', data: { ticket_number: 'T2', subject: 'Tarea', category: 'ACADEMIC', tier: 'PLATFORM' } });
  assert.equal(school.body.record.tier, 'SCHOOL_ADMIN');
  assert.equal(school.body.record.assignee_role, 'SCHOOL_ADMIN');
});

test('a director works only the tickets routed to them; escalating stamps the platform clock', async () => {
  let r = await write('adminA', { entity: 'SupportTicket', operation: 'update', id: 'tA2', data: { status: 'CLOSED' } });
  assert.equal(r.body.code, 'TICKET_NOT_SCHOOL_TIER');
  r = await write('teacherA', { entity: 'SupportTicket', operation: 'update', id: 'tA1', data: { status: 'CLOSED' } });
  assert.equal(r.body.code, 'FORBIDDEN');
  r = await write('adminA', {
    entity: 'SupportTicket', operation: 'update', id: 'tA1',
    data: { tier: 'PLATFORM', assignee_role: 'SCHOOL_ADMIN', status: 'ESCALATED', sla_due_at: '2099-01-01T00:00:00Z', first_response_at: null, escalated_at: '2000-01-01T00:00:00Z', school_id: 'sB' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.dataWrites.at(-1).data, {
    status: 'ESCALATED',
    first_response_at: null,
    escalated_at: NOW.toISOString(),
    tier: 'PLATFORM',
    assignee_role: 'OWNER',
    sla_due_at: new Date(NOW.getTime() + 48 * 3600 * 1000).toISOString(),
  });
});

// --- notice deliveries -----------------------------------------------------------

test('publishing a notice: the server picks recipients in the school and skips existing copies', async () => {
  const db = freshDb();
  // School-wide notice: parentA→stuA1 already has a copy; stuA3 is inactive;
  // the link claiming school B for stuA2 does not count; the revoked link
  // does not count. Nothing new to send.
  let r = await write('adminA', { entity: 'NoticeDelivery', operation: 'create', data: { notice_id: 'nA2' } }, db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.created, 0);

  // The teacher's own classroom notice (URGENT): one copy, 24 h escalation.
  r = await write('teacherA', { entity: 'NoticeDelivery', operation: 'create', data: { notice_id: 'nA1' } }, db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.created, 1);
  const row = r.dataWrites.at(-1).data;
  assert.equal(row.school_id, 'sA');
  assert.equal(row.recipient_user_id, 'u-parentA');
  assert.equal(row.student_id, 'stuA1');
  assert.equal(row.escalation_due_at, new Date(NOW.getTime() + 24 * 3600 * 1000).toISOString());
  // A retry does not double-send.
  r = await write('teacherA', { entity: 'NoticeDelivery', operation: 'create', data: { notice_id: 'nA1' } }, db);
  assert.equal(r.body.created, 0);
});

test('a teacher cannot publish someone else\'s notice; nobody publishes another school\'s', async () => {
  let r = await write('teacherA', { entity: 'NoticeDelivery', operation: 'create', data: { notice_id: 'nA2' } });
  assert.equal(r.body.code, 'NOT_AUTHOR');
  r = await write('adminA', { entity: 'NoticeDelivery', operation: 'create', data: { notice_id: 'nB1' } });
  assert.equal(r.body.code, 'REFERENCE_NOT_IN_SCHOOL');
  assert.deepEqual(r.dataWrites, []);
});

test('only the recipient updates a delivery, and only its read state', async () => {
  let r = await write('parentA2', { entity: 'NoticeDelivery', operation: 'update', id: 'dA1', data: { status: 'READ' } });
  assert.equal(r.body.code, 'NOT_RECIPIENT');
  r = await write('adminA', { entity: 'NoticeDelivery', operation: 'update', id: 'dA1', data: { status: 'READ' } });
  assert.equal(r.body.code, 'NOT_RECIPIENT');
  r = await write('parentA', { entity: 'NoticeDelivery', operation: 'update', id: 'dA1', data: { status: 'READ', read_at: '2000-01-01T00:00:00Z', recipient_user_id: 'u-parentA2', notice_id: 'nB1', school_id: 'sB' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.dataWrites.at(-1).data, { status: 'READ', read_at: NOW.toISOString() });
});

// --- platform owner ---------------------------------------------------------------

test('the platform owner writes into the school they name', async () => {
  const r = await write('owner', { entity: 'Classroom', operation: 'create', data: { name: 'Soporte', school_id: 'sB' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.record.school_id, 'sB');
  const t = await write('owner', { entity: 'SupportTicket', operation: 'update', id: 'tA2', data: { status: 'RESOLVED', resolved_at: 'x' } });
  assert.equal(t.status, 400, 'still typed: resolved_at must be a date');
});

// --- the overridable entities keep their record-level rules -----------------------

test('a teacher cannot file a record against a classroom that is not theirs (old path)', () => {
  const d = decideCreateTargets({ entity: 'Attendance', appRole: 'TEACHER', data: { classroom_id: 'cA2', student_id: 'stuA2' }, assignedClassroomIds: ['cA1'], studentClassroomId: 'cA2' });
  assert.equal(d.code, 'CLASSROOM_NOT_ASSIGNED');
});

test('the overridable path also takes the school from the caller\'s profile', () => {
  const entry = read('base44/functions/guardedEntityWrite/entry.ts');
  assert.match(entry, /const caller = await resolveCallerProfile\(sr, user\);/);
  assert.match(entry, /schoolId = profile \? String\(profile\.school_id \|\| ''\) : claimed;/);
  assert.match(entry, /if \(claimed && claimed !== schoolId\) return bad\(403, 'SCHOOL_MISMATCH'/);
  assert.match(entry, /if \(profile && String\(profile\.school_id \|\| ''\) !== schoolId\) \{\s*\n\s*return bad\(403, 'SCHOOL_MISMATCH'/);
  assert.match(entry, /if \(schoolWriteRule\(entity\)\) \{\s*\n\s*const result = await runSchoolWrite\(/);
});

// --- mirrors -------------------------------------------------------------------------

test('the client role table mirrors the server one', () => {
  assert.deepEqual(GUARDED_WRITE_ROLES, guardedWriteTable());
  assert.equal(canGuardedWrite('TEACHER', 'ParentStudent', 'create'), false);
  assert.equal(canGuardedWrite('ADMIN', 'ParentStudent', 'create'), true);
  assert.equal(canGuardedWrite('ADMIN', 'Student', 'delete'), false);
});

test('"which school am I in" is the same rule for reads and writes', () => {
  const samples = [
    [],
    [profile('a', 'u', 's1', 'ADMIN', 'PENDING')],
    [{ ...profile('a', 'u', 's1', 'ADMIN'), created_date: '2026-01-01' }, { ...profile('b', 'u', 's2', 'TEACHER'), created_date: '2026-02-01' }],
    [{ ...profile('a', 'u', 's1', 'ADMIN'), onboarding_completed: false, created_date: '2026-03-01' }, { ...profile('b', 'u', 's2', 'PARENT'), created_date: '2026-02-01' }],
    [{ ...profile('a', 'u', '', 'ADMIN') }],
    [{ ...profile('a', 'u', 's1', 'OWNER') }],
  ];
  for (const rows of samples) {
    const w = writeSelect(rows);
    assert.deepEqual(w, readSelect(rows));
    assert.equal(writeProblem(w), readProblem(w));
  }
});

test('support routing and SLA mirror the client helpers', () => {
  for (const role of ['ADMIN', 'TEACHER', 'PARENT']) {
    for (const category of ['ACADEMIC', 'PAYMENTS', 'ACCOUNT', 'TECHNICAL', 'FEATURE', 'BILLING', 'OTHER', '']) {
      assert.deepEqual(supportRouting(role, category), resolveSupportRouting({ requesterRole: role, category }), `${role} ${category}`);
    }
  }
  for (const from of ['2026-09-25T10:00:00Z', '2026-09-26T10:00:00Z', '2026-09-29T23:00:00Z']) {
    for (const priority of ['URGENT', 'HIGH', 'NORMAL', 'LOW', 'WHATEVER']) {
      for (const tier of ['SCHOOL_ADMIN', 'PLATFORM']) {
        assert.equal(supportSlaDueAt(priority, tier, new Date(from)), computeSlaDueAt({ priority, tier, from: new Date(from) }), `${priority} ${tier} ${from}`);
      }
    }
  }
});

// --- RLS stays strict, and the client stays off it ---------------------------------

test('every entity/operation written through here is platform-owner only in the RLS', () => {
  // If one of these ever gets a direct-write branch back, the function's
  // checks become advisory: the client could skip them.
  for (const [entity, rule] of Object.entries(SCHOOL_WRITES)) {
    const schema = readJsonc(`base44/entities/${entity}.jsonc`);
    for (const op of Object.keys(rule.roles)) {
      assert.deepEqual(schema.rls[op], PLATFORM_ONLY, `${entity}.rls.${op}`);
    }
  }
});

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx|ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

// Platform-owner-only surfaces, which the owner-only RLS is FOR.
const OWNER_SURFACES = [
  'src/pages/LicenseAdmin.jsx: SchoolSubscription.update', // rendered only when session.isPlatformOwner
  'src/pages/LicenseAdmin.jsx: SchoolSubscription.create',
];

test('no client code writes an owner-only entity directly', () => {
  const ownerOnly = new Set();
  const entitiesDir = new URL('base44/entities/', ROOT).pathname;
  for (const file of fs.readdirSync(entitiesDir)) {
    if (!file.endsWith('.jsonc')) continue;
    const schema = readJsonc(`base44/entities/${file}`);
    for (const op of ['create', 'update', 'delete']) {
      if (JSON.stringify(schema.rls?.[op]) === JSON.stringify(PLATFORM_ONLY)) ownerOnly.add(`${schema.name}.${op}`);
    }
  }
  assert.ok(ownerOnly.has('Classroom.create') && ownerOnly.has('NoticeDelivery.create'));

  const srcDir = new URL('src/', ROOT).pathname;
  const direct = /entities\.(\w+)\.(create|update|delete|bulkCreate|bulkUpdate|updateMany|deleteMany)\(/g;
  const dynamic = /entities\[[^\]]+\]\.(create|update|delete|bulkCreate|bulkUpdate|updateMany|deleteMany)\(/g;
  const found = [];
  for (const file of walk(srcDir)) {
    if (file.includes(`${path.sep}testData${path.sep}`)) continue; // SeedTestData, platform owner
    // Testable mirror of provisionOnboardingProfile: receives the SERVICE-ROLE
    // client as a parameter, imported only by tests.
    if (file.endsWith(`authorization${path.sep}onboardingProvision.js`)) continue;
    const rel = path.relative(new URL('.', ROOT).pathname, file);
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(direct)) {
      const op = m[2].startsWith('bulkCreate') ? 'create' : m[2].replace(/Many$|^bulk/, '').toLowerCase();
      const hit = `${rel}: ${m[1]}.${m[2]}`;
      if (ownerOnly.has(`${m[1]}.${op}`) && !OWNER_SURFACES.includes(hit)) found.push(hit);
    }
    for (const m of text.matchAll(dynamic)) found.push(`${rel}: entities[…].${m[1]} (dynamic — name the entity or use guardedWrite)`);
  }
  assert.deepEqual(found, []);
});

test('every guarded write the client makes is one the server offers', () => {
  const srcDir = new URL('src/', ROOT).pathname;
  const call = /guarded(Create|Update|Delete)\(\s*['"](\w+)['"]/g;
  const bad = [];
  let count = 0;
  for (const file of walk(srcDir)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(call)) {
      count += 1;
      const op = m[1].toLowerCase();
      if (!GUARDED_WRITE_ROLES[m[2]]?.[op]) bad.push(`${path.basename(file)}: ${m[2]}.${op}`);
    }
  }
  assert.ok(count > 30, `expected the migrated call sites, found ${count}`);
  assert.deepEqual(bad, []);
  // overrides.js passes the entity through a constant.
  assert.match(read('src/lib/authorization/overrides.js'), /const ENTITY = 'PermissionOverride';[\s\S]*guardedCreate\(ENTITY,[\s\S]*guardedUpdate\(ENTITY,[\s\S]*guardedDelete\(ENTITY,/);
});

test('the notice pages let the server pick recipients', () => {
  for (const page of ['src/pages/AvisosAdmin.jsx', 'src/pages/AvisosMaestro.jsx']) {
    const src = read(page);
    assert.match(src, /publishNoticeDeliveries\(notice\.id\)/, page);
    assert.doesNotMatch(src, /recipient_user_id/, page);
  }
});

test('POLICY_WRITE and SCHOOL_WRITES do not overlap', () => {
  for (const entity of Object.keys(SCHOOL_WRITES)) assert.equal(POLICY_WRITE[entity], undefined, entity);
});
