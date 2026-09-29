// Pure lookup helpers over the member directory returned by the
// listSchoolMembers function ({ id, full_name, email } per user). No imports,
// so `node --test` loads it directly; the React hook lives next door in
// useSchoolMembers.js.

export const UNKNOWN_NAME = 'Usuario sin nombre';
export const UNKNOWN_EMAIL = 'Sin correo registrado';

/** Map of user id → { id, full_name, email }. Tolerates null / junk input. */
export function indexMembers(users) {
  const byId = new Map();
  for (const u of Array.isArray(users) ? users : []) {
    if (u && u.id) byId.set(String(u.id), u);
  }
  return byId;
}

/**
 * The name to show for a user. Falls back to their email before a generic
 * label: a director approving "ana.lopez@…" knows who that is, and a list of
 * identical "Sin nombre" rows (the old User.list() failure mode) tells them
 * nothing at all.
 */
export function memberName(index, userId) {
  const u = index?.get?.(String(userId || ''));
  const name = String(u?.full_name || '').trim();
  if (name) return name;
  const email = String(u?.email || '').trim();
  return email || UNKNOWN_NAME;
}

export function memberEmail(index, userId) {
  const u = index?.get?.(String(userId || ''));
  return String(u?.email || '').trim() || UNKNOWN_EMAIL;
}
