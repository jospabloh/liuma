// What LIUMA calls the signed-in person. No imports, so `node --test` loads it.
//
// `full_name` is whatever Base44's signup left there, and for a lot of real
// accounts that is the email handle: the live QA of v1.8.5 greeted a parent
// with "Hola, h.josepablo+qa-padre". A handle is not a name, so it is never
// shown as one — the greeting just says "Hola" — and the person is asked once
// for the name they want (DisplayNameDialog).
//
// The chosen name lives in `display_name`, a custom field of User
// (base44/entities/User.jsonc), because the SDK's own contract is that
// `auth.updateMe()` cannot change `full_name` (@base44/sdk
// auth.types.d.ts: "These fields can't be changed with this method: id,
// email, full_name, …"). Custom fields it can.
//
// isHandleLikeName MIRRORS displayUserName in
// base44/functions/lumiQuery/_lumiCore.ts (Lumi uses it for the same
// question); tests/unit/user-display-name.test.js runs both on the same cases.

export const DISPLAY_NAME_MAX = 60;

/** true when `name` is empty or reads as an email / email handle, not a name. */
export function isHandleLikeName(name, email) {
  const value = String(name ?? '').trim();
  if (!value || value.includes('@')) return true;
  const local = String(email ?? '').split('@')[0].trim().toLowerCase();
  if (local && value.toLowerCase() === local) return true;
  // One token carrying handle characters (dots, plus, underscore, digits).
  if (!/\s/.test(value) && /[.+_\d]/.test(value)) return true;
  return false;
}

/** The custom field, wherever this SDK version puts custom fields. */
function chosenName(user) {
  const raw = user?.display_name ?? user?.data?.display_name ?? '';
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
}

/**
 * The name to show for this user, or '' when there is no real one. The name
 * the person chose wins; otherwise full_name, unless it is a handle.
 */
export function userDisplayName(user) {
  if (!user) return '';
  const chosen = chosenName(user);
  if (chosen) return chosen.slice(0, DISPLAY_NAME_MAX);
  const full = String(user.full_name ?? '').replace(/\s+/g, ' ').trim();
  return isHandleLikeName(full, user.email) ? '' : full;
}

/** First word of the display name, or ''. */
export function userFirstName(user) {
  return userDisplayName(user).split(' ')[0] || '';
}

/** "Hola, Ana" — or just "Hola" when there is no name to use. */
export function greetingFor(user) {
  const first = userFirstName(user);
  return first ? `Hola, ${first}` : 'Hola';
}

/**
 * Validates what someone typed into "¿Cómo te llamas?". Returns
 * { ok: true, value } with the cleaned name, or { ok: false, error } with a
 * message for the field. The rule is the same one the greeting applies: a
 * name that would be hidden as a handle is not accepted as a name.
 */
export function validateDisplayName(input) {
  const value = String(input ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return { ok: false, error: 'Escribe tu nombre.' };
  if (value.length < 2) return { ok: false, error: 'Escribe al menos 2 letras.' };
  if (value.length > DISPLAY_NAME_MAX) return { ok: false, error: `Usa máximo ${DISPLAY_NAME_MAX} caracteres.` };
  if (value.includes('@')) return { ok: false, error: 'Escribe tu nombre, no tu correo.' };
  if (/[<>{}[\]\\/|=;:`"$%^*~#]/.test(value)) return { ok: false, error: 'Usa solo letras, espacios, guiones y apóstrofos.' };
  if (!/\p{L}/u.test(value)) return { ok: false, error: 'Escribe tu nombre con letras.' };
  if (isHandleLikeName(value)) return { ok: false, error: 'Parece un usuario de correo. Escribe tu nombre como quieres que te veamos.' };
  return { ok: true, value };
}

// "Ahora no" is remembered per user on this device, so the dialog asks once
// and then stays out of the way; the name is still editable from the account
// menu. Storage can throw (private mode, blocked site data): a failure just
// means the question may come back, never that the app breaks.
const DISMISS_PREFIX = 'liuma.namePrompt.dismissed.';

export function namePromptDismissed(userId, storage = globalThis.localStorage) {
  if (!userId) return true;
  try {
    return storage?.getItem(DISMISS_PREFIX + userId) === '1';
  } catch {
    return false;
  }
}

export function dismissNamePrompt(userId, storage = globalThis.localStorage) {
  if (!userId) return;
  try {
    storage?.setItem(DISMISS_PREFIX + userId, '1');
  } catch {
    /* storage unavailable — the question may come back next time */
  }
}

/** Ask once: the user has no usable name and has not said "Ahora no" here. */
export function shouldPromptForName(user, storage = globalThis.localStorage) {
  if (!user?.id) return false;
  if (userDisplayName(user)) return false;
  return !namePromptDismissed(user.id, storage);
}
