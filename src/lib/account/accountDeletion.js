/**
 * "Eliminar mi cuenta y mis datos" (v1.9.0) — what the page says and checks.
 *
 * Pure (its imports are pure data) so `node --test` can load it. The page is
 * src/pages/EliminarCuenta.jsx; the server half is
 * base44/functions/deleteMyAccount/_deletion.ts, which re-checks the typed
 * word and derives everything from the caller.
 *
 * The lists below are what the page PROMISES, so they are written from the
 * legal text (src/lib/legal/legalDocs.js, Aviso § 10 and the retention table)
 * and from what deleteMyAccount actually does — tests/unit/account-deletion
 * .test.js ties the three together. Change one, change the others.
 */
import { ACCOUNT_DELETION_LABEL, PURGE_DAYS, ACACIA_SUPPORT_EMAIL } from '../legal/legalDocs.js';

export const ACCOUNT_DELETION_PAGE = 'EliminarCuenta';
export const ACCOUNT_DELETION_PATH = '/' + ACCOUNT_DELETION_PAGE;
export const ACCOUNT_DELETION_TITLE = ACCOUNT_DELETION_LABEL;

// MIRRORS base44/functions/deleteMyAccount/_deletion.ts#CONFIRMATION_WORD.
export const CONFIRMATION_WORD = 'ELIMINAR';

// Set before logging out, read once by the login screen so the person sees
// that the deletion went through (their session is gone by then).
export const ACCOUNT_DELETED_FLAG_KEY = 'liuma.accountDeleted';

/** Same forgiveness as the server: case and surrounding blanks. */
export function confirmationMatches(input) {
  return typeof input === 'string' && input.trim().toUpperCase() === CONFIRMATION_WORD;
}

/**
 * When deleteMyAccount could mark the User but Base44 did not remove it, the
 * account still signs in: the app must show it as deleted instead of sending
 * the person back through onboarding. MIRRORED in deleteMyAccount/_deletion.ts,
 * myConsent/_consent.ts and provisionOnboardingProfile/entry.ts.
 */
export function accountDeletedAt(user) {
  const v = user?.account_deleted_at ?? user?.data?.account_deleted_at;
  return typeof v === 'string' ? v : '';
}

/**
 * deleteMyAccount writes this marker before anything else (Codex review of
 * PR #197). While it is set and the account is not finished, access is closed
 * everywhere, accepting the texts again is refused, and the app shows the
 * deletion page to finish it. MIRRORED in deleteMyAccount/_deletion.ts
 * (deletionStartedAt) and myConsent/_consent.ts.
 */
export function accountDeletionStartedAt(user) {
  const v = user?.account_deletion_started_at ?? user?.data?.account_deletion_started_at;
  return typeof v === 'string' ? v : '';
}

/**
 * Which body the deletion page shows: 'owner' (cannot delete), 'sole_admin'
 * (the school-request path, no confirm button) or 'confirm'. A deletion that
 * already started ALWAYS gets 'confirm' — whether the page was opened to
 * finish it (`resume`) or the server says so (`preview.resume`): without the
 * button the person would be stuck, access closed and re-acceptance refused
 * (Codex review of PR #197).
 */
export function deletionPageMode({ preview, resume = false } = {}) {
  if (preview?.platformOwner) return 'owner';
  if (resume || preview?.resume) return 'confirm';
  return preview?.soleAdmin ? 'sole_admin' : 'confirm';
}

/** What goes away. Role decides which lines apply. */
export function deletedItems(role) {
  const items = [
    'Tu acceso a LIUMA, de inmediato: se cierra tu sesión y no podrás volver a entrar con esta cuenta.',
    `Tu cuenta, tu perfil en la escuela y tus datos de contacto (teléfono, fotografía y, si eres madre, padre o tutor, tu domicilio y datos de trabajo). Se suprimen de la base de datos activa dentro de ${PURGE_DAYS} días.`,
    'Tu bandeja de avisos y tus permisos individuales.',
  ];
  if (role === 'PARENT') {
    items.push('Tus vínculos con tus hijos: dejas de ver su información.');
    items.push('Tus solicitudes que la escuela aún no atendía: ausencias y pedidos de uniforme pendientes.');
  }
  if (role === 'TEACHER') {
    items.push('Tus asignaciones de salón.');
  }
  return items;
}

