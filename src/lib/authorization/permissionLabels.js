// Spanish labels for everything "Permisos y Roles" shows a school director.
// The stored values (entity names, 'read'/'write', 'deny'/'allow', role
// enums, PendingChange statuses) stay exactly as they are — the server
// (guardedEntityWrite, governRoleChange) keys on them. Only what is DISPLAYED
// goes through here. No imports, so tests/unit/member-directory.test.js can
// check that every value the page can render has a label: an unlabeled one
// falls back to the raw English key, which is exactly the "developer text in
// front of a customer" problem this file exists to remove.

/** Entities whose writes can be granted/denied per user (see guardedEntityWrite). */
export const OVERRIDE_RESOURCES = ['Notice', 'Attendance', 'Homework', 'DiaryEntry', 'ChargeItem', 'PaymentConcept', 'PaymentRecord'];

/** The override actions the form offers (policy.js POLICY table's read/write). */
export const POLICY_ACTIONS = ['read', 'write'];

export const RESOURCE_LABELS = {
  Notice: 'Avisos',
  Attendance: 'Asistencia',
  Homework: 'Tareas',
  DiaryEntry: 'Bitácora',
  ChargeItem: 'Cargos a alumnos',
  PaymentConcept: 'Conceptos de pago',
  PaymentRecord: 'Pagos registrados',
};

export const ACTION_LABELS = {
  read: 'Ver',
  write: 'Crear y editar',
  manage_permissions: 'Administrar permisos',
};

export const EFFECT_LABELS = {
  deny: 'Denegar',
  allow: 'Permitir',
};

export const ROLE_LABELS = {
  ADMIN: 'Directivo',
  TEACHER: 'Maestro/a',
  PARENT: 'Padre/Madre',
};

export const CHANGE_STATUS_LABELS = {
  PENDING_ADMIN_APPROVAL: 'Pendiente de aprobación',
  PENDING_SECOND_ADMIN_APPROVAL: 'Requiere aprobación de un segundo directivo',
  APPROVED: 'Aprobada',
  REJECTED: 'Rechazada',
};

/** Why a permission preview came out the way it did (policy.js `precedence`). */
export const PRECEDENCE_LABELS = {
  explicit_allow: 'por su rol',
  explicit_deny: 'por su rol',
  default_deny: 'por su rol',
  override_allow: 'por una excepción',
  override_deny: 'por una excepción',
  owner_override: 'dueño de la plataforma',
};

function pick(map, key) {
  return map[key] || String(key ?? '');
}

export const resourceLabel = (key) => pick(RESOURCE_LABELS, key);
export const actionLabel = (key) => pick(ACTION_LABELS, key);
export const effectLabel = (key) => pick(EFFECT_LABELS, key);
export const roleLabel = (key) => pick(ROLE_LABELS, key);
export const changeStatusLabel = (key) => pick(CHANGE_STATUS_LABELS, key);
export const precedenceLabel = (key) => pick(PRECEDENCE_LABELS, key);
