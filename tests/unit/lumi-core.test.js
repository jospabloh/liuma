import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// Node 22 strips the type annotations; _lumiCore.ts is import-free on purpose.
import {
  selectCurrentProfile, profileProblem, canRunIntent, canWriteKind, rowVisible, scopeRows,
  mexicoToday, addDays, spanishLongDate, isoWeek, menuDayKey, label, formatMXN,
  matchStudents, validateWrite, resolveWriteDate, confirmationCode, errorMessage,
  describeWrite, mexicoDayOf, displayUserName, homeworkRange, attendanceWindow,
  displayPersonName, helpsWith, nextDueGroup, writableKinds, licenseIsReadOnly,
  HOMEWORK_DEFAULT_DAYS, HOMEWORK_MAX_DAYS,
} from '../../base44/functions/lumiQuery/_lumiCore.ts';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// Sales-readiness audit 2026-09-29 (F16/F17/F07/LUMI-01..05/LUMI-13). Lumi's
// data access moved from raw entity tools to two function tools whose rules
// live in _lumiCore.ts. These tests pin the rules that decide who sees what.

test('lumiQuery and lumiWrite carry byte-identical copies of _lumiCore.ts', () => {
  // Deno functions cannot import across directories, so each carries a copy.
  // If they drift, a read and a write could disagree about who the caller is.
  assert.equal(
    read('base44/functions/lumiWrite/_lumiCore.ts'),
    read('base44/functions/lumiQuery/_lumiCore.ts'),
  );
});

test('the current profile follows the shared selectCurrentUserProfile rule, deterministically', async () => {
  const { selectCurrentUserProfile } = await import('../../src/lib/tenantSelection.js');
  const profiles = [
    { id: 'old', status: 'ACTIVE', onboarding_completed: true, created_date: '2026-01-01T00:00:00Z', school_id: 'A' },
    { id: 'new', status: 'ACTIVE', onboarding_completed: true, created_date: '2026-06-01T00:00:00Z', school_id: 'B' },
    { id: 'pending', status: 'PENDING', created_date: '2026-09-01T00:00:00Z', school_id: 'C' },
  ];
  // Same answer as the front end, whatever order filter() returns.
  for (const input of [profiles, [...profiles].reverse()]) {
    assert.equal(selectCurrentProfile(input).id, 'new');
    assert.equal(selectCurrentProfile(input).id, selectCurrentUserProfile(input).id);
  }
});

test('an unusable profile is a denial, including for the platform owner', () => {
  // There is no owner bypass: the owner is answered inside their own school
  // profile, so a demo never mixes several customers' data (LUMI-13).
  assert.equal(profileProblem(null), 'NO_PROFILE');
  assert.equal(profileProblem({ status: 'PENDING', school_id: 'A', app_role: 'ADMIN' }), 'INACTIVE_PROFILE');
  assert.equal(profileProblem({ status: 'ACTIVE', app_role: 'ADMIN' }), 'NO_SCHOOL');
  assert.equal(profileProblem({ status: 'ACTIVE', school_id: 'A', app_role: 'admin' }), 'INVALID_ROLE');
  // v1.9.0: a usable profile also carries the CURRENT consent stamp.
  assert.equal(profileProblem({ status: 'ACTIVE', school_id: 'A', app_role: 'PARENT' }), 'CONSENT_REQUIRED');
  assert.equal(profileProblem({ status: 'ACTIVE', school_id: 'A', app_role: 'PARENT', consent_notice_version: '2026-09-29-borrador', consent_terms_version: '2026-09-29-borrador' }), 'CONSENT_REQUIRED');
  assert.equal(profileProblem({ status: 'ACTIVE', school_id: 'A', app_role: 'PARENT', consent_notice_version: '2026-10-02', consent_terms_version: '2026-10-02' }), null);
});

