// Director forms (QA 2026-09-30, area director-forms). Four findings, each
// pinned here with what was wrong:
//   1. No screen could record a student's allergies, medical notes or blood
//      type, or edit a student at all — the server always allowed it.
//   2. A failed document upload left the button on "Subiendo..." for good and
//      rejected unhandled.
//   3. Deleting a permission exception had no error handling.
//   4. Required fields were reported by a disabled button (salón, alumno), by
//      the browser's own tooltip in the browser's language (documentos), or by
//      one line under "Motivo" far from the form that failed (permisos).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeFakeDb } from '../fixtures/fake-entity-db.js';
import { runSchoolWrite } from '../../base44/functions/guardedEntityWrite/_schoolWrite.ts';
import { SCHOOL_WRITES } from '../../base44/functions/guardedEntityWrite/_policy.ts';
import { canGuardedWrite } from '../../src/lib/authorization/guardedWritePolicy.js';
import {
  BLOOD_TYPES,
  DOCUMENT_FIELD_ORDER,
  MAX_LONG_TEXT,
  MAX_SHORT_TEXT,
  STUDENT_FIELD_ORDER,
  emptyStudentForm,
  firstErrorField,
  hasErrors,
  isPdfFile,
  studentCreatePayload,
  studentFormFromRecord,
  studentUpdatePatch,
  validateClassroomForm,
  validateDocumentForm,
  validateEventForm,
  validateStudentForm,
} from '../../src/lib/forms/directorForms.js';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
// Source without comments: the fixes explain in comments what they replaced
// (mutateAsync, text-destructive…), and those words must not satisfy or trip
// a check about the code.
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const readJsonc = (p) => JSON.parse(read(p).replace(/^\s*\/\/.*$/gm, ''));
const TODAY = new Date(2026, 8, 30, 12, 0, 0); // 30 Sep 2026, local noon

const validStudent = () => ({
  ...emptyStudentForm(),
  first_name: 'Ana',
  last_name: 'López',
  classroom_id: 'c1',
});

// --- 1. the student form can hold (and edit) the medical fields -------------

test('every field the student form sends is one the server accepts and the schema declares', () => {
  const server = SCHOOL_WRITES.Student;
  const schema = readJsonc('base44/entities/Student.jsonc');
  for (const field of STUDENT_FIELD_ORDER) {
    assert.ok(field in server.fields, `guardedEntityWrite drops Student.${field}`);
    assert.ok(field in schema.properties, `Student.jsonc has no ${field}`);
  }
  for (const medical of ['allergies', 'medical_notes', 'blood_type']) {
    assert.ok(STUDENT_FIELD_ORDER.includes(medical), `the form must be able to set ${medical}`);
  }
  // The form's length limits are the server's truncation limits: a longer
  // allergy list would otherwise be silently cut at the server.
  assert.equal(MAX_SHORT_TEXT, 300);
  assert.equal(MAX_LONG_TEXT, 5000);
  assert.equal(server.fields.allergies, 'text');
  assert.equal(server.fields.medical_notes, 'text');
  assert.equal(server.fields.first_name, 'string');
});

test('student validation names each missing required field, in Spanish', () => {
  const errors = validateStudentForm(emptyStudentForm(), { today: TODAY });
  assert.deepEqual(Object.keys(errors).sort(), ['classroom_id', 'first_name', 'last_name']);
  assert.equal(errors.first_name, 'Escribe el nombre del alumno.');
  assert.equal(errors.last_name, 'Escribe los apellidos del alumno.');
  assert.equal(errors.classroom_id, 'Elige el salón del alumno.');
  assert.equal(firstErrorField(errors, STUDENT_FIELD_ORDER), 'first_name');
  // Whitespace is not a name.
  assert.ok(validateStudentForm({ ...validStudent(), first_name: '   ' }, { today: TODAY }).first_name);
  assert.equal(hasErrors(validateStudentForm(validStudent(), { today: TODAY })), false);
});

