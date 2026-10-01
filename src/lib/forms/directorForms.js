// Field-level validation for the director's school-setup forms: Nuevo salón,
// Nuevo alumno / Editar alumno, and Subir documento.
//
// Why this exists (QA 2026-09-30, area director-forms):
//   - Nuevo salón / Nuevo alumno only DISABLED the submit button while a
//     required field was empty. Nothing said which field was missing, so a
//     director on a phone saw a grey button and no reason.
//   - Subir documento leaned on the native `required` attribute, whose
//     tooltip is written by the browser in the browser's language — an
//     English-language Chrome told a Mexican director "Please fill out this
//     field".
//   - No screen could record a student's allergies, medical notes or blood
//     type, or edit a student at all, although guardedEntityWrite allows all of
//     it (base44/functions/guardedEntityWrite/_policy.ts, Student) and MisHijos
//     shows "Alergias" to parents.
//
// Every validator returns `{ field: 'mensaje en español' }` — an empty object
// means valid — so the form can put each message under its own field.
//
// Import-free except for ../dates.js (itself import-free), so `node --test`
// loads it directly (tests/unit/director-forms.test.js).

import { parseLocalDate, startOfLocalDay } from '../dates.js';

// guardedEntityWrite's cleanFieldValue() silently TRUNCATES a 'string' at 300
// characters and a 'text' at 5000. Saying so here, before the write, is the
// difference between an error the director can fix and an allergy list that
// quietly lost its end.
export const MAX_SHORT_TEXT = 300;
export const MAX_LONG_TEXT = 5000;

/** The eight ABO/Rh groups. Stored as written here (Student.blood_type). */
export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/** Border for a field whose value is invalid, in both themes (see FieldError). */
export const INVALID_FIELD_CLASS = 'border-red-500 dark:border-red-400';

export function hasErrors(errors) {
  return Boolean(errors) && Object.keys(errors).length > 0;
}

/** The first field (in `order`) that has an error — the one to focus. */
export function firstErrorField(errors, order) {
  return (order || []).find((field) => errors?.[field]) || null;
}

const text = (value) => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim());

function requireText(errors, field, value, missing, max = MAX_SHORT_TEXT) {
  const v = text(value);
  if (!v) errors[field] = missing;
  else if (v.length > max) errors[field] = `Es demasiado largo: máximo ${max} caracteres (lleva ${v.length}).`;
}

function limitText(errors, field, value, max) {
  const v = text(value);
  if (v.length > max) errors[field] = `Es demasiado largo: máximo ${max} caracteres (lleva ${v.length}).`;
}

// --- Salón -------------------------------------------------------------------

export function validateClassroomForm(form) {
  const errors = {};
  requireText(errors, 'name', form?.name, 'Escribe el nombre del salón.');
  limitText(errors, 'grade', form?.grade, MAX_SHORT_TEXT);
  return errors;
}

// --- Alumno ------------------------------------------------------------------

export const STUDENT_FIELD_ORDER = [
  'first_name',
  'last_name',
  'classroom_id',
  'birth_date',
  'blood_type',
  'allergies',
  'medical_notes',
];

/** The fields the student form edits — and the only ones it ever sends. */
const STUDENT_FORM_FIELDS = STUDENT_FIELD_ORDER;

export function emptyStudentForm() {
  return Object.fromEntries(STUDENT_FORM_FIELDS.map((field) => [field, '']));
}

/** A stored Student as form state (missing/null fields become ''). */
export function studentFormFromRecord(student) {
  return Object.fromEntries(
    STUDENT_FORM_FIELDS.map((field) => [field, student?.[field] == null ? '' : String(student[field])]),
  );
}

/**
 * @param form      the form state
 * @param options   classroomIds: the classrooms the select offers (the chosen
 *                  one must be one of them); legacyBloodType: a value already
 *                  stored that is not one of BLOOD_TYPES — kept valid so an
 *                  edit of the rest of the record never forces it to change;
 *                  today: for tests. Left undefined in the app on purpose:
 *                  startOfLocalDay() with no argument is "today", and once the
 *                  shared date helper resolves that in the school's time zone
 *                  (America/Mexico_City) this check follows it without a change
 *                  here — passing `new Date()` would pin it to the device's day.
 */
export function validateStudentForm(form, { classroomIds, legacyBloodType, today } = {}) {
  const errors = {};
  requireText(errors, 'first_name', form?.first_name, 'Escribe el nombre del alumno.');
  requireText(errors, 'last_name', form?.last_name, 'Escribe los apellidos del alumno.');

  const classroomId = text(form?.classroom_id);
  if (!classroomId) errors.classroom_id = 'Elige el salón del alumno.';
  else if (Array.isArray(classroomIds) && !classroomIds.includes(classroomId)) {
    errors.classroom_id = 'Ese salón ya no está disponible. Elige otro.';
  }

  const birth = text(form?.birth_date);
  if (birth) {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(birth) ? parseLocalDate(birth) : null;
    if (!parsed) errors.birth_date = 'La fecha de nacimiento no es válida.';
    else if (parsed > startOfLocalDay(today)) errors.birth_date = 'La fecha de nacimiento no puede ser posterior a hoy.';
    else if (parsed.getFullYear() < 1900) errors.birth_date = 'Revisa el año de nacimiento.';
  }

  const blood = text(form?.blood_type);
  if (blood && !BLOOD_TYPES.includes(blood) && blood !== text(legacyBloodType)) {
    errors.blood_type = 'Elige un tipo de sangre de la lista.';
  }
  limitText(errors, 'allergies', form?.allergies, MAX_LONG_TEXT);
  limitText(errors, 'medical_notes', form?.medical_notes, MAX_LONG_TEXT);
  return errors;
}