test('parents can never write through Lumi; teachers cannot see charges or setup', () => {
  assert.equal(canWriteKind('PARENT', 'attendance'), false);
  assert.equal(canWriteKind('PARENT', 'diary'), false);
  assert.equal(canWriteKind('TEACHER', 'attendance'), true);
  assert.equal(canWriteKind('ADMIN', 'diary'), true);
  assert.equal(canWriteKind('TEACHER', 'charge'), false);
  assert.equal(canRunIntent('TEACHER', 'pending_charges'), false);
  assert.equal(canRunIntent('PARENT', 'setup_pending'), false);
  assert.equal(canRunIntent('PARENT', 'homework'), true);
  assert.equal(canRunIntent('ADMIN', 'drop_tables'), false);
});

const parent = { userId: 'u1', schoolId: 'A', role: 'PARENT', classroomIds: ['c1'], studentIds: ['s1'] };
const teacher = { userId: 'u2', schoolId: 'A', role: 'TEACHER', classroomIds: ['c1'], studentIds: ['s1', 's2'] };
const admin = { userId: 'u3', schoolId: 'A', role: 'ADMIN', classroomIds: [], studentIds: [] };

test('rows from another school are never visible, whatever the role', () => {
  for (const scope of [parent, teacher, admin]) {
    assert.equal(rowVisible(scope, 'Notice', { school_id: 'B', scope: 'SCHOOL' }), false);
    assert.equal(rowVisible(scope, 'Attendance', { school_id: 'B', student_id: 's1' }), false);
  }
});

test('a parent sees only their own children, their classrooms and school-wide rows', () => {
  assert.equal(rowVisible(parent, 'Attendance', { school_id: 'A', student_id: 's1' }), true);
  assert.equal(rowVisible(parent, 'Attendance', { school_id: 'A', student_id: 's9' }), false);
  assert.equal(rowVisible(parent, 'Homework', { school_id: 'A', classroom_id: 'c1' }), true);
  assert.equal(rowVisible(parent, 'Homework', { school_id: 'A', classroom_id: 'c2' }), false);
  assert.equal(rowVisible(parent, 'Notice', { school_id: 'A', scope: 'SCHOOL' }), true);
  assert.equal(rowVisible(parent, 'Notice', { school_id: 'A', scope: 'STUDENT', student_id: 's9' }), false);
  assert.equal(rowVisible(parent, 'OfficialDocument', { school_id: 'A', target_audience: 'MAESTROS' }), false);
  assert.equal(rowVisible(parent, 'ChargeItem', { school_id: 'A', student_id: 's1' }), true);
});

test('a teacher sees their classrooms but never family charges', () => {
  // P10: a teacher's attendance/diary rows are the ones filed in THEIR
  // classrooms (every row carries classroom_id) — the shared _scope.ts rule.
  assert.equal(rowVisible(teacher, 'Attendance', { school_id: 'A', classroom_id: 'c1', student_id: 's2' }), true);
  assert.equal(rowVisible(teacher, 'Attendance', { school_id: 'A', classroom_id: 'c2', student_id: 's2' }), false);
  assert.equal(rowVisible(teacher, 'DiaryEntry', { school_id: 'A', classroom_id: 'c2', student_id: 's3' }), false);
  assert.equal(rowVisible(teacher, 'ChargeItem', { school_id: 'A', student_id: 's1' }), false);
  assert.equal(rowVisible(teacher, 'Event', { school_id: 'A', scope: 'CLASSROOM', classroom_id: 'c2' }), false);
});

test('scopeRows keeps admins inside their own school', () => {
  const rows = [{ school_id: 'A', id: 1 }, { school_id: 'B', id: 2 }];
  assert.deepEqual(scopeRows(admin, 'ChargeItem', rows).map((r) => r.id), [1]);
});

test('"today" is the school day in Mexico, not UTC (LUMI-05)', () => {
  // The live bug: 21:47 on May 15 in Mexico was queried as May 16.
  assert.equal(mexicoToday(new Date('2026-05-16T03:47:26Z')), '2026-05-15');
  assert.equal(mexicoToday(new Date('2026-05-16T06:00:00Z')), '2026-05-16');
});