test('student validation rejects impossible data the server would store anyway', () => {
  const v = (patch, opts = {}) => validateStudentForm({ ...validStudent(), ...patch }, { today: TODAY, ...opts });
  assert.match(v({ birth_date: '2026-10-01' }).birth_date, /posterior a hoy/);
  assert.equal(v({ birth_date: '2026-09-30' }).birth_date, undefined, 'born today is valid');
  assert.match(v({ birth_date: '2026-02-30' }).birth_date, /no es válida/);
  assert.match(v({ birth_date: '1850-01-01' }).birth_date, /año/);
  assert.match(v({ blood_type: 'Z+' }).blood_type, /tipo de sangre/);
  for (const type of BLOOD_TYPES) assert.equal(v({ blood_type: type }).blood_type, undefined);
  // A free-text value stored before the form existed stays valid on edit.
  assert.equal(v({ blood_type: 'O Rh+' }, { legacyBloodType: 'O Rh+' }).blood_type, undefined);
  assert.match(v({ allergies: 'x'.repeat(MAX_LONG_TEXT + 1) }).allergies, /máximo 5000/);
  assert.match(v({ classroom_id: 'gone' }, { classroomIds: ['c1'] }).classroom_id, /ya no está disponible/);
});

test('an edit sends only what changed, and a cleared allergy is sent as empty', () => {
  const stored = { id: 's1', first_name: 'Ana', last_name: 'López', classroom_id: 'c1', allergies: 'Cacahuate', blood_type: null, school_id: 'sA', is_active: true };
  const form = studentFormFromRecord(stored);
  assert.equal(form.blood_type, '', 'null becomes an empty field, not "null"');
  assert.deepEqual(studentUpdatePatch(stored, form), {}, 'opening and saving changes nothing');
  assert.deepEqual(
    studentUpdatePatch(stored, { ...form, allergies: '', medical_notes: '  Asma leve  ', classroom_id: 'c2' }),
    { allergies: '', medical_notes: 'Asma leve', classroom_id: 'c2' },
  );
  // Never school_id / is_active: the edit form does not move or retire a child.
  const create = studentCreatePayload({ ...validStudent(), school_id: 'sB', is_active: false });
  assert.equal('school_id' in create, false);
  assert.equal('is_active' in create, false);
});

test('the real write path: an ADMIN edit stores the medical fields and clears one; a TEACHER is refused', async () => {
  const db = makeFakeDb({
    UserProfile: [
      { id: 'p-admin', user_id: 'u-admin', school_id: 'sA', app_role: 'ADMIN', status: 'ACTIVE', onboarding_completed: true, created_date: '2026-09-01T00:00:00Z' },
      { id: 'p-teacher', user_id: 'u-teacher', school_id: 'sA', app_role: 'TEACHER', status: 'ACTIVE', onboarding_completed: true, created_date: '2026-09-01T00:00:00Z' },
    ],
    SchoolSubscription: [{ id: 'sub', school_id: 'sA', subscription_status: 'active', license_tier: 'growth' }],
    Classroom: [{ id: 'c1', school_id: 'sA', name: '1A', is_active: true }, { id: 'c2', school_id: 'sA', name: '2A', is_active: true }],
    Student: [{ id: 's1', school_id: 'sA', classroom_id: 'c1', first_name: 'Ana', last_name: 'López', allergies: 'Cacahuate', is_active: true }],
    AuditLog: [],
  });
  const now = new Date('2026-09-30T15:00:00Z');
  const stored = { id: 's1', school_id: 'sA', classroom_id: 'c1', first_name: 'Ana', last_name: 'López', allergies: 'Cacahuate', is_active: true };
  const patch = studentUpdatePatch(stored, {
    ...studentFormFromRecord(stored),
    allergies: '',
    blood_type: 'O+',
    medical_notes: 'Usa inhalador',
    classroom_id: 'c2',
  });
  const admin = await runSchoolWrite({
    sr: { entities: db.entities },
    user: { id: 'u-admin', full_name: 'Directora', email: 'd@a.mx' },
    body: { entity: 'Student', operation: 'update', id: 's1', data: patch },
    now,
  });
  assert.equal(admin.status, 200, JSON.stringify(admin.body));
  assert.equal(admin.body.record.allergies, null, 'a cleared allergy is removed, not kept');
  assert.equal(admin.body.record.blood_type, 'O+');
  assert.equal(admin.body.record.medical_notes, 'Usa inhalador');
  assert.equal(admin.body.record.classroom_id, 'c2');
  const audit = db.writes.find((w) => w.entity === 'AuditLog');
  assert.equal(audit.data.action, 'RECORD_UPDATED');
  assert.doesNotMatch(JSON.stringify(audit.data), /Usa inhalador/, 'the audit names fields, never a minor\'s medical data');

  const teacher = await runSchoolWrite({
    sr: { entities: db.entities },
    user: { id: 'u-teacher', full_name: 'Maestra', email: 't@a.mx' },
    body: { entity: 'Student', operation: 'update', id: 's1', data: { allergies: 'Nada' } },
    now,
  });
  assert.notEqual(teacher.status, 200, 'editing a student is ADMIN-only on the server');
  assert.equal(canGuardedWrite('TEACHER', 'Student', 'update'), false);
  assert.equal(canGuardedWrite('ADMIN', 'Student', 'update'), true);
});

