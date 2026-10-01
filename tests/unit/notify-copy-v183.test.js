import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
// The REAL server code (Node 22 strips the TS types), never a look-alike.
import {
  emergencyAuthorName,
  moneyLabel,
  paymentLabels,
} from '../../base44/functions/sendBulkNotification/_fanout.ts';
import { APP_URL, NOTIFICATION_TEMPLATES } from '../../base44/functions/sendNotificationEmail/_templates.ts';
import {
  buildFamilyPayload,
  checkAbsenceRequest,
  isCalendarDate,
  mexicoToday as familyToday,
} from '../../base44/functions/guardedFamilyWrite/_policy.ts';
import { mexicoToday as moneyToday } from '../../base44/functions/guardedEntityWrite/_money.ts';
import { collapseInbox, unreadNoticeCount } from '../../src/lib/notifications/inbox.js';
import { pluralEs } from '../../src/lib/pluralEs.js';
import { studentClassroomLabel } from '../../src/lib/studentClassroomLabel.js';
import { humanizeError } from '../../src/lib/errorMessages.js';

// v1.8.3 — what live QA of v1.8.2 (2026-10-01) found in notifications, copy
// and small mobile details. Each block names the finding it pins.

function read(rel) {
  return fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
}

// --- 1. one emergency alert read as "4 urgentes sin leer" on a teacher's home --

// The live rows of the alert (Notice 6abe1d2a…): three per-child copies for
// one parent, and the teacher's own copy (no student on it).
const LIVE_COPIES = [
  { id: 'a', notice_id: 'nE', recipient_user_id: 'parent', recipient_role: 'PARENT', student_id: 's3', status: 'SENT' },
  { id: 'b', notice_id: 'nE', recipient_user_id: 'parent', recipient_role: 'PARENT', student_id: 's1', status: 'SENT' },
  { id: 'c', notice_id: 'nE', recipient_user_id: 'teacher', recipient_role: 'TEACHER', student_id: null, status: 'SENT' },
  { id: 'd', notice_id: 'nE', recipient_user_id: 'parent', recipient_role: 'PARENT', student_id: 's2', status: 'SENT' },
];
const URGENT = [{ id: 'nE', priority: 'URGENT', is_emergency: true }, { id: 'nN', priority: 'NORMAL' }];

test('the teacher counts the alert once, from their own copy only', () => {
  // What TeacherHome used to count: every unread copy it could read.
  assert.equal(LIVE_COPIES.length, 4);
  assert.equal(unreadNoticeCount(LIVE_COPIES, URGENT, { userId: 'teacher' }), 1);
  // Reading it (the only copy the teacher can mark) clears the badge.
  const read = LIVE_COPIES.map((row) => (row.recipient_user_id === 'teacher' ? { ...row, status: 'READ' } : row));
  assert.equal(unreadNoticeCount(read, URGENT, { userId: 'teacher' }), 0, 'families\' unread copies must not keep the badge up');
  // The parent with three children: one notice, not three.
  assert.equal(unreadNoticeCount(LIVE_COPIES, URGENT, { userId: 'parent' }), 1);
});

test('the badge agrees with the inbox it leads to', () => {
  const mine = LIVE_COPIES.filter((row) => row.recipient_user_id === 'teacher');
  const inbox = collapseInbox(mine, new Map(URGENT.map((n) => [n.id, n])));
  const unreadUrgentInInbox = inbox.filter((e) => e.notice.priority === 'URGENT' && e.delivery.status === 'SENT').length;
  assert.equal(unreadNoticeCount(LIVE_COPIES, URGENT, { userId: 'teacher' }), unreadUrgentInInbox);
});

test('only URGENT notices count, and no viewer means no count', () => {
  const normal = [{ notice_id: 'nN', recipient_user_id: 'teacher', status: 'SENT' }];
  assert.equal(unreadNoticeCount(normal, URGENT, { userId: 'teacher' }), 0);
  assert.equal(unreadNoticeCount(LIVE_COPIES, URGENT, {}), 0);
  assert.equal(unreadNoticeCount(null, null, { userId: 'teacher' }), 0);
});