test('date helpers speak the way the prompt promises', () => {
  assert.equal(spanishLongDate('2026-03-03'), 'martes 3 de marzo');
  assert.equal(spanishLongDate('not-a-date'), '');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.deepEqual(isoWeek('2026-01-01'), { week: 1, year: 2026 });
  assert.deepEqual(isoWeek('2027-01-01'), { week: 53, year: 2026 });
  assert.equal(menuDayKey('2026-09-28'), 'monday');
  assert.equal(menuDayKey('2026-09-27'), '');
});

test('results carry Spanish labels and MXN, never raw enums', () => {
  assert.equal(label('charge_status', 'OVERDUE'), 'vencido');
  assert.equal(label('attendance_status', 'excused'), 'falta justificada');
  assert.equal(label('uniform_status', 'READY'), 'listo para recoger');
  assert.equal(formatMXN(1250), '$1,250.00');
});

test('student names resolve only to a unique match; otherwise Lumi must ask', () => {
  const students = [
    { id: 's1', first_name: 'Sofía', last_name: 'López' },
    { id: 's2', first_name: 'Sofía', last_name: 'Ramírez' },
    { id: 's3', first_name: 'Juan', last_name: 'Pérez' },
  ];
  assert.equal(matchStudents(students, 'sofia').status, 'ambiguous');
  assert.equal(matchStudents(students, 'Sofia Ram').candidates[0].id, 's2');
  assert.equal(matchStudents(students, 'JUAN').status, 'unique');
  assert.equal(matchStudents(students, 'Pedro').status, 'none');
  assert.equal(matchStudents(students, '').status, 'none');
});

test('writes only accept whitelisted fields; ids never come from the model', () => {
  const today = '2026-09-29';
  const res = validateWrite('attendance', { status: 'absent', school_id: 'B', student_id: 'x', recorded_by: 'y' }, today);
  assert.equal(res.ok, true);
  assert.deepEqual(Object.keys(res.data).sort(), ['date', 'status']);
  assert.equal(res.data.date, today);

  assert.equal(validateWrite('attendance', { status: 'ausente' }, today).ok, false);
  assert.equal(validateWrite('grades', {}, today).ok, false);
});

test('a diary needs notes and an explicit send-to-family answer', () => {
  const today = '2026-09-29';
  assert.deepEqual(validateWrite('diary', { notes_text: 'Comió todo.' }, today).errors, ['ASK_SEND_TO_PARENTS']);
  assert.ok(validateWrite('diary', { send_to_parents: true }, today).errors.includes('MISSING_NOTES'));
  const ok = validateWrite('diary', {
    notes_text: '<b>Comió</b> todo.', food: 'todo', sleep_hours: 1, sleep_minutes: 30,
    bathroom_pipi: true, teacher_id: 'spoof', send_to_parents: false,
  }, today);
  assert.equal(ok.ok, true);
  assert.equal(ok.data.notes_text, 'Comió todo.');
  assert.equal(ok.data.teacher_id, undefined);
  assert.equal(ok.data.sent_to_parents, false);
  assert.ok(validateWrite('diary', { notes_text: 'x', food: 'pizza', send_to_parents: true }, today).errors.includes('BAD_FOOD'));
  assert.ok(validateWrite('diary', { notes_text: 'x', sleep_minutes: 90, send_to_parents: true }, today).errors.includes('BAD_SLEEP_MINUTES'));
});

test('write dates cannot be in the future or too far back', () => {
  const today = '2026-09-29';
  assert.deepEqual(resolveWriteDate(undefined, today), { date: today });
  assert.deepEqual(resolveWriteDate('2026-09-30', today), { error: 'FUTURE_DATE' });
  assert.deepEqual(resolveWriteDate('2026-02-30', today), { error: 'BAD_DATE' });
  assert.deepEqual(resolveWriteDate('2026-08-01', today), { error: 'DATE_TOO_OLD' });
  assert.deepEqual(resolveWriteDate('2026-09-01', today), { date: '2026-09-01' });
});

