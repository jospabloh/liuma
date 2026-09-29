// Admin home + Pagos: one "vencido" rule, no N+1 loads, filter-specific
// student cache keys, and Spanish copy that reads right.
//
// Runs under Mexico's time zone: the due-date bugs these guard against are
// invisible under UTC, which is what CI runners default to.
process.env.TZ = 'America/Mexico_City';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  isChargeOverdue,
  selectOverdueCharges,
  selectChargesToMarkOverdue,
  partitionCharges,
  isPaymentReminderDue,
  calendarDaysUntilDue,
  UNPAID_CHARGE_STATUSES,
} from '../../src/lib/payments/overdue.js';
import {
  schoolStudentsQueryKey,
  schoolStudentsFilter,
  percentOfStudentsCovered,
} from '../../src/lib/schoolStudents.js';
import { countLabel, capitalizeFirst } from '../../src/lib/spanishText.js';
import { schoolInviteCode, schoolInviteMessage, whatsappShareUrl } from '../../src/lib/schoolInvite.js';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// Tuesday 29 Sept 2026, 19:30 in Mexico — after 18:00, when native UTC parsing
// of 'YYYY-MM-DD' already rolls "today" into "yesterday".
const EVENING = new Date(2026, 8, 29, 19, 30);

test('the suite really runs at UTC-6', () => {
  assert.equal(EVENING.getTimezoneOffset(), 360);
});

test('a charge already flipped to OVERDUE counts as vencido (home used to show 0)', () => {
  // The reported mismatch: PagosAdmin had stored OVERDUE, the home only
  // counted PENDING-past-due, so the director saw "Pagos vencidos 0" next to
  // "Vencidos 1" on the Pagos page.
  const charges = [{ id: 'c1', status: 'OVERDUE', due_date: '2026-09-01' }];
  assert.equal(selectOverdueCharges(charges, EVENING).length, 1);
  assert.equal(partitionCharges(charges, EVENING).overdue.length, 1);
});

test('a PENDING charge past its due date is vencido even if the OVERDUE write never happened', () => {
  const charge = { id: 'c2', status: 'PENDING', due_date: '2026-09-28' };
  assert.equal(isChargeOverdue(charge, EVENING), true);
  // …and it is listed under Vencidos, not Pendientes.
  const { pending, overdue } = partitionCharges([charge], EVENING);
  assert.deepEqual(pending, []);
  assert.deepEqual(overdue.map((c) => c.id), ['c2']);
});

test('a charge due TODAY is not vencido, even in the evening in Mexico', () => {
  // Native `new Date('2026-09-29')` is 18:00 on the 28th locally, so the old
  // `isPast(new Date(due_date))` flagged it — and PagosAdmin persisted OVERDUE
  // — a day early.
  const charge = { id: 'c3', status: 'PENDING', due_date: '2026-09-29' };
  assert.equal(isChargeOverdue(charge, EVENING), false);
  assert.deepEqual(selectChargesToMarkOverdue([charge], EVENING), []);
});

test('paid charges are never vencido, and home + Pagos agree on a mixed set', () => {
  const charges = [
    { id: 'a', status: 'PAID', due_date: '2026-01-01' },
    { id: 'b', status: 'OVERDUE', due_date: '2026-09-01' },
    { id: 'c', status: 'PENDING', due_date: '2026-09-10' },
    { id: 'd', status: 'PENDING', due_date: '2026-10-10' },
    { id: 'e', status: 'PENDING', due_date: '2026-09-29' },
  ];
  const home = selectOverdueCharges(charges, EVENING).map((c) => c.id);
  const pagos = partitionCharges(charges, EVENING);
  assert.deepEqual(home, ['b', 'c']);
  assert.deepEqual(pagos.overdue.map((c) => c.id), home);
  assert.deepEqual(pagos.pending.map((c) => c.id), ['d', 'e']);
  assert.deepEqual(pagos.paid.map((c) => c.id), ['a']);
  assert.deepEqual(selectChargesToMarkOverdue(charges, EVENING).map((c) => c.id), ['c']);
});

test('the home fetches exactly the statuses that can be vencido', () => {
  assert.deepEqual([...UNPAID_CHARGE_STATUSES].sort(), ['OVERDUE', 'PENDING']);
});

test('payment reminders fire once inside the 7-day window, not only on day 7 exactly', () => {
  const due = (date, extra = {}) => ({ id: date, status: 'PENDING', due_date: date, ...extra });
  assert.equal(calendarDaysUntilDue('2026-10-06', EVENING), 7);
  assert.equal(isPaymentReminderDue(due('2026-10-06'), EVENING), true);
  // Nobody opened Pagos on day 7: the old `=== 7` rule never reminded again.
  assert.equal(isPaymentReminderDue(due('2026-10-02'), EVENING), true);
  assert.equal(isPaymentReminderDue(due('2026-09-29'), EVENING), true);
  assert.equal(isPaymentReminderDue(due('2026-10-07'), EVENING), false);
  assert.equal(isPaymentReminderDue(due('2026-09-28'), EVENING), false);
  // One reminder per charge.
  assert.equal(isPaymentReminderDue(due('2026-10-02', { reminder_sent: true }), EVENING), false);
  assert.equal(isPaymentReminderDue({ ...due('2026-10-02'), status: 'PAID' }, EVENING), false);
});

test('active and all-students lists never share a React Query cache slot', () => {
  const active = schoolStudentsQueryKey('s1');
  const all = schoolStudentsQueryKey('s1', { activeOnly: false });
  assert.notDeepEqual(active, all);
  assert.deepEqual(schoolStudentsFilter('s1'), { school_id: 's1', is_active: true });
  assert.deepEqual(schoolStudentsFilter('s1', { activeOnly: false }), { school_id: 's1' });
});

