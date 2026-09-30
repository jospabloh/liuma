import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeFakeDb } from '../fixtures/fake-entity-db.js';
// The REAL server code (Node 22 strips the TS types), never a look-alike.
import {
  distinctRecipients,
  isChannelEnabled,
  planEmergencyDeliveries,
} from '../../base44/functions/sendBulkNotification/_fanout.ts';
import {
  buildContext,
  emailEnabled,
  notifyStatusChange,
  selectRecipients,
  spanishDateLabel,
  statusEventFor,
} from '../../base44/functions/guardedEntityWrite/_statusNotify.ts';
import { NOTIFICATION_TEMPLATES } from '../../base44/functions/guardedEntityWrite/_templates.ts';
import { runSchoolWrite } from '../../base44/functions/guardedEntityWrite/_schoolWrite.ts';
import { buildScope, readFor, selectCurrentProfile } from '../../base44/functions/schoolRead/_scope.ts';
import { collapseInbox, unreadCopies } from '../../src/lib/notifications/inbox.js';
import { formatInAppSummary } from '../../src/lib/notifications/fanout.js';

// Loose-ends audit (2026-09-30), two notification gaps:
//
//  1. The emergency alert created only the school-wide Notice. Avisos lists
//     the caller's NoticeDelivery rows joined to notices, so the alert never
//     reached a parent's Avisos, had no unread badge, and none of the
//     "urgentes sin leer" counters saw it. sendBulkNotification now writes one
//     NoticeDelivery per recipient (planEmergencyDeliveries).
//  2. An absence request, its review, and a uniform order changing status
//     told nobody. The write paths (guardedFamilyWrite / guardedEntityWrite)
//     now email the other side after the write (_statusNotify.ts), with
//     recipients derived from stored rows only.

function read(rel) {
  return fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
}

const NOW = new Date('2026-09-30T15:00:00.000Z');

// --- 1. the emergency alert's in-app half ------------------------------------

const P = (userId, role, schoolId = 'sA', status = 'ACTIVE') => ({ user_id: userId, app_role: role, school_id: schoolId, status });

const EMERGENCY_INPUT = () => ({
  notice: { id: 'nE', school_id: 'sA', priority: 'URGENT', is_emergency: true, sent_at: NOW.toISOString() },
  schoolId: 'sA',
  now: NOW,
  profiles: [
    P('admin', 'ADMIN'),
    P('teacher', 'TEACHER'),
    P('twoKids', 'PARENT'),
    P('noLink', 'PARENT'),
    P('left', 'PARENT', 'sA', 'INACTIVE'),
    P('otherSchool', 'PARENT', 'sB'),
  ],
  links: [
    { parent_id: 'twoKids', student_id: 's1', status: 'ACTIVE', school_id: 'sA' },
    { parent_id: 'twoKids', student_id: 's2', status: 'ACTIVE', school_id: 'sA' },
    { parent_id: 'twoKids', student_id: 'sGone', status: 'ACTIVE', school_id: 'sA' },
    { parent_id: 'twoKids', student_id: 'sB1', status: 'ACTIVE', school_id: 'sB' },
    { parent_id: 'noLink', student_id: 's1', status: 'REVOKED', school_id: 'sA' },
    { parent_id: 'left', student_id: 's1', status: 'ACTIVE', school_id: 'sA' },
  ],
  students: [
    { id: 's1', school_id: 'sA', is_active: true },
    { id: 's2', school_id: 'sA' }, // legacy row with no is_active: active
    { id: 'sGone', school_id: 'sA', is_active: false },
    { id: 'sB1', school_id: 'sB', is_active: true },
  ],
});