test('the confirmation code binds who, what, which student and which day', async () => {
  const base = { userId: 'u2', kind: 'attendance', studentId: 's1', data: { status: 'absent', date: '2026-09-29' }, day: '2026-09-29' };
  const code = await confirmationCode(base);
  assert.match(code, /^[0-9a-f]{10}$/);
  // Key order does not matter (the model may reorder the JSON)…
  assert.equal(await confirmationCode({ ...base, data: { date: '2026-09-29', status: 'absent' } }), code);
  // …but any change to what is written, for whom, by whom or on which day does.
  assert.notEqual(await confirmationCode({ ...base, studentId: 's2' }), code);
  assert.notEqual(await confirmationCode({ ...base, data: { ...base.data, status: 'present' } }), code);
  assert.notEqual(await confirmationCode({ ...base, userId: 'u9' }), code);
  assert.notEqual(await confirmationCode({ ...base, day: '2026-09-30' }), code);
});

test('denials explain themselves; they must not read like an empty result', () => {
  for (const code of ['NO_PROFILE', 'INACTIVE_PROFILE', 'NOT_ALLOWED_FOR_ROLE', 'STUDENT_NOT_VISIBLE', 'WRITE_BLOCKED']) {
    assert.doesNotMatch(errorMessage(code), /no hay información/i);
    assert.notEqual(errorMessage(code), errorMessage('SOMETHING_UNKNOWN'));
  }
});

test('the write summary the teacher confirms is all Spanish, no field names', () => {
  const text = describeWrite('diary', 'Sofía Pérez', {
    date: '2026-03-02', notes_text: 'Pintó con acuarelas.', general_mood: 'feliz', food_mood: 'neutral',
    uniform_status: 'limpio', behavior: 'necesita_apoyo', sent_to_parents: true,
  });
  assert.match(text, /lunes 2 de marzo/);
  assert.match(text, /ánimo: feliz/);
  assert.match(text, /comió: regular/);
  assert.match(text, /uniforme: limpio/);
  assert.match(text, /comportamiento: necesita apoyo/);
  assert.doesNotMatch(text, /general mood|food mood|uniform status|_/);
});

test('zoneless Base44 timestamps are read as UTC before taking the Mexico day', () => {
  // 03:00 UTC on the 30th is still the 29th in Mexico (UTC-6).
  assert.equal(mexicoDayOf('2026-09-30T03:00:00.000000'), '2026-09-29');
  assert.equal(mexicoDayOf('2026-09-30T03:00:00Z'), '2026-09-29');
  assert.equal(mexicoDayOf('2026-09-30'), '2026-09-30');
  assert.equal(mexicoDayOf(''), '');
  assert.equal(mexicoDayOf('not a date'), '');
});

// --- QA r5 on v1.8.2 (2026-10-01) ---------------------------------------------

test('"tareas pendientes" looks a month ahead, not a week (LP01)', () => {
  // Asked on Thursday Oct 1; two homeworks were due Tuesday Oct 20 and the
  // 7-day default answered "no hay tareas".
  const range = homeworkRange('2026-10-01');
  assert.equal(HOMEWORK_DEFAULT_DAYS >= 30, true);
  assert.deepEqual(range, { from: '2026-10-01', to: '2026-10-31' });
  assert.ok(range.to >= '2026-10-20');
  // An explicit day is honoured ("¿qué tarea hay para mañana?").
  assert.deepEqual(homeworkRange('2026-10-01', '2026-10-02', '2026-10-02'), { from: '2026-10-02', to: '2026-10-02' });
  // A reversed or absurd range cannot widen into the whole history.
  assert.deepEqual(homeworkRange('2026-10-01', '2026-10-10', '2026-10-05'), { from: '2026-10-10', to: '2026-10-10' });
  assert.equal(homeworkRange('2026-10-01', '2026-10-01', '2030-01-01').to, addDays('2026-10-01', HOMEWORK_MAX_DAYS));
  assert.deepEqual(homeworkRange('2026-10-01', 'mañana', 42), { from: '2026-10-01', to: '2026-10-31' });
});