/** Trimmed copy of the form, ready for guardedCreate('Student', …). */
export function studentCreatePayload(form) {
  return Object.fromEntries(STUDENT_FORM_FIELDS.map((field) => [field, text(form?.[field])]));
}

/**
 * Only the fields the director actually changed, for guardedUpdate('Student').
 * Sending the whole form would record every field as "updated" in the
 * server's RECORD_UPDATED audit row and overwrite a concurrent edit of a field
 * nobody touched here. A cleared field is sent as '' — the server stores it as
 * null (cleanFieldValue), which is how an allergy that no longer applies is
 * removed.
 */
export function studentUpdatePatch(original, form) {
  const before = studentFormFromRecord(original);
  const after = studentCreatePayload(form);
  const patch = {};
  for (const field of STUDENT_FORM_FIELDS) {
    if (after[field] !== text(before[field])) patch[field] = after[field];
  }
  return patch;
}

// --- Documento oficial -------------------------------------------------------

export const DOCUMENT_FIELD_ORDER = ['title', 'description', 'valid_from', 'valid_until', 'file'];

export function isPdfFile(file) {
  if (!file) return false;
  const name = typeof file.name === 'string' ? file.name.toLowerCase() : '';
  return file.type === 'application/pdf' || name.endsWith('.pdf');
}

export function validateDocumentForm(form, file) {
  const errors = {};
  requireText(errors, 'title', form?.title, 'Escribe el título del documento.');
  limitText(errors, 'description', form?.description, MAX_LONG_TEXT);

  const from = text(form?.valid_from);
  const until = text(form?.valid_until);
  const fromDate = from ? parseLocalDate(from) : null;
  const untilDate = until ? parseLocalDate(until) : null;
  if (from && !fromDate) errors.valid_from = 'La fecha no es válida.';
  if (until && !untilDate) errors.valid_until = 'La fecha no es válida.';
  else if (fromDate && untilDate && untilDate < fromDate) {
    errors.valid_until = 'Debe ser igual o posterior a «Válido desde».';
  }

  if (!file) errors.file = 'Elige el archivo PDF que vas a subir.';
  else if (!isPdfFile(file)) errors.file = 'El archivo debe ser un PDF.';
  return errors;
}

// --- Evento (Calendario escolar) ---------------------------------------------
//
// Same finding as the other forms (QA 2026-09-30): Nuevo evento leaned on the
// native `required` tooltip ("Please fill out this field." in an English
// Chrome), and three things the director cannot have meant went straight
// through — found in that run's own requests:
//   - "Por salón" with no salón chosen: stored as a CLASSROOM event with
//     classroom_id null, which no teacher or parent ever sees;
//   - an end time before the start time (10:00 → 09:00);
//   - "¿Tiene costo?" on with no amount, or a zero/negative one — and a
//     parent who accepts the event gets a ChargeItem for exactly that amount
//     (EventosParaPadres).

export const EVENT_FIELD_ORDER = [
  'title',
  'description',
  'date',
  'time',
  'end_time',
  'location',
  'classroom_id',
  'confirmation_deadline',
  'cost_amount',
  'cost_concept',
];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// Pesos with at most two decimals, as typed in the "Monto" box.
const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

export function validateEventForm(form) {
  const errors = {};
  requireText(errors, 'title', form?.title, 'Escribe el título del evento.');
  limitText(errors, 'description', form?.description, MAX_LONG_TEXT);
  limitText(errors, 'location', form?.location, MAX_SHORT_TEXT);

  const date = text(form?.date);
  const eventDay = date ? parseLocalDate(date) : null;
  if (!date) errors.date = 'Elige la fecha del evento.';
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !eventDay) errors.date = 'La fecha no es válida.';

  const start = text(form?.time);
  const end = text(form?.end_time);
  if (start && !TIME_RE.test(start)) errors.time = 'La hora no es válida.';
  if (end && !TIME_RE.test(end)) errors.end_time = 'La hora no es válida.';
  else if (end && !start) errors.time = 'Escribe también la hora de inicio.';
  else if (end && TIME_RE.test(start) && end <= start) errors.end_time = 'Debe ser posterior a la hora de inicio.';

  if (form?.scope === 'CLASSROOM' && !text(form?.classroom_id)) {
    errors.classroom_id = 'Elige el salón del evento, o cambia el alcance a «Toda la escuela».';
  }

  if (form?.requires_confirmation) {
    const deadline = text(form?.confirmation_deadline);
    const deadlineDay = deadline ? parseLocalDate(deadline) : null;
    if (deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || !deadlineDay)) {
      errors.confirmation_deadline = 'La fecha no es válida.';
    } else if (deadlineDay && eventDay && deadlineDay > eventDay) {
      errors.confirmation_deadline = 'No puede ser posterior a la fecha del evento.';
    }
  }

  if (form?.has_cost) {
    const amount = text(form?.cost_amount);
    if (!amount) errors.cost_amount = 'Escribe el monto, o apaga «¿Tiene costo?».';
    else if (!AMOUNT_RE.test(amount)) errors.cost_amount = 'Escribe un monto válido, con hasta dos decimales (ej. 150 o 150.50).';
    else if (Number(amount) <= 0) errors.cost_amount = 'El monto debe ser mayor a 0.';
    limitText(errors, 'cost_concept', form?.cost_concept, MAX_SHORT_TEXT);
  }
  return errors;
}
