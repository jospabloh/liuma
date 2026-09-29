// Código para unirse a una escuela — corto, legible y resuelto en el servidor.
//
// Antes el "código de escuela" era el id crudo del registro School (24
// caracteres hexadecimales): cada padre lo tecleaba en el teléfono, y el
// cliente lo buscaba con School.filter(), que la RLS de School (sólo
// plataforma) siempre devolvía vacío — nadie podía unirse. Ahora:
//
//   - el código es de 8 caracteres de un alfabeto SIN ambiguos (sin 0/O, 1/I/L),
//     mostrado como ABCD-EFGH;
//   - se genera y se resuelve SÓLO en el servidor
//     (base44/functions/provisionOnboardingProfile/entry.ts, que copia estas
//     constantes a mano — Deno no puede importar de src/ — y
//     tests/unit/join-code.test.js falla si se separan);
//   - un código ya repartido con el formato viejo (id de 24 hex) se sigue
//     aceptando como respaldo: unirse deja el perfil en PENDING y un ADMIN
//     tiene que aprobarlo, así que aceptar el id no da acceso a nada por sí
//     solo.
//
// 31 símbolos ^ 8 ≈ 8.5e11 combinaciones: adivinar uno por fuerza bruta no es
// práctico, y aun acertando sólo se consigue una solicitud pendiente.

export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_LENGTH = 8;

const LEGACY_SCHOOL_ID = /^[a-f0-9]{24}$/i;

/** Mayúsculas y sin separadores: "abcd-efgh " → "ABCDEFGH". */
export function normalizeJoinCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidJoinCode(input) {
  const code = normalizeJoinCode(input);
  if (code.length !== JOIN_CODE_LENGTH) return false;
  return [...code].every((ch) => JOIN_CODE_ALPHABET.includes(ch));
}

/** El id de 24 hex que se repartía antes de que existiera join_code. */
export function isLegacySchoolId(input) {
  return LEGACY_SCHOOL_ID.test(String(input || '').trim());
}

/** "ABCDEFGH" → "ABCD-EFGH" (sólo presentación; el guion no es parte del código). */
export function formatJoinCode(input) {
  const code = normalizeJoinCode(input);
  if (code.length !== JOIN_CODE_LENGTH) return code;
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Genera un código con muestreo por rechazo (sin sesgo de módulo).
 * `randomBytes(n)` debe devolver n enteros 0..255 — inyectable para pruebas.
 */
export function generateJoinCode(randomBytes = defaultRandomBytes) {
  const limit = 256 - (256 % JOIN_CODE_ALPHABET.length);
  let out = '';
  while (out.length < JOIN_CODE_LENGTH) {
    for (const byte of randomBytes(JOIN_CODE_LENGTH * 2)) {
      if (byte < limit) out += JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length];
      if (out.length === JOIN_CODE_LENGTH) break;
    }
  }
  return out;
}

function defaultRandomBytes(n) {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** Liga que abre el onboarding con el código ya escrito (Onboarding.jsx lee ?codigo=). */
export function buildJoinLink(origin, code) {
  const base = String(origin || '').replace(/\/$/, '');
  return `${base}/?codigo=${encodeURIComponent(formatJoinCode(code))}`;
}

/** Lee el código de la URL de invitación, si viene. */
export function readJoinCodeFromSearch(search) {
  try {
    const value = new URLSearchParams(search || '').get('codigo');
    return value ? formatJoinCode(value) : '';
  } catch {
    return '';
  }
}

// The invitation link has to survive the sign-in. A new user opening
// /?codigo=… has no session yet, so App.jsx sends them to /login with
// <Navigate replace> (dropping the query string) and Login then does
// `location.href = '/'` — by the time Onboarding mounts, the code is gone.
// main.jsx therefore remembers it on the very first load; Onboarding reads the
// URL first and this second, and forgets it once onboarding succeeds. It is
// only a pre-fill: the server still resolves the code, and joining only
// creates a PENDING request.
export const INVITE_CODE_STORAGE_KEY = 'liuma.inviteCode';

function browserStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Store the invitation code from `search` (if any). Never throws. */
export function rememberInviteCode(search, storage = browserStorage()) {
  const code = readJoinCodeFromSearch(search);
  if (!code || !storage) return '';
  try {
    storage.setItem(INVITE_CODE_STORAGE_KEY, code);
  } catch {
    // Private mode / blocked storage: the link just won't pre-fill.
  }
  return code;
}

export function readRememberedInviteCode(storage = browserStorage()) {
  try {
    const value = storage?.getItem(INVITE_CODE_STORAGE_KEY);
    return value ? formatJoinCode(value) : '';
  } catch {
    return '';
  }
}

export function forgetInviteCode(storage = browserStorage()) {
  try {
    storage?.removeItem(INVITE_CODE_STORAGE_KEY);
  } catch {
    // nothing to do
  }
}

export function buildJoinShareMessage({ schoolName, code, link }) {
  const name = String(schoolName || 'nuestra escuela').trim();
  return [
    `Te invitamos a ${name} en LIUMA.`,
    `Entra a ${link} con tu correo y, si te lo pide, usa el código ${formatJoinCode(code)}.`,
    'La escuela aprobará tu acceso en cuanto te registres.',
  ].join('\n');
}

export function buildWhatsAppShareUrl(message) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
