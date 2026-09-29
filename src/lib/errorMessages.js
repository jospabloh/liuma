// Turns whatever the Base44 SDK (or a backend function) threw into one short
// Spanish sentence a director, teacher or parent can act on.
//
// Why this exists: failed writes used to be silent (22 of 38 mutations had no
// onError), and the few that did handle errors printed the raw message — which
// for our own functions is English ("Not permitted to write this resource")
// and for the SDK is whatever axios said. The global QueryCache/MutationCache
// handlers in query-client.js route every unhandled failure through here.
//
// Pure and import-free so `node --test` can load it.

/** Error codes our backend functions return in `error.data.code`. */
const CODE_MESSAGES = {
  WRITE_BLOCKED: 'Tu escuela está en modo solo lectura. Reactiva la licencia para guardar cambios.',
  FORBIDDEN: 'No tienes permiso para hacer este cambio.',
  NO_PROFILE: 'Tu perfil no está activo en esta escuela.',
  UNAUTHENTICATED: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  NOT_FOUND: 'Ese registro ya no existe. Recarga la página.',
  STUDENT_NOT_IN_SCHOOL: 'Ese alumno no pertenece a tu escuela.',
};

const STATUS_MESSAGES = {
  400: 'Revisa los datos e inténtalo de nuevo.',
  401: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  403: 'No tienes permiso para hacer esto.',
  404: 'No encontramos lo que buscabas. Recarga la página.',
  409: 'Alguien más modificó esto al mismo tiempo. Recarga e inténtalo de nuevo.',
  413: 'El archivo es demasiado grande.',
  429: 'Demasiados intentos seguidos. Espera un momento e inténtalo de nuevo.',
};

export const GENERIC_ERROR_MESSAGE = 'Algo salió mal. Inténtalo de nuevo en un momento.';
export const NETWORK_ERROR_MESSAGE = 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.';
export const SERVER_ERROR_MESSAGE = 'El servidor tuvo un problema. Inténtalo de nuevo en un momento.';

/** HTTP status from a Base44Error / axios error, or undefined when none arrived. */
export function errorStatus(error) {
  if (!error || typeof error !== 'object') return undefined;
  const status = error.status ?? error.response?.status ?? error.originalError?.response?.status;
  return typeof status === 'number' && status > 0 ? status : undefined;
}

/**
 * True when the request never got an HTTP answer (offline, DNS, CORS, timeout).
 * That is the case the login screen used to report as "contraseña incorrecta".
 */
export function isNetworkError(error) {
  if (!error) return false;
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return true;
  if (errorStatus(error) !== undefined) return false;
  const code = error.code || error.originalError?.code;
  if (code === 'ERR_NETWORK' || code === 'ECONNABORTED' || code === 'ETIMEDOUT') return true;
  const message = String(error.message || '');
  return /network\s*error|failed to fetch|load failed|timeout/i.test(message);
}

/** One user-facing Spanish sentence for any thrown error. */
export function humanizeError(error) {
  if (!error) return GENERIC_ERROR_MESSAGE;
  const code = error.data?.code;
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];
  if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE;
  const status = errorStatus(error);
  if (status && STATUS_MESSAGES[status]) return STATUS_MESSAGES[status];
  if (status && status >= 500) return SERVER_ERROR_MESSAGE;
  return GENERIC_ERROR_MESSAGE;
}

/**
 * Login-specific classification. Only a 4xx answer from the auth endpoint
 * means "wrong email or password"; everything else is the network or the
 * server, and telling a parent on a flaky connection that their password is
 * wrong sends them straight to a pointless reset.
 */
export function describeLoginError(error) {
  if (isNetworkError(error)) return { kind: 'network', message: NETWORK_ERROR_MESSAGE };
  const status = errorStatus(error);
  if (status === 429) return { kind: 'rate_limited', message: STATUS_MESSAGES[429] };
  if (status && status >= 500) return { kind: 'server', message: SERVER_ERROR_MESSAGE };
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422) {
    return { kind: 'credentials', message: 'Correo o contraseña incorrectos. Inténtalo de nuevo.' };
  }
  return { kind: 'unknown', message: GENERIC_ERROR_MESSAGE };
}

/**
 * Sign-up classification. "Already exists" is the common one (a parent the
 * school already invited), and the useful answer is where to go instead.
 */
export function describeSignupError(error) {
  if (isNetworkError(error)) return { kind: 'network', message: NETWORK_ERROR_MESSAGE };
  const status = errorStatus(error);
  const text = `${error?.message || ''} ${error?.data?.detail || ''}`;
  if (status === 409 || /already|exist|registrad/i.test(text)) {
    return { kind: 'exists', message: 'Ya hay una cuenta con ese correo. Inicia sesión o recupera tu contraseña.' };
  }
  if (status === 403) {
    return { kind: 'closed', message: 'El registro abierto no está disponible. Pide a la dirección de tu escuela que te invite.' };
  }
  if (status === 429) return { kind: 'rate_limited', message: STATUS_MESSAGES[429] };
  if (status && status >= 500) return { kind: 'server', message: SERVER_ERROR_MESSAGE };
  if (status === 400 || status === 422) {
    return { kind: 'invalid', message: 'Revisa el correo y usa una contraseña de al menos 8 caracteres.' };
  }
  return { kind: 'unknown', message: GENERIC_ERROR_MESSAGE };
}

/** Wrong / expired one-time code vs. everything else. */
export function describeOtpError(error) {
  if (isNetworkError(error)) return { kind: 'network', message: NETWORK_ERROR_MESSAGE };
  const status = errorStatus(error);
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422) {
    return { kind: 'bad_code', message: 'El código no es válido o ya venció. Revisa tu correo o pide uno nuevo.' };
  }
  return { kind: 'other', message: humanizeError(error) };
}