test('TeacherHome asks only for its own copies, and both homes use the one rule', () => {
  const teacher = read('src/components/home/TeacherHome.jsx');
  assert.match(teacher, /deliveries: \['NoticeDelivery', \{ school_id, recipient_user_id: user\.id, status: 'SENT' \}/);
  assert.doesNotMatch(teacher, /classStudentIds\.has\(row\.student_id\)/, 'families\' copies must not be counted again');
  assert.match(read('src/components/home/ParentHome.jsx'), /unreadNoticeCount\(unreadDeliveries, notices, \{ userId: user\.id \}\)/);
});

test('the teacher inbox says when it failed to load instead of looking empty', () => {
  const page = read('src/pages/AvisosMaestro.jsx');
  assert.match(page, /isError: receivedFailed, refetch: refetchReceived/);
  assert.match(page, /\{receivedFailed && received\.length === 0 && \(/);
  assert.match(page, /No pudimos cargar los avisos que te envió la escuela\./);
  assert.match(page, /onClick=\{\(\) => refetchReceived\(\)\}/);
  // "Sin avisos" is for an empty list, never for a failed one.
  assert.match(page, /noticesFailed && notices\.length === 0 \? \(/);
  // One request for the inbox: two separate reads doubled the rate-limit
  // exposure, and a failed half emptied the section.
  const inbox = read('src/lib/notifications/readInbox.js');
  assert.match(inbox, /schoolReadMany\(\{/);
  assert.doesNotMatch(inbox, /\bschoolRead\(/);
});

// --- 2. small copy: "3 salónes", blank alert author, "Sin salón" --------------

test('Spanish plurals are spelled out, never "salón" + "es"', () => {
  assert.equal(pluralEs(1, 'salón', 'salones'), '1 salón');
  assert.equal(pluralEs(3, 'salón', 'salones'), '3 salones');
  assert.equal(pluralEs(0, 'salón', 'salones'), '0 salones');
  const teacher = read('src/components/home/TeacherHome.jsx');
  assert.match(teacher, /pluralEs\(classrooms\.length, 'salón', 'salones'\)/);
  assert.doesNotMatch(teacher, /salón\$\{/);
});

test('the emergency Notice carries an author name, never blank or an email', () => {
  assert.equal(emergencyAuthorName({ full_name: '  Laura Gómez ' }), 'Laura Gómez');
  assert.equal(emergencyAuthorName({ full_name: '' }), 'Dirección de la escuela');
  assert.equal(emergencyAuthorName({ full_name: 'h.josepablo+qa-director@gmail.com' }), 'Dirección de la escuela');
  assert.equal(emergencyAuthorName(null), 'Dirección de la escuela');
  assert.match(read('base44/functions/sendBulkNotification/entry.ts'), /author_id: user\.id,\s*author_name: emergencyAuthorName\(user\),/);
});

test('"Sin salón" means the student has none — not that the read failed', () => {
  assert.deepEqual(studentClassroomLabel({ classroomId: '' }), { text: 'Sin salón', state: 'none' });
  assert.equal(studentClassroomLabel({ classroomId: 'c1', classroom: { name: 'A-Salón 1' } }).text, 'A-Salón 1');
  assert.equal(studentClassroomLabel({ classroomId: 'c1', isError: true }).state, 'error');
  assert.equal(studentClassroomLabel({ classroomId: 'c1', isLoading: true }).state, 'loading');
  assert.equal(studentClassroomLabel({ classroomId: 'c1' }).state, 'missing');
  for (const input of [{ classroomId: 'c1', isError: true }, { classroomId: 'c1', isLoading: true }, { classroomId: 'c1' }]) {
    assert.notEqual(studentClassroomLabel(input).text, 'Sin salón', JSON.stringify(input));
  }
  const page = read('src/pages/GestionAlumno.jsx');
  assert.doesNotMatch(page, /classroom\?\.name \|\| 'Sin salón'/);
  assert.match(page, /onClick=\{\(\) => refetchClassroom\(\)\}/);
});

// --- 3. absence requests: past days and duplicates -----------------------------

const FAMILY_CTX = { isAdmin: false, userId: 'parent-1', userName: 'Ana', schoolId: 'A', studentId: 's1', today: '2026-10-01' };
const absence = (date, extra = {}) =>
  buildFamilyPayload('AbsenceNotification', 'create', { absence_date: date, reason: 'Cita médica' }, { ...FAMILY_CTX, ...extra });

test('an absence request is for the school\'s today or later', () => {
  // v1.8.1 evidence: a direct call filed one for 2026-09-01.
  assert.equal(absence('2026-09-01').code, 'ABSENCE_DATE_PAST');
  assert.equal(absence('2026-09-30').code, 'ABSENCE_DATE_PAST');
  assert.equal(absence('2026-10-01').ok, true, 'today is allowed');
  assert.equal(absence('2026-10-20').ok, true);
  assert.equal(absence('2026-02-31').ok, false, 'not a real day');
  assert.equal(isCalendarDate('2028-02-29'), true);
  assert.equal(isCalendarDate('2027-02-29'), false);
});

test('one live request per child per day; a rejected one may be filed again', () => {
  const stored = (status, extra = {}) => ({ student_id: 's1', absence_date: '2026-10-05', status, ...extra });
  assert.equal(absence('2026-10-05', { sameDayAbsences: [stored('PENDING')] }).code, 'ABSENCE_DUPLICATE');
  assert.equal(absence('2026-10-05', { sameDayAbsences: [stored('APPROVED')] }).code, 'ABSENCE_DUPLICATE');
  assert.equal(absence('2026-10-05', { sameDayAbsences: [stored('REJECTED')] }).ok, true);
  // Another child or another day is not a duplicate.
  assert.equal(absence('2026-10-05', { sameDayAbsences: [stored('PENDING', { student_id: 's2' })] }).ok, true);
  assert.equal(absence('2026-10-05', { sameDayAbsences: [stored('PENDING', { absence_date: '2026-10-06' })] }).ok, true);
  assert.equal(checkAbsenceRequest({ absenceDate: '2026-10-05', studentId: 's1', today: '2026-10-01', sameDay: null }).ok, true);
});

test('the function reads the stored same-day requests and uses the school\'s today', () => {
  const entry = read('base44/functions/guardedFamilyWrite/entry.ts');
  assert.match(entry, /sr\.entities\.AbsenceNotification\.filter\(\{ student_id: studentId, absence_date: day \}/);
  assert.match(entry, /today: mexicoToday\(\),\s*sameDayAbsences,/);
  assert.match(entry, /built\.code === 'ABSENCE_DUPLICATE' \? 409 : 400/);
  // Same Mexico day as the payments code, even at 20:00 local (02:00 UTC).
  const evening = new Date('2026-10-02T02:00:00.000Z');
  assert.equal(familyToday(evening), '2026-10-01');
  assert.equal(familyToday(evening), moneyToday(evening));
});

test('the form says why the server refused, in Spanish', () => {
  const err = (code) => Object.assign(new Error(code), { status: 400, response: { status: 400, data: { ok: false, code } } });
  assert.match(humanizeError(err('ABSENCE_DATE_PAST')), /hoy o un día futuro/);
  assert.match(humanizeError(err('ABSENCE_DUPLICATE')), /Ya hay una solicitud/);
  const page = read('src/pages/SolicitarAusencia.jsx');
  assert.match(page, /toast\.error\(`No se pudo enviar la solicitud\. \$\{humanizeError\(error\)\}`\)/);
  assert.match(page, /Ya enviaste una solicitud para ese día\./);
});

// --- 4. payment emails ------------------------------------------------------------

test('amounts read "$1,350.00 MXN" on any runtime', () => {
  assert.equal(moneyLabel(1350), '$1,350.00 MXN');
  assert.equal(moneyLabel(600), '$600.00 MXN');
  assert.equal(moneyLabel(1234567.5), '$1,234,567.50 MXN');
  assert.equal(moneyLabel('0.1'), '$0.10 MXN');
  assert.equal(moneyLabel(1080.005), '$1,080.01 MXN');
  assert.equal(moneyLabel(-180), '-$180.00 MXN');
  assert.equal(moneyLabel(null), '$0.00 MXN');
  assert.equal(moneyLabel(undefined), '');
  // The deployed function printed "$1350.00": its Intl did not group es-MX
  // thousands. The label must not depend on Intl at all.
  const saved = { toLocaleString: Number.prototype.toLocaleString, NumberFormat: Intl.NumberFormat };
  try {
    Number.prototype.toLocaleString = function () { return 'ICU'; };
    Intl.NumberFormat = function () { throw new Error('no ICU'); };
    assert.equal(moneyLabel(1350), '$1,350.00 MXN');
  } finally {
    Number.prototype.toLocaleString = saved.toLocaleString;
    Intl.NumberFormat = saved.NumberFormat;
  }
});

test('a partial payment shows what was paid; an unpaid charge only its balance', () => {
  assert.deepEqual(paymentLabels({ amount: 1000, amount_paid: 400 }), { totalLabel: '$1,000.00 MXN', paidLabel: '$400.00 MXN' });
  assert.deepEqual(paymentLabels({ amount: 1000 }), { totalLabel: '', paidLabel: '' });
  assert.deepEqual(paymentLabels({ amount: 1000, amount_paid: 0 }), { totalLabel: '', paidLabel: '' });
  const bulk = read('base44/functions/sendBulkNotification/entry.ts');
  assert.match(bulk, /\.\.\.paymentLabels\(claim\.charge\),/);
  // Every date in an email carries its year.
  assert.match(bulk, /deadlineLabel: spanishDate\(event\.confirmation_deadline\),/);
});

const PARTIAL = {
  studentName: 'Ana', conceptName: 'Colegiatura octubre', amountLabel: '$600.00 MXN',
  dueDateLabel: '29 de octubre, 2026', totalLabel: '$1,000.00 MXN', paidLabel: '$400.00 MXN',
};

test('the payment reminder neither rushes nor threatens', () => {
  // Live QA: a PARTIAL charge due in four weeks got "vence pronto … para
  // evitar recargos". LIUMA charges no late fees, and the date says how soon.
  for (const event of ['payment_due', 'payment_overdue']) {
    const body = NOTIFICATION_TEMPLATES[event].emailBody(PARTIAL);
    const subject = NOTIFICATION_TEMPLATES[event].subject(PARTIAL);
    assert.doesNotMatch(body + subject, /vence pronto|próximo a vencer|recargo/i, event);
    assert.match(body, /Total del cargo:<\/strong> \$1,000\.00 MXN/, event);
    assert.match(body, /Ya pagado:<\/strong> \$400\.00 MXN/, event);
    assert.match(body, /Saldo pendiente:<\/strong> \$600\.00 MXN/, event);
    const unpaid = NOTIFICATION_TEMPLATES[event].emailBody({ ...PARTIAL, totalLabel: '', paidLabel: '' });
    assert.doesNotMatch(unpaid, /Ya pagado/, `${event}: no breakdown when nothing is paid`);
  }
  assert.equal(NOTIFICATION_TEMPLATES.payment_due.subject(PARTIAL), 'Recordatorio de pago - Ana');
});

test('every LIUMA email links back to the app at its own domain', () => {
  assert.equal(APP_URL, 'https://liuma.acaciaco.com.mx/');
  for (const [event, template] of Object.entries(NOTIFICATION_TEMPLATES)) {
    const body = template.emailBody({ ...PARTIAL, message: 'x', ticketNumber: 'T-1', actionHint: 'x', statusLabel: 'x', statusDetail: 'x' });
    assert.match(body, /<a href="https:\/\/liuma\.acaciaco\.com\.mx\/"[^>]*>Abrir LIUMA<\/a>/, event);
  }
  const parents = read('base44/functions/notifyParents/entry.ts');
  assert.equal((parents.match(/\$\{appButton\(\)\}/g) || []).length, 2, 'absence and diary emails');
  // Its own copy of appButton (no cross-directory imports) stays identical.
  const fn = (src) => src.match(/function appButton\(\): string \{[\s\S]*?\n\}/)?.[0];
  assert.ok(fn(parents));
  assert.equal(fn(parents), fn(read('base44/functions/sendNotificationEmail/_templates.ts')).replace(/^export /, ''));
  assert.match(parents, /const APP_URL = 'https:\/\/liuma\.acaciaco\.com\.mx\/';/);
});

test('the absence email writes its date like every other email', () => {
  const parents = read('base44/functions/notifyParents/entry.ts');
  assert.doesNotMatch(parents, /ddmmyyyy/);
  assert.match(parents, /const dateLabel = escapeHtml\(spanishDate\(String\(record\.date \|\| ''\), true\)\);/);
});

test('the client templates.js renders exactly what the server sends', async () => {
  // templates.js imports through the '@' alias; point it at the real file.
  const source = read('src/lib/notifications/templates.js').replace(
    "from '@/lib/htmlEscape'",
    `from '${pathToFileURL(path.resolve('src/lib/htmlEscape.js')).href}'`,
  );
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'liuma-tpl-')), 'templates.mjs');
  fs.writeFileSync(tmp, source);
  const client = (await import(pathToFileURL(tmp).href)).NOTIFICATION_TEMPLATES;
  const ctx = { ...PARTIAL, userName: 'U', userEmail: 'u@x.mx', roleName: 'Padre', schoolName: 'Escuela', eventTitle: 'Festival', dateLabel: '5 de octubre, 2026', timeLabel: '9:00', locationLabel: 'Patio', deadlineLabel: '3 de octubre, 2026', message: 'Simulacro', ticketNumber: 'T-1', subjectText: 'Ayuda', requesterName: 'Ana', categoryLabel: 'Pagos', priorityLabel: 'alta', slaDateLabel: 'mañana', description: 'd', replyBody: 'r', resolutionNote: 'n' };
  const shared = Object.keys(NOTIFICATION_TEMPLATES).filter((k) => client[k]);
  assert.ok(shared.includes('payment_due') && shared.includes('payment_overdue') && shared.includes('emergency_alert'));
  for (const key of shared) {
    assert.equal(client[key].subject(ctx), NOTIFICATION_TEMPLATES[key].subject(ctx), `${key} subject`);
    assert.equal(client[key].emailBody(ctx), NOTIFICATION_TEMPLATES[key].emailBody(ctx), `${key} body`);
  }
});

// --- 5. mobile: tap targets and iOS focus zoom ------------------------------------

test('small controls give a finger 44px', () => {
  // Sonner's 20x20 close button: a 44x44 hit area, same look.
  assert.match(read('src/components/ui/sonner.jsx'), /closeButton: "after:absolute after:-inset-3"/);
  // The Switch already had one (36x20 drawn, 44x44 hit) — keep it.
  assert.match(read('src/components/ui/switch.jsx'), /h-5 w-9 [^"]*after:absolute after:-inset-x-1 after:-inset-y-3/);
  // /entrar: show-password 44x44 inside the 48px field; inline links 44 tall on touch.
  assert.match(read('src/components/auth/parts.jsx'), /absolute right-0\.5 top-1\/2 flex h-11 w-11/);
  const login = read('src/pages/Login.jsx');
  assert.match(login, /function LinkButton[\s\S]*?coarse:min-h-11/);
  assert.match(login, /coarse:min-h-11"\s*>\s*Usar otra cuenta/);
  // Icon-only row actions: size="icon" (44x44, was sm = 42 wide) and a name.
  const docs = read('src/pages/GestionDocumentos.jsx');
  assert.match(docs, /size="icon"\s*variant="outline"\s*aria-label="Descargar documento"/);
  assert.match(docs, /size="icon"\s*variant="outline"\s*aria-label="Eliminar documento"/);
  const discounts = read('src/pages/GestionDescuentos.jsx');
  assert.match(discounts, /size="icon" variant="outline" aria-label="Editar descuento"/);
  assert.match(discounts, /size="icon"\s*variant="outline"\s*aria-label="Eliminar descuento"/);
  // Calendar days: tight gutters below sm so a day is 44px wide from 375px.
  const calendar = read('src/pages/CalendarioEscolar.jsx');
  assert.match(calendar, /grid grid-cols-7 gap-0\.5 sm:gap-2/);
  assert.match(calendar, /shadow-sm p-2 sm:p-6/);
});