/** What stays, and why — the legal text's own wording, not a softer one. */
export function keptItems(role) {
  const items = [];
  if (role === 'PARENT') {
    items.push('Los registros escolares de tus hijos (asistencia, bitácora, cargos y pagos) pertenecen al expediente que lleva la escuela: se quedan con ella sin tu nombre. Para que también se cancelen, solicítalo a la dirección de tu escuela.');
  } else if (role) {
    items.push('Lo que publicaste como personal de la escuela (avisos, tareas, bitácoras, asistencia, documentos) pertenece al expediente de la escuela: se queda con ella sin tu nombre.');
  }
  items.push('La constancia de tu consentimiento y de su retiro se conserva bloqueada hasta 10 años, sólo para acreditar que se otorgó y que lo retiraste.');
  items.push('La bitácora de auditoría (acciones sensibles y sesiones) se conserva 2 años, para poder responder por un acceso indebido.');
  items.push(`Tus conversaciones con Lumi las almacena Base44, que no ofrece a LIUMA una forma de borrarlas por sí misma: ACACIA solicita a Base44 su supresión dentro de ${PURGE_DAYS} días.`);
  return items;
}

const ERROR_MESSAGES = {
  CONFIRMATION_REQUIRED: `Escribe ${CONFIRMATION_WORD} para confirmar.`,
  SOLE_ADMIN: 'Eres la única persona activa de la dirección de tu escuela: no puedes eliminar tu cuenta sin dejarla sin quien la represente.',
  PLATFORM_OWNER: 'La cuenta dueña de la plataforma no se puede eliminar desde la app.',
  RATE_LIMITED: 'Hay mucha actividad en este momento. Espera unos segundos e inténtalo de nuevo: lo que ya se hizo no se repite.',
  UNAUTHENTICATED: 'Tu sesión expiró. Vuelve a iniciar sesión e inténtalo de nuevo.',
  // A bulk step had rows left; the account was not marked deleted yet.
  DELETION_INCOMPLETE: 'La eliminación de tu cuenta quedó a medias porque hay muchos registros que actualizar. Vuelve a intentarlo para continuar donde se quedó.',
  // The deletion-in-progress marker could not be written: nothing changed.
  DELETION_NOT_STARTED: `No se pudo iniciar la eliminación de tu cuenta. No se cambió nada; inténtalo de nuevo o escribe a ${ACACIA_SUPPORT_EMAIL}.`,
  // deleteMyAccount could not mark the account as deleted, so it kept the
  // profile instead of leaving an account that could sign up again. Access is
  // already closed; a retry finishes the rest.
  ACCOUNT_NOT_MARKED: `No se pudo terminar de eliminar tu cuenta. Tu acceso ya quedó cerrado; vuelve a intentarlo para completar la eliminación (lo que ya se hizo no se repite) o escribe a ${ACACIA_SUPPORT_EMAIL}.`,
};

/** Spanish sentence for a deleteMyAccount refusal or failure. */
export function deletionErrorMessage(code, { blocked = false } = {}) {
  // deleteMyAccount lost the director check but could not undo its own
  // "deletion started" mark: the account stays closed until ACACIA lifts it.
  if (blocked) {
    return `${ERROR_MESSAGES[code] || 'No se pudo eliminar tu cuenta.'} Tu cuenta quedó bloqueada mientras tanto: escribe a ${ACACIA_SUPPORT_EMAIL} para que la reactivemos.`;
  }
  return ERROR_MESSAGES[code]
    || `No se pudo completar la eliminación. Inténtalo de nuevo (lo que ya se hizo no se repite) o escribe a ${ACACIA_SUPPORT_EMAIL}.`;
}
