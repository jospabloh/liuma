/**
 * What a school export actually contains, in words (Codex review of PR #197,
 * round 10). No imports, so node --test loads it
 * (tests/unit/school-export.test.js).
 *
 * exportSchoolData used to return at most 100 rows per entity (the SDK's
 * default page) and the screens said "Descarga iniciada" all the same — right
 * before inviting the only director to ask for the school's irreversible
 * deletion. Now the server says `complete` and names what is `incomplete`,
 * and the screens say so; asking for the school's deletion needs a complete
 * backup or an explicit "continuar sin respaldo completo".
 */

// MIRRORS base44/functions/exportSchoolData/entry.ts#EXPORTED_ENTITIES.
export const EXPORT_ENTITY_LABELS = {
  Student: 'alumnos',
  Classroom: 'salones',
  TeacherClassroom: 'asignaciones de maestros',
  ParentStudent: 'vínculos de familias',
  ParentProfile: 'datos de familias',
  Attendance: 'asistencia',
  Homework: 'tareas',
  DiaryEntry: 'bitácoras',
  Notice: 'avisos',
  NoticeDelivery: 'entregas de avisos',
  AbsenceNotification: 'ausencias',
  EmergencyContact: 'contactos de emergencia',
  Event: 'eventos',
  EventResponse: 'respuestas a eventos',
  PaymentConcept: 'conceptos de pago',
  ChargeItem: 'cargos',
  PaymentRecord: 'pagos',
  Discount: 'descuentos',
  UniformOrder: 'pedidos de uniforme',
  OfficialDocument: 'documentos',
  WeeklyMenu: 'menús',
  SchoolSetupGuide: 'configuración inicial',
  SupportTicket: 'tickets de soporte',
  UserProfile: 'perfiles de usuarios',
};

/**
 * { complete, missing: [labels] } from the server's answer. An answer without
 * `complete: true` (an older server, which cut every list at 100) is NOT
 * complete.
 */
export function exportCompleteness(payload) {
  const complete = payload?.complete === true;
  const names = Array.isArray(payload?.incomplete) ? payload.incomplete : [];
  return { complete, missing: names.map((n) => EXPORT_ENTITY_LABELS[n] || n) };
}

/** The warning for an incomplete export, naming what is missing. */
export function incompleteExportMessage(result) {
  if (result?.complete) return '';
  const parts = result?.missing?.length ? result.missing.join(', ') : 'no se pudo confirmar que esté completo';
  return `El archivo se descargó, pero NO es un respaldo completo. Falta: ${parts}. Vuelve a intentarlo más tarde o escribe a soporte@acaciaco.com.mx antes de pedir la eliminación de la escuela.`;
}

/** Asking for the school's deletion: a complete backup, or an explicit acknowledgement. */
export function schoolDeletionRequestAllowed({ backup, acknowledged }) {
  return backup?.complete === true || acknowledged === true;
}

/** How many times downloadSchoolExport asks again from a `resume` token. */
export const EXPORT_MAX_ROUNDS = 6;
export const EXPORT_ROUND_PAUSE_MS = 2000;

/**
 * Ask exportSchoolData until it stops answering `resume` (it does when its
 * time budget runs out, e.g. after waiting out Base44's rate limit), merging
 * the rounds into one payload. `invoke(body)` returns the function's JSON.
 * Complete only if every entity finished: no round named one incomplete and
 * the last round left nothing to resume.
 */
export async function runExportRounds(invoke, { maxRounds = EXPORT_MAX_ROUNDS, pauseMs = EXPORT_ROUND_PAUSE_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let merged = null;
  let resume = null;
  let last = null;
  for (let round = 0; round < maxRounds; round += 1) {
    if (round > 0) await sleep(pauseMs);
    const payload = await invoke(resume ? { resume } : {});
    if (!payload?.ok) throw new Error(payload?.error || 'export failed');
    last = payload;
    if (!merged) {
      merged = { ...payload, data: {}, errors: {}, incomplete: [] };
    }
    for (const [name, rows] of Object.entries(payload.data || {})) {
      merged.data[name] = [...(merged.data[name] || []), ...(Array.isArray(rows) ? rows : [])];
    }
    Object.assign(merged.errors, payload.errors || {});
    for (const name of payload.incomplete || []) if (!merged.incomplete.includes(name)) merged.incomplete.push(name);
    resume = payload.resume || null;
    merged.rounds = round + 1;
    if (!resume) break;
  }
  if (resume && !merged.incomplete.includes(resume.entity)) merged.incomplete.push(resume.entity);
  merged.resume = resume;
  // An older server (no `complete` flag) cut every list: never complete.
  merged.complete = last?.complete === true && !resume && merged.incomplete.length === 0;
  if (!Object.keys(merged.errors).length) delete merged.errors;
  return merged;
}