test('the emergency alert puts a copy in every active parent\'s and teacher\'s Avisos', () => {
  const rows = planEmergencyDeliveries(EMERGENCY_INPUT());
  const keys = rows.map((r) => `${r.recipient_user_id}|${r.recipient_role}|${r.student_id || ''}`).sort();
  assert.deepEqual(keys, [
    // unlinked parent: still reached (an emergency is for every member)
    'noLink|PARENT|',
    // a teacher gets their own copy, addressed to them
    'teacher|TEACHER|',
    // one copy per active child of THIS school (the teacher home counts per family)
    'twoKids|PARENT|s1',
    'twoKids|PARENT|s2',
  ]);
  for (const row of rows) {
    assert.equal(row.school_id, 'sA');
    assert.equal(row.notice_id, 'nE');
    assert.equal(row.status, 'SENT');
  }
  // Not the director who sent it, not a member who left, not another school.
  assert.equal(rows.some((r) => ['admin', 'left', 'otherSchool'].includes(r.recipient_user_id)), false);
  assert.equal(distinctRecipients(rows), 3);
});

test('a retried alert never duplicates a copy', () => {
  const input = EMERGENCY_INPUT();
  const first = planEmergencyDeliveries(input);
  const again = planEmergencyDeliveries({ ...input, existing: first });
  assert.deepEqual(again, []);
  const partial = planEmergencyDeliveries({ ...input, existing: first.slice(0, 1) });
  assert.equal(partial.length, first.length - 1);
});

test('no copies for a notice that is not of the school the server derived', () => {
  const input = EMERGENCY_INPUT();
  assert.deepEqual(planEmergencyDeliveries({ ...input, notice: { ...input.notice, school_id: 'sB' } }), []);
  assert.deepEqual(planEmergencyDeliveries({ ...input, schoolId: '' }), []);
});