test('no package page still uses the shared ["allStudents", school_id] key', () => {
  for (const path of [
    'src/components/home/AdminHome.jsx',
    'src/pages/AvisosAdmin.jsx',
    'src/pages/PagosAdmin.jsx',
    'src/pages/GestionEscuela.jsx',
    'src/pages/GestionPedidosAdmin.jsx',
    'src/pages/ConfiguracionInicial.jsx',
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /\['allStudents'/, `${path} still uses the filter-less key`);
    assert.match(source, /useSchoolStudents\(/, `${path} should load students through useSchoolStudents`);
  }
});

test('coverage ignores rows for students outside the list, so it never passes 100%', () => {
  // Contacts are fetched per school now, which includes inactive students'.
  const students = [{ id: 'a' }, { id: 'b' }];
  const contacts = [
    { student_id: 'a' }, { student_id: 'a' },
    { student_id: 'inactive-1' }, { student_id: 'inactive-2' },
  ];
  assert.equal(percentOfStudentsCovered(students, contacts), 50);
  assert.equal(percentOfStudentsCovered([], contacts), 0);
});

test('emergency contacts load in one school-wide query, not one request per student', () => {
  for (const path of ['src/components/home/AdminHome.jsx', 'src/pages/ConfiguracionInicial.jsx']) {
    const source = read(path);
    assert.doesNotMatch(source, /for \(const student of students\)/, `${path} still loops per student`);
    assert.doesNotMatch(source, /EmergencyContact\.filter\(\{\s*student_id/, `${path} still filters per student`);
    assert.match(source, /EmergencyContact\.filter\(\s*\{\s*school_id: userProfile\.school_id\s*\}/);
  }
});

test('admin home shows status and the invite code before the navigation tiles', () => {
  const source = read('src/components/home/AdminHome.jsx');
  const statsAt = source.indexOf('Resumen de hoy');
  const inviteAt = source.indexOf('<SchoolInviteCard');
  const tilesAt = source.indexOf('Personas y operación');
  assert.ok(statsAt > 0 && inviteAt > 0 && tilesAt > 0);
  assert.ok(statsAt < tilesAt, 'stats must come before the tiles');
  assert.ok(inviteAt < tilesAt, 'invite code must come before the tiles');
  // Plain-Spanish labels instead of jargon.
  assert.doesNotMatch(source, /Setup general|Maestro-salón|Alumno-padre/);
  assert.match(source, /Copiar/);
  assert.match(source, /Compartir por WhatsApp/);
});

test('counts are pluralised in Spanish', () => {
  assert.equal(countLabel(1, 'alumno'), '1 alumno');
  assert.equal(countLabel(0, 'alumno'), '0 alumnos');
  assert.equal(countLabel(3, 'salón', 'salones'), '3 salones');
  assert.equal(countLabel(1, 'salón', 'salones'), '1 salón');
  assert.match(read('src/pages/GestionEscuela.jsx'), /countLabel\(getStudentCount\(classroom\.id\), 'alumno'\)/);
});

test('dates capitalise only the first letter ("Martes 29 de septiembre")', () => {
  assert.equal(capitalizeFirst('martes 29 de septiembre'), 'Martes 29 de septiembre');
  assert.equal(capitalizeFirst(''), '');
  const chrome = read('src/components/home/HomeChrome.jsx');
  assert.doesNotMatch(chrome, /className="[^"]*\bcapitalize\b/);
  assert.match(chrome, /capitalizeFirst\(eyebrow\)/);
});

test('invite code prefers a short join_code and falls back to the id onboarding accepts today', () => {
  assert.equal(schoolInviteCode({ id: '696e9b34b4402eca67ec8612' }), '696e9b34b4402eca67ec8612');
  assert.equal(schoolInviteCode({ id: '696e9b34b4402eca67ec8612', join_code: ' ABC123 ' }), 'ABC123');
  assert.equal(schoolInviteCode(null), '');
  const message = schoolInviteMessage({ schoolName: 'Colegio Sol', code: 'ABC123', appUrl: 'https://liuma.app' });
  assert.match(message, /ABC123/);
  assert.match(message, /https:\/\/liuma\.app/);
  const url = whatsappShareUrl(message);
  assert.ok(url.startsWith('https://wa.me/?text='));
  assert.equal(decodeURIComponent(url.slice('https://wa.me/?text='.length)), message);
});

test('the all-classrooms list does not share a cache slot with the active-classrooms lists', () => {
  // GestionEscuela lists inactive classrooms too; AdminHome/AvisosAdmin count
  // active ones under ['allClassrooms', school_id]. Same collision as students.
  assert.match(read('src/pages/GestionEscuela.jsx'), /queryKey: \['allClassrooms', userProfile\?\.school_id, 'all'\]/);
  for (const path of ['src/components/home/AdminHome.jsx', 'src/pages/AvisosAdmin.jsx']) {
    const source = read(path);
    const at = source.indexOf("queryKey: ['allClassrooms'");
    assert.ok(at > 0, path);
    assert.match(source.slice(at, at + 250), /is_active: true/, `${path} caches active classrooms only`);
  }
});

test('admin home stats show "—" instead of a confident 0 while loading or after a failed load', () => {
  const source = read('src/components/home/AdminHome.jsx');
  assert.match(source, /q\.isPending \|\| q\.isError/);
  assert.match(source, /statValue\(overdueCharges\.length, overdueChargesQuery\)/);
});

test('payment reminders wait for the school row (its notification preferences)', () => {
  const source = read('src/pages/PagosAdmin.jsx');
  assert.match(source, /if \(!schoolFetched\) return;/);
  // A malformed due date renders a fallback instead of crashing the page.
  assert.doesNotMatch(source, /format\(parseLocalDate\(/);
});