test('lumiQuery tells Lumi what comes next when the homework range is empty', () => {
  const src = read('base44/functions/lumiQuery/entry.ts');
  assert.match(src, /homeworkRange\(today, body\?\.from, body\?\.to\)/);
  assert.match(src, /nextDueGroup\(visible, to, today\)/);
  assert.doesNotMatch(src, /addDays\(from, 7\)/);
});

test('a student\'s attendance history stops at today; future records come apart (LM04)', () => {
  const rows = [
    { id: 'future', date: '2026-10-02', status: 'excused' },
    { id: 'today', date: '2026-10-01', status: 'present' },
    { id: 'tue', date: '2026-09-29', status: 'absent' },
    { id: 'old', date: '2026-09-01', status: 'absent' },
    { id: 'far', date: '2026-10-20', status: 'excused' },
    { id: 'bad', date: 'ayer', status: 'absent' },
  ];
  const { past, upcoming } = attendanceWindow(rows, '2026-10-01');
  assert.deepEqual(past.map((r) => r.id), ['today', 'tue']);
  assert.deepEqual(upcoming.map((r) => r.id), ['future', 'far']);
  const src = read('base44/functions/lumiQuery/entry.ts');
  assert.match(src, /attendanceWindow\(/);
  assert.match(src, /upcoming: upcomingRows/);
});

test('Lumi never greets by an email handle (LP12)', () => {
  // What Base44 stores when the person never typed a name.
  assert.equal(displayUserName('h.josepablo+qa-padre', 'h.josepablo+qa-padre@gmail.com'), '');
  assert.equal(displayUserName('h.josepablo+qa-padre'), '');
  assert.equal(displayUserName('ana@example.com'), '');
  assert.equal(displayUserName('ana.lopez', 'ana.lopez@example.com'), '');
  assert.equal(displayUserName('maria_88'), '');
  assert.equal(displayUserName(''), '');
  assert.equal(displayUserName(null), '');
  // Real names stay.
  assert.equal(displayUserName('Jose Pablo Herrera', 'h.josepablo@gmail.com'), 'Jose Pablo Herrera');
  assert.equal(displayUserName('Ana', 'ana@example.com'), '');
  assert.equal(displayUserName('Ana', 'mama.ana@example.com'), 'Ana');
  assert.equal(displayUserName('María José'), 'María José');
  const src = read('base44/functions/lumiQuery/entry.ts');
  // v1.9.0: the name the user chose in LIUMA (User.display_name) first; the
  // handle rule still applies to whatever is left.
  assert.match(src, /user_name: displayUserName\(user\.display_name \|\| user\.data\?\.display_name, user\.email\) \|\| displayUserName\(user\.full_name, user\.email\)/);
});

test('dirección\'s uniform list says it is open orders only (LD04)', () => {
  const src = read('base44/functions/lumiQuery/entry.ts');
  assert.match(src, /open_only: openOnly, delivered_count: deliveredCount/);
});

// Live QA of v1.8.3: two tasks were due on the 20th and Lumi named one,
// because next_due held the first match only.
test('next_due carries every task of the nearest due date, never a past one', () => {
  const rows = [
    { id: 'past', due_date: '2026-09-25' },
    { id: 'api', due_date: '2026-10-20' },
    { id: 'ui', due_date: '2026-10-20' },
    { id: 'later', due_date: '2026-10-27' },
  ];
  assert.deepEqual(nextDueGroup(rows, '2026-10-04', '2026-10-01').map((r) => r.id), ['api', 'ui']);
  // An empty past range never offers a past date as "the next one".
  assert.deepEqual(nextDueGroup(rows, '2026-09-20', '2026-10-01').map((r) => r.id), ['api', 'ui']);
  assert.deepEqual(nextDueGroup(rows, '2026-10-30', '2026-10-01'), []);
});

// Live QA of v1.8.3 (LM06/LM09): Lumi offered "pagos, uniformes" to a docente
// although those intents answer 403 for that role. The list it may offer now
// comes from the same tables that gate the intents.
test('helps_with never offers a role something its intents refuse', () => {
  const teacher = helpsWith('TEACHER', { attendance: true, diary: true });
  assert.ok(!teacher.some((t) => /pago|uniforme|configuraci/.test(t)), teacher.join(', '));
  assert.ok(teacher.includes('registrar asistencia'));
  const parent = helpsWith('PARENT');
  assert.ok(parent.includes('pagos pendientes') && parent.includes('pedidos de uniforme'));
  assert.ok(!parent.some((t) => /^registrar/.test(t)), parent.join(', '));
  assert.ok(helpsWith('ADMIN').includes('configuración inicial'));
  // No write offered unless the write gate says so (unknown = not offered).
  assert.ok(!helpsWith('TEACHER').some((t) => /^registrar/.test(t)));
});

test('a stored handle is not shown as a teacher name', () => {
  assert.equal(displayPersonName('h.josepablo+qa-maestro'), '');
  assert.equal(displayPersonName('Laura Méndez'), 'Laura Méndez');
  assert.equal(displayPersonName(null), '');
});

test('diary_recent tells staff whether each entry reached the family', () => {
  const src = read('base44/functions/lumiQuery/entry.ts');
  assert.match(src, /scope\.role === 'PARENT' \? \{\} : \{ sent_to_family: d\.sent_to_parents === true \}/);
  assert.match(src, /helps_with: helpsWith\(scope\.role, writable\)/);
});

// Codex review on #194: helps_with offered "registrar asistencia" to a teacher
// with a deny override or a read-only license, which guardedEntityWrite then
// refuses. writableKinds mirrors its precedence.
test('writes are offered only when guardedEntityWrite would accept them', () => {
  const base = { role: 'TEACHER', overrides: [], licenseReadOnly: false };
  assert.deepEqual(writableKinds(base), { attendance: true, diary: true });
  assert.deepEqual(writableKinds({ ...base, licenseReadOnly: true }), { attendance: false, diary: false });
  const denyDiary = [{ resource: 'DiaryEntry', action: 'write', effect: 'deny' }];
  assert.deepEqual(writableKinds({ ...base, overrides: denyDiary }), { attendance: true, diary: false });
  // A deny beats an allow, as in guardedEntityWrite.
  const both = [...denyDiary, { resource: 'DiaryEntry', action: 'write', effect: 'allow' }];
  assert.equal(writableKinds({ ...base, overrides: both }).diary, false);
  // A parent never gets a Lumi write, whatever an override says.
  const allow = [{ resource: 'Attendance', action: 'write', effect: 'allow' }];
  assert.deepEqual(writableKinds({ role: 'PARENT', overrides: allow, licenseReadOnly: false }), { attendance: false, diary: false });
});

test('the license copy in _lumiCore agrees with guardedEntityWrite', async () => {
  const { effectiveLicenseIsReadOnly } = await import('../../base44/functions/guardedEntityWrite/_policy.ts');
  const now = new Date('2026-10-01T12:00:00Z');
  const cases = [
    null,
    { subscription_status: 'active' },
    { subscription_status: 'view_only' },
    { subscription_status: 'suspended' },
    { subscription_status: 'canceled' },
    { subscription_status: 'inactive' },
    { subscription_status: 'trial', trial_end_date: '2026-10-29' },
    { subscription_status: 'trial', trial_end_date: '2026-09-01' },
    { subscription_status: 'trial' },
    { subscription_status: 'trial', license_tier: 'founder' },
    { subscription_status: 'view_only', license_tier: 'founder' },
  ];
  for (const c of cases) assert.equal(licenseIsReadOnly(c, now), effectiveLicenseIsReadOnly(c, now), JSON.stringify(c));
});