test('planEmergency writes the copies server-side, best-effort, after the banner', () => {
  const src = read('base44/functions/sendBulkNotification/entry.ts');
  const planner = src.slice(src.indexOf('async function planEmergency'), src.indexOf('async function fanOutEmergencyDeliveries'));
  // The copies are planned from the stored Notice and the school's own rows.
  assert.match(planner, /const notice: Any = await sr\.entities\.Notice\.create\(/);
  assert.match(planner, /fanOutEmergencyDeliveries\(sr, notice, schoolId, profiles, sentAt\)/);
  assert.ok(planner.indexOf('Notice.create') < planner.indexOf('fanOutEmergencyDeliveries'), 'banner first');
  const fanOut = src.slice(src.indexOf('async function fanOutEmergencyDeliveries'), src.indexOf('async function parentRecipientsForStudent'));
  assert.match(fanOut, /NoticeDelivery\.filter\(\{ notice_id: String\(notice\.id\) \}/, 'existing copies are read (idempotent)');
  assert.match(fanOut, /catch \(error\)/, 'a failure is reported, never thrown (the emails must still go out)');
  // The in-app count is reported apart from the email count.
  assert.match(src, /\.\.\.\(plan\.extra \|\| \{\}\), \.\.\.summary/);
});

test('the director is told the alert is in the Avisos too, separately from the email count', () => {
  assert.equal(formatInAppSummary({ total: 3, reached: 3, inAppRecipients: 5 }), 'También quedó en los Avisos de 5 personas.');
  assert.equal(formatInAppSummary({ inAppRecipients: 1 }), 'También quedó en los Avisos de 1 persona.');
  assert.match(formatInAppSummary({ inAppFailed: 1 }), /No se pudo agregar la alerta/);
  // An older deploy that does not report it: say nothing rather than 0.
  assert.equal(formatInAppSummary({ total: 3, reached: 3 }), '');
  assert.equal(formatInAppSummary({ skipped: true, inAppRecipients: 5 }), '');
});

test('an inbox shows each notice once, and reading it reads every copy', () => {
  const notices = new Map([['nE', { id: 'nE' }], ['n2', { id: 'n2' }]]);
  const deliveries = [
    { id: 'd1', notice_id: 'nE', student_id: 's1', status: 'READ' },
    { id: 'd2', notice_id: 'nE', student_id: 's2', status: 'SENT', escalation_status: null },
    { id: 'd3', notice_id: 'n2', status: 'READ', escalation_status: 'ESCALATED' },
    { id: 'd4', notice_id: 'nUnreadable', status: 'SENT' },
  ];
  const inbox = collapseInbox(deliveries, notices);
  assert.deepEqual(inbox.map((e) => e.notice.id), ['nE', 'n2']);
  // Unread while any copy is unread.
  assert.equal(inbox[0].delivery.id, 'd2');
  assert.deepEqual(unreadCopies(inbox[0]).map((d) => d.id), ['d2']);
  assert.deepEqual(unreadCopies(inbox[1]), []);
  assert.equal(inbox[1].delivery.escalation_status, 'ESCALATED');
});

test('Avisos and AvisosMaestro list the inbox one entry per notice', () => {
  const avisos = read('src/pages/Avisos.jsx');
  assert.match(avisos, /collapseInbox\(deliveries, noticesById\)/);
  assert.match(avisos, /unreadCopies\(entry\)/);
  const maestro = read('src/pages/AvisosMaestro.jsx');
  assert.match(maestro, /readNoticeInbox\(\{ schoolId: userProfile\.school_id, userId: user\.id \}\)/);
  assert.match(read('src/components/home/TeacherHome.jsx'), /row\.recipient_user_id === user\.id/);
});

// schoolRead: a teacher reads their own copy of the alert (no student on it)
// and still never another family's copy outside their classrooms.
test('schoolRead lets a teacher read the copy addressed to them, and nothing wider', async () => {
  const db = makeFakeDb({
    UserProfile: [
      { id: 'pT', user_id: 'teacher', school_id: 'A', app_role: 'TEACHER', status: 'ACTIVE', onboarding_completed: true, created_date: '2026-09-01' },
      { id: 'pP', user_id: 'parent', school_id: 'A', app_role: 'PARENT', status: 'ACTIVE', onboarding_completed: true, created_date: '2026-09-01' },
      { id: 'pP2', user_id: 'parent2', school_id: 'A', app_role: 'PARENT', status: 'ACTIVE', onboarding_completed: true, created_date: '2026-09-01' },
      { id: 'pT2', user_id: 'teacher2', school_id: 'A', app_role: 'TEACHER', status: 'ACTIVE', onboarding_completed: true, created_date: '2026-09-01' },
    ],
    Classroom: [{ id: 'c1', school_id: 'A' }, { id: 'c2', school_id: 'A' }],
    TeacherClassroom: [{ id: 'tc', school_id: 'A', teacher_id: 'teacher', classroom_id: 'c1', is_active: true }],
    Student: [{ id: 's1', school_id: 'A', classroom_id: 'c1', is_active: true }, { id: 's2', school_id: 'A', classroom_id: 'c2', is_active: true }],
    ParentStudent: [],
    NoticeDelivery: [
      { id: 'mine', school_id: 'A', notice_id: 'nE', recipient_user_id: 'teacher', recipient_role: 'TEACHER', status: 'SENT', created_date: '2026-09-30' },
      { id: 'family', school_id: 'A', notice_id: 'nE', recipient_user_id: 'parent', student_id: 's1', status: 'SENT', created_date: '2026-09-30' },
      { id: 'otherFamily', school_id: 'A', notice_id: 'nE', recipient_user_id: 'parent2', student_id: 's2', status: 'SENT', created_date: '2026-09-30' },
      { id: 'otherTeacher', school_id: 'A', notice_id: 'nE', recipient_user_id: 'teacher2', recipient_role: 'TEACHER', status: 'SENT', created_date: '2026-09-30' },
    ],
  });
  const profile = selectCurrentProfile(await db.entities.UserProfile.filter({ user_id: 'teacher' }));
  const { scope } = await buildScope(db, 'teacher', profile);
  const all = await readFor(db, scope, { entity: 'NoticeDelivery' });
  assert.deepEqual(all.rows.map((r) => r.id).sort(), ['family', 'mine']);
  const own = await readFor(db, scope, { entity: 'NoticeDelivery', filter: { recipient_user_id: 'teacher' } });
  assert.deepEqual(own.rows.map((r) => r.id), ['mine']);
});

test('the three _scope.ts copies stay identical', () => {
  const a = read('base44/functions/schoolRead/_scope.ts');
  assert.equal(read('base44/functions/lumiQuery/_scope.ts'), a);
  assert.equal(read('base44/functions/lumiWrite/_scope.ts'), a);
});

// --- 2. request-status emails ------------------------------------------------

test('only a real stored transition calls for an email', () => {
  assert.equal(statusEventFor('AbsenceNotification', 'create', null, { status: 'PENDING' }), 'absence_request_submitted');
  assert.equal(statusEventFor('AbsenceNotification', 'update', { status: 'PENDING' }, { status: 'APPROVED' }), 'absence_request_reviewed');
  assert.equal(statusEventFor('AbsenceNotification', 'update', { status: 'PENDING' }, { status: 'REJECTED' }), 'absence_request_reviewed');
  // A re-save or a note edit is not news; moving back to PENDING is not a review.
  assert.equal(statusEventFor('AbsenceNotification', 'update', { status: 'APPROVED' }, { status: 'APPROVED' }), null);
  assert.equal(statusEventFor('AbsenceNotification', 'update', { status: 'APPROVED' }, { status: 'PENDING' }), null);
  for (const status of ['PROCESSING', 'READY', 'DELIVERED', 'CANCELLED']) {
    assert.equal(statusEventFor('UniformOrder', 'update', { status: 'PENDING' }, { status }), 'uniform_order_status', status);
  }
  assert.equal(statusEventFor('UniformOrder', 'create', null, { status: 'PENDING' }), null);
  assert.equal(statusEventFor('UniformOrder', 'update', { status: 'READY' }, { status: 'READY' }), null);
  assert.equal(statusEventFor('Notice', 'update', { status: 'A' }, { status: 'B' }), null);
});

const SCHOOL_PROFILES = [
  P('admin1', 'ADMIN'),
  P('admin2', 'ADMIN'),
  P('teacherOfChild', 'TEACHER'),
  P('otherTeacher', 'TEACHER'),
  P('parent', 'PARENT'),
  P('inactiveAdmin', 'ADMIN', 'sA', 'INACTIVE'),
  P('adminB', 'ADMIN', 'sB'),
];
const TEACHER_LINKS = [
  { teacher_id: 'teacherOfChild', classroom_id: 'c1', school_id: 'sA', is_active: true },
  { teacher_id: 'otherTeacher', classroom_id: 'c2', school_id: 'sA', is_active: true },
  { teacher_id: 'otherTeacher', classroom_id: 'c1', school_id: 'sB', is_active: true },
];

test('a new absence request reaches the school\'s admins and the child\'s teachers only', () => {
  const out = selectRecipients({
    event: 'absence_request_submitted',
    schoolId: 'sA',
    record: { school_id: 'sA', student_id: 's1', parent_id: 'parent' },
    profiles: SCHOOL_PROFILES,
    teacherLinks: TEACHER_LINKS,
    classroomId: 'c1',
    actorId: 'parent',
  });
  assert.deepEqual(out.map((r) => r.userId), ['admin1', 'admin2', 'teacherOfChild']);
  // A director filing it themselves is not told about their own request.
  const byAdmin = selectRecipients({
    event: 'absence_request_submitted', schoolId: 'sA', record: { school_id: 'sA' },
    profiles: SCHOOL_PROFILES, teacherLinks: TEACHER_LINKS, classroomId: 'c1', actorId: 'admin1',
  });
  assert.deepEqual(byAdmin.map((r) => r.userId), ['admin2', 'teacherOfChild']);
});

test('a review or a uniform status reaches the parent who filed it — while still linked', () => {
  const base = {
    schoolId: 'sA',
    record: { school_id: 'sA', student_id: 's1', parent_id: 'parent' },
    profiles: SCHOOL_PROFILES,
    actorId: 'admin1',
  };
  const link = { parent_id: 'parent', student_id: 's1', status: 'ACTIVE', school_id: 'sA' };
  for (const event of ['absence_request_reviewed', 'uniform_order_status']) {
    assert.deepEqual(selectRecipients({ ...base, event, parentLinks: [link] }).map((r) => r.userId), ['parent'], event);
    // A revoked (custody change) or missing link: the parent is not told about the child any more.
    assert.deepEqual(selectRecipients({ ...base, event, parentLinks: [{ ...link, status: 'REVOKED' }] }), [], event);
    assert.deepEqual(selectRecipients({ ...base, event, parentLinks: [] }), [], event);
    // A record of another school than the derived one: nobody.
    assert.deepEqual(selectRecipients({ ...base, event, record: { ...base.record, school_id: 'sB' }, parentLinks: [link] }), [], event);
  }
});

test('the email preference rule is the same as the bulk fan-out\'s', () => {
  const cases = [
    [{}, {}, 'PARENT'],
    [{ email: false }, {}, 'PARENT'],
    [{}, { email: false }, 'ADMIN'],
    [{ role_parent: false }, {}, 'PARENT'],
    [{ role_parent: false }, {}, 'TEACHER'],
    [null, { role_teacher: false }, 'TEACHER'],
  ];
  for (const [schoolPrefs, userPrefs, role] of cases) {
    assert.equal(
      emailEnabled(schoolPrefs, userPrefs, role),
      isChannelEnabled({ schoolPrefs, userPrefs, channel: 'email', role }),
      JSON.stringify([schoolPrefs, userPrefs, role]),
    );
  }
});

test('the email text comes from the stored record, escaped', () => {
  assert.equal(spanishDateLabel('2027-03-05'), '5 de marzo, 2027');
  assert.equal(spanishDateLabel('nope'), '');
  const record = {
    parent_name: '<b>Mamá</b>', reason: 'Cita <script>x</script>', absence_date: '2026-10-02', status: 'APPROVED', admin_notes: 'ok',
  };
  const student = { first_name: 'Ana', last_name: 'Uno' };
  const ctx = buildContext('absence_request_submitted', record, student, 'ADMIN');
  const body = NOTIFICATION_TEMPLATES.absence_request_submitted.emailBody(ctx);
  assert.match(body, /Ana Uno/);
  assert.match(body, /2 de octubre, 2026/);
  assert.doesNotMatch(body, /<script>|<b>Mamá/);
  assert.match(body, /Ausencias para aprobarla/, 'the director is told where to act');
  const teacherCtx = buildContext('absence_request_submitted', record, student, 'TEACHER');
  assert.match(NOTIFICATION_TEMPLATES.absence_request_submitted.emailBody(teacherCtx), /alumno\(a\) de tu grupo/);
  const reviewed = buildContext('absence_request_reviewed', record, student, 'PARENT');
  assert.equal(NOTIFICATION_TEMPLATES.absence_request_reviewed.subject(reviewed), 'Solicitud de ausencia aprobada - Ana Uno');
  const uniform = buildContext('uniform_order_status', { status: 'READY', estimated_delivery: '2026-10-09' }, student, 'PARENT');
  const uniformBody = NOTIFICATION_TEMPLATES.uniform_order_status.emailBody(uniform);
  assert.match(uniformBody, /Listo para recoger/);
  assert.match(uniformBody, /9 de octubre, 2026/);
});

// A two-school world for the write path end to end, with an email outbox.
function world() {
  const db = makeFakeDb({
    UserProfile: [
      { id: 'pA', user_id: 'adminA', school_id: 'sA', app_role: 'ADMIN', status: 'ACTIVE', onboarding_completed: true, created_date: '2026-09-01' },
      { id: 'pT', user_id: 'teacherA', school_id: 'sA', app_role: 'TEACHER', status: 'ACTIVE', onboarding_completed: true, created_date: '2026-09-01' },
      { id: 'pP', user_id: 'parentA', school_id: 'sA', app_role: 'PARENT', status: 'ACTIVE', onboarding_completed: true, created_date: '2026-09-01' },
      { id: 'pX', user_id: 'intruder', school_id: 'sA', app_role: 'PARENT', status: 'ACTIVE', onboarding_completed: true, created_date: '2026-09-01' },
      { id: 'pB', user_id: 'adminB', school_id: 'sB', app_role: 'ADMIN', status: 'ACTIVE', onboarding_completed: true, created_date: '2026-09-01' },
    ],
    User: [
      { id: 'adminA', email: 'a@a.mx' },
      { id: 'teacherA', email: 't@a.mx' },
      { id: 'parentA', email: 'p@a.mx' },
      { id: 'intruder', email: 'x@a.mx' },
      { id: 'adminB', email: 'a@b.mx' },
    ],
    School: [{ id: 'sA', name: 'Escuela A' }, { id: 'sB', name: 'Escuela B' }],
    SchoolSubscription: [{ id: 'subA', school_id: 'sA', subscription_status: 'active', license_tier: 'growth' }],
    Student: [{ id: 'stu1', school_id: 'sA', classroom_id: 'c1', first_name: 'Ana', last_name: 'Uno', is_active: true }],
    TeacherClassroom: [{ id: 'tc', school_id: 'sA', teacher_id: 'teacherA', classroom_id: 'c1', is_active: true }],
    ParentStudent: [{ id: 'ps', school_id: 'sA', parent_id: 'parentA', student_id: 'stu1', status: 'ACTIVE' }],
    AbsenceNotification: [
      { id: 'ab1', school_id: 'sA', student_id: 'stu1', parent_id: 'parentA', absence_date: '2026-10-02', reason: 'Cita', status: 'PENDING' },
    ],
    UniformOrder: [{ id: 'uo1', school_id: 'sA', student_id: 'stu1', parent_id: 'parentA', status: 'PENDING' }],
    AuditLog: [],
  });
  const outbox = [];
  const sr = {
    entities: db.entities,
    integrations: { Core: { SendEmail: async (msg) => { outbox.push(msg); } } },
  };
  return { db, sr, outbox };
}
const ADMIN_A = { id: 'adminA', email: 'a@a.mx', full_name: 'Directora' };

test('approving an absence emails the parent who filed it — the stored one, not a body field', async () => {
  const { sr, outbox } = world();
  const r = await runSchoolWrite({
    sr, user: ADMIN_A, now: NOW,
    // parent_id in the body is not a field this write accepts, and the email
    // follows the stored record anyway.
    body: { entity: 'AbsenceNotification', operation: 'update', id: 'ab1', data: { status: 'APPROVED', parent_id: 'intruder' } },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(outbox.map((m) => m.to), ['p@a.mx']);
  assert.match(outbox[0].subject, /aprobada - Ana Uno/);
  assert.deepEqual(r.body.notified, { event: 'absence_request_reviewed', total: 1, emailed: 1, failed: 0, skipped: 0 });
});

test('re-saving an absence without a status change sends nothing', async () => {
  const { sr, outbox } = world();
  await runSchoolWrite({ sr, user: ADMIN_A, now: NOW, body: { entity: 'AbsenceNotification', operation: 'update', id: 'ab1', data: { status: 'APPROVED' } } });
  outbox.length = 0;
  const r = await runSchoolWrite({ sr, user: ADMIN_A, now: NOW, body: { entity: 'AbsenceNotification', operation: 'update', id: 'ab1', data: { status: 'APPROVED', admin_notes: 'Visto' } } });
  assert.equal(r.status, 200);
  assert.deepEqual(outbox, []);
  assert.equal(r.body.notified, undefined);
});

test('a uniform order moving to READY emails the parent; a failing send never fails the write', async () => {
  const { sr, outbox, db } = world();
  const r = await runSchoolWrite({ sr, user: ADMIN_A, now: NOW, body: { entity: 'UniformOrder', operation: 'update', id: 'uo1', data: { status: 'READY' } } });
  assert.equal(r.status, 200);
  assert.deepEqual(outbox.map((m) => m.to), ['p@a.mx']);
  assert.match(outbox[0].subject, /Listo para recoger/);

  sr.integrations.Core.SendEmail = async () => { throw new Error('smtp down'); };
  const r2 = await runSchoolWrite({ sr, user: ADMIN_A, now: NOW, body: { entity: 'UniformOrder', operation: 'update', id: 'uo1', data: { status: 'DELIVERED' } } });
  assert.equal(r2.status, 200, 'the status change still saved');
  assert.equal(r2.body.record.status, 'DELIVERED');
  assert.equal(r2.body.notified.failed, 1);
  const audit = db.writes.find((w) => w.entity === 'AuditLog' && w.data.action === 'NOTIFICATION_DELIVERY_FAILED');
  assert.ok(audit, 'the failure leaves an audit row');
  assert.equal(audit.data.school_id, 'sA');
});

test('a new absence request emails the admins and the child\'s teacher (guardedFamilyWrite path)', async () => {
  const { sr, outbox } = world();
  const summary = await notifyStatusChange({
    sr,
    templates: NOTIFICATION_TEMPLATES,
    event: 'absence_request_submitted',
    schoolId: 'sA',
    record: { id: 'ab2', school_id: 'sA', student_id: 'stu1', parent_id: 'parentA', parent_name: 'Mamá', absence_date: '2026-10-03', reason: 'Viaje', status: 'PENDING' },
    actorId: 'parentA',
  });
  assert.deepEqual(outbox.map((m) => m.to).sort(), ['a@a.mx', 't@a.mx']);
  assert.equal(summary.emailed, 2);
  // Never the other school's director.
  assert.equal(outbox.some((m) => m.to === 'a@b.mx'), false);
});

test('notifyStatusChange never throws, even when the database does', async () => {
  const sr = { entities: new Proxy({}, { get: () => ({ filter: () => { throw new Error('boom'); }, get: () => { throw new Error('boom'); } }) }) };
  const out = await notifyStatusChange({
    sr, templates: NOTIFICATION_TEMPLATES, event: 'uniform_order_status', schoolId: 'sA', record: { school_id: 'sA', parent_id: 'p' }, actorId: 'a',
  });
  assert.equal(out.event, 'uniform_order_status');
  assert.ok(out.error);
});

test('guardedFamilyWrite emails after the write, from the stored record', () => {
  const src = read('base44/functions/guardedFamilyWrite/entry.ts');
  const write = src.indexOf('await sr.entities[entity].create(built.data)');
  const notify = src.indexOf('notifyStatusChange({');
  assert.ok(write > 0 && notify > write, 'the email goes out after the record is stored');
  assert.match(src, /const stored = \{ \.\.\.built\.data, \.\.\.\(record \|\| \{\}\) \}/);
  assert.match(src, /statusEventFor\(entity, operation, existing, stored\)/);
});

test('no browser can trigger the request-status emails through sendNotificationEmail', () => {
  const src = read('base44/functions/sendNotificationEmail/entry.ts');
  const callerRoles = src.slice(src.indexOf('const CALLER_ROLES'), src.indexOf('};', src.indexOf('const CALLER_ROLES')));
  for (const event of ['absence_request_submitted', 'absence_request_reviewed', 'uniform_order_status']) {
    assert.ok(NOTIFICATION_TEMPLATES[event], event);
    assert.doesNotMatch(callerRoles, new RegExp(event), `${event} must not be client-triggerable`);
  }
  assert.doesNotMatch(read('src/lib/notifications/templates.js'), /absence_request_submitted|uniform_order_status/);
});

test('every server copy of the templates and of _statusNotify.ts is byte-identical', () => {
  const templates = read('base44/functions/sendNotificationEmail/_templates.ts');
  for (const dir of ['sendBulkNotification', 'guardedEntityWrite', 'guardedFamilyWrite']) {
    assert.equal(read(`base44/functions/${dir}/_templates.ts`), templates, dir);
  }
  assert.equal(
    read('base44/functions/guardedFamilyWrite/_statusNotify.ts'),
    read('base44/functions/guardedEntityWrite/_statusNotify.ts'),
  );
});