test('GestionAlumno offers "Editar" to an ADMIN only and writes through guardedUpdate', () => {
  const src = read('src/pages/GestionAlumno.jsx');
  assert.match(src, /canGuardedWrite\(userProfile\?\.app_role, 'Student', 'update'\)/);
  assert.match(src, /\{canEditStudent && \(/);
  assert.match(src, /guardedUpdate\('Student', studentId, patch\)/);
  assert.match(src, /studentUpdatePatch\(student, form\)/);
  assert.match(src, /guardWrite\(canWrite, blockReadOnly\)/, 'a read-only license blocks the edit before the request');
  assert.match(src, /student\.allergies/);
  assert.match(src, /student\.medical_notes/);
  assert.match(src, /student\.blood_type/);
  assert.doesNotMatch(src, /base44\.entities\.Student/, 'Student RLS is platform-owner only');
});

test('Nuevo alumno and Editar alumno are the same form, with the medical fields', () => {
  const dialog = read('src/components/school/StudentFormDialog.jsx');
  for (const field of ['allergies', 'medical_notes', 'blood_type', 'birth_date', 'classroom_id']) {
    assert.match(dialog, new RegExp(`fieldProps\\('${field}'\\)`), `form has no ${field} field`);
  }
  assert.match(dialog, /<FieldError id="student-allergies-error"/);
  assert.match(read('src/pages/GestionEscuela.jsx'), /<StudentFormDialog[\s\S]*?mode="create"/);
  assert.match(read('src/pages/GestionAlumno.jsx'), /<StudentFormDialog[\s\S]*?mode="edit"/);
});

// --- 2. document upload never sticks on "Subiendo..." ------------------------

test('GestionDocumentos derives "Subiendo..." from the mutation, not from a flag an exception skips', () => {
  const src = code('src/pages/GestionDocumentos.jsx');
  assert.doesNotMatch(src, /mutateAsync/, 'await mutateAsync rejected past the handler');
  assert.doesNotMatch(src, /setIsUploading/, 'a flag cleared only after a successful await stays true on failure');
  assert.match(src, /const isUploading = uploadMutation\.isPending;/);
  assert.match(src, /uploadMutation\.mutate\(/);
  assert.match(src, /onError: \(error\) => \{[\s\S]*?humanizeError\(error\)/);
});

// --- 3. deleting a permission exception handles failure ---------------------

test('PermisosRoles.handleDeleteOverride catches a failed delete and keeps the reason for a retry', () => {
  const src = read('src/pages/PermisosRoles.jsx');
  const start = src.indexOf('const handleDeleteOverride = async');
  const body = src.slice(start, src.indexOf('const handleApplyRollback', start));
  assert.match(body, /try \{\s*await deletePermissionOverride\(overrideId\);\s*\} catch \(error\) \{/);
  const catchBlock = body.slice(body.indexOf('} catch (error) {'), body.indexOf('return;', body.indexOf('} catch (error) {')));
  assert.match(catchBlock, /toast\.error\(message\)/);
  assert.doesNotMatch(catchBlock, /setReasonText\(''\)/, 'a failed delete must keep the typed reason');
  // The extra audit row is best-effort: the delete already happened.
  assert.match(body, /logAuditEvent\([\s\S]*?\}\)\.catch\(/);
  assert.match(src, /disabled=\{Boolean\(deletingOverrideId\)\}/, 'no double delete while one is in flight');
});

// --- 4. field-level Spanish feedback ----------------------------------------

test('classroom and document validation name the field, in Spanish', () => {
  assert.deepEqual(validateClassroomForm({ name: ' ', grade: '' }), { name: 'Escribe el nombre del salón.' });
  assert.deepEqual(validateClassroomForm({ name: '1-A', grade: '1°' }), {});

  const pdf = { name: 'Menú semanal.PDF', type: '', size: 2048 };
  assert.equal(isPdfFile(pdf), true);
  assert.equal(isPdfFile({ name: 'foto.jpg', type: 'image/jpeg' }), false);
  const base = { title: 'Menú', valid_from: '2026-10-01', valid_until: '' };
  assert.deepEqual(validateDocumentForm(base, pdf), {});
  const missing = validateDocumentForm({ ...base, title: '' }, null);
  assert.equal(missing.title, 'Escribe el título del documento.');
  assert.equal(missing.file, 'Elige el archivo PDF que vas a subir.');
  assert.equal(firstErrorField(missing, DOCUMENT_FIELD_ORDER), 'title');
  assert.equal(validateDocumentForm(base, { name: 'x.docx', type: '' }).file, 'El archivo debe ser un PDF.');
  assert.match(validateDocumentForm({ ...base, valid_until: '2026-09-01' }, pdf).valid_until, /posterior a «Válido desde»/);
  // The server's upload rule (uploadSchoolFile, v1.9.0), surfaced on the field.
  assert.match(validateDocumentForm(base, { ...pdf, size: 11 * 1024 * 1024 }).file, /más de 10 MB/);
  assert.match(validateDocumentForm(base, { ...pdf, size: 0 }).file, /vacío/);
  assert.equal(validateDocumentForm(base, { name: 'menu', type: 'application/pdf', size: 10 }).file, 'El archivo debe ser PDF.');
});

test('the director forms no longer rely on a disabled button or the browser\'s own tooltip', () => {
  const escuela = read('src/pages/GestionEscuela.jsx');
  assert.doesNotMatch(escuela, /disabled=\{!classroomForm\.name/);
  assert.doesNotMatch(escuela, /disabled=\{!studentForm/);
  assert.match(escuela, /<FieldError id="classroom-name-error" message=\{classroomErrors\.name\}/);
  assert.match(escuela, /validateClassroomForm\(classroomForm\)/);

  const dialog = read('src/components/school/StudentFormDialog.jsx');
  assert.match(dialog, /<Button type="submit" disabled=\{isPending\}/);

  const docs = code('src/pages/GestionDocumentos.jsx');
  assert.doesNotMatch(docs, /\brequired\b(?!-)/, 'native required shows a tooltip in the browser\'s language');
  assert.match(docs, /noValidate/);
  for (const field of ['title', 'file', 'valid_until']) {
    assert.match(docs, new RegExp(`<FieldError id="doc-${field}-error" message=\\{errors\\.${field}\\}`));
  }
});

// Nuevo evento (Calendario) is a director form too, and the QA run's own
// requests show what it let through: CLASSROOM scope with classroom_id "",
// end_time "09:00" after time "10:00", and only the browser's own tooltip
// for an empty title.
test('event validation names the field in Spanish and refuses what QA saw go through', () => {
  const ok = {
    title: 'Festival', description: '', date: '2026-10-15', time: '10:00', end_time: '11:00', location: '',
    scope: 'SCHOOL', classroom_id: '', requires_confirmation: false, confirmation_deadline: '',
    has_cost: false, cost_amount: '', cost_concept: '',
  };
  assert.deepEqual(validateEventForm(ok), {});

  const empty = validateEventForm({ ...ok, title: '  ', date: '' });
  assert.equal(empty.title, 'Escribe el título del evento.');
  assert.equal(empty.date, 'Elige la fecha del evento.');

  assert.match(validateEventForm({ ...ok, scope: 'CLASSROOM' }).classroom_id, /Elige el salón/);
  assert.deepEqual(validateEventForm({ ...ok, scope: 'CLASSROOM', classroom_id: 'c1' }), {});
  assert.equal(validateEventForm({ ...ok, end_time: '09:00' }).end_time, 'Debe ser posterior a la hora de inicio.');
  assert.equal(validateEventForm({ ...ok, end_time: '10:00' }).end_time, 'Debe ser posterior a la hora de inicio.');
  assert.deepEqual(validateEventForm({ ...ok, time: '', end_time: '' }), {}, 'times are optional');

  const paid = { ...ok, has_cost: true };
  assert.match(validateEventForm({ ...paid, cost_amount: '' }).cost_amount, /Escribe el monto/);
  assert.equal(validateEventForm({ ...paid, cost_amount: '0' }).cost_amount, 'El monto debe ser mayor a 0.');
  assert.ok(validateEventForm({ ...paid, cost_amount: '-5' }).cost_amount);
  assert.ok(validateEventForm({ ...paid, cost_amount: '150.505' }).cost_amount, 'no fractions of a centavo');
  assert.deepEqual(validateEventForm({ ...paid, cost_amount: '150.50' }), {});
  assert.deepEqual(validateEventForm({ ...ok, cost_amount: '-5' }), {}, 'amount ignored when the event has no cost');

  const rsvp = { ...ok, requires_confirmation: true };
  assert.match(validateEventForm({ ...rsvp, confirmation_deadline: '2026-10-16' }).confirmation_deadline, /posterior a la fecha del evento/);
  assert.deepEqual(validateEventForm({ ...rsvp, confirmation_deadline: '2026-10-15' }), {});
});

test('EventFormDialog reports errors under each field instead of the browser tooltip', () => {
  const src = code('src/components/calendar/EventFormDialog.jsx');
  assert.doesNotMatch(src, /\brequired\b(?!-)/);
  assert.match(src, /noValidate/);
  assert.match(src, /validateEventForm\(formData\)/);
  for (const field of ['title', 'date', 'end_time', 'classroom_id', 'cost_amount']) {
    assert.match(src, new RegExp(`<FieldError id="event-${field}-error" message=\\{errors\\.${field}\\}`), field);
  }
});

test('PermisosRoles shows each error next to the section that raised it', () => {
  const src = read('src/pages/PermisosRoles.jsx');
  assert.doesNotMatch(src, /setErrorText/, 'one shared error line under Motivo was far from the form that failed');
  for (const section of ['role', 'rollback', 'override', 'deletion']) {
    assert.match(src, new RegExp(`<FieldError id="${section}-error" message=\\{errors\\.${section}\\}`), `${section} has no inline error`);
  }
  assert.match(src, /<FieldError id="permission-reason-error" message=\{errors\.reason\}/);
  // A missing reason is reported in the section too, and moves focus to Motivo.
  assert.match(src, /setErrors\(\{ reason: REASON_REQUIRED, \[section\]: REASON_POINTER \}\)/);
  assert.match(src, /reasonRef\.current\?\.focus\(\)/);
  for (const handler of ['handleRoleChange', 'handleSaveOverride', 'handleDeleteOverride', 'handleApplyRollback']) {
    const start = src.indexOf(`const ${handler} = async`);
    assert.ok(start > 0, handler);
    assert.match(src.slice(start, start + 400), /requireReason\('/, `${handler} must use requireReason`);
  }
});

test('FieldError is readable in dark mode and announced', () => {
  const src = code('src/components/forms/FieldError.jsx');
  assert.match(src, /role="alert"/);
  assert.match(src, /text-red-600 dark:text-red-400/);
  assert.doesNotMatch(src, /text-destructive/, 'dark --destructive is 30 % lightness: unreadable as text');
});
