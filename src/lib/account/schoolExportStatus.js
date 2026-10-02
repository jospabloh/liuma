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
