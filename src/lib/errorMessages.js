// Turns whatever the Base44 SDK (or a backend function) threw into one short
// Spanish sentence a director, teacher or parent can act on.
//
// Why this exists: failed writes used to be silent (22 of 38 mutations had no
// onError), and the few that did handle errors printed the raw message — which
// for our own functions is English ("Not permitted to write this resource")
// and for the SDK is whatever axios said. The global QueryCache/MutationCache
// handlers in query-client.js route every unhandled failure through here.
//
// Pure so `node --test` can load it (its one import is import-free too).

import { functionErrorCode } from './functionResponse.js';

/** Error codes our backend functions return in their error body's `code`. */
const CODE_MESSAGES = {
  WRITE_BLOCKED: 'Tu escuela está en modo solo lectura. Reactiva la licencia para guardar cambios.',
  FORBIDDEN: 'No tienes permiso para hacer este cambio.',
  NO_PROFILE: 'Tu perfil no está activo en esta escuela.',
  UNAUTHENTICATED: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  NOT_FOUND: 'Ese registro ya no existe. Recarga la página.',
  STUDENT_NOT_IN_SCHOOL: 'Ese alumno no pertenece a tu escuela.',
  // guardedEntityWrite, P10b.
  SCHOOL_MISMATCH: 'Ese registro es de otra escuela. Recarga la página.',
  REFERENCE_NOT_IN_SCHOOL: 'Uno de los datos elegidos no pertenece a tu escuela. Recarga la página.',
  USER_NOT_IN_SCHOOL: 'Esa persona ya no está activa en tu escuela con ese rol.',
  INVALID_FIELD: 'Uno de los datos no tiene un formato válido. Revísalo e inténtalo de nuevo.',
  MISSING_FIELDS: 'Falta un dato obligatorio.',
  // guardedFamilyWrite/_policy.ts#checkAbsenceRequest (v1.8.3).
  ABSENCE_DATE_PAST: 'La fecha de la ausencia debe ser hoy o un día futuro.',
  ABSENCE_DUPLICATE: 'Ya hay una solicitud de ausencia para ese alumno en ese día.',
  NOT_RECIPIENT: 'Este aviso no está dirigido a ti.',
  INACTIVE_PROFILE: 'Tu perfil no está activo en esta escuela.',
  TOO_MANY_RECIPIENTS: 'Este aviso tiene demasiados destinatarios para enviarse de una vez.',
  TICKET_NOT_SCHOOL_TIER: 'Este ticket ya lo atiende soporte LIUMA.',
  NOT_AUTHOR: 'Solo quien lo creó o la dirección puede hacer este cambio.',
  CLASSROOM_NOT_ASSIGNED: 'Ese salón no está asignado a ti.',
  STUDENT_NOT_IN_CLASSROOM: 'Ese alumno no está en ese salón.',
  SCHOOL_NOTICE_ADMIN_ONLY: 'Solo la dirección puede enviar avisos a toda la escuela.',
  // Money rules (guardedEntityWrite/_money.ts, loose-ends pass 2026-09-30).
  INVALID_AMOUNT: 'Escribe un monto mayor que 0, con dos decimales como máximo.',
  OVERPAYMENT: 'El monto es mayor que el saldo pendiente del cargo. Revisa el saldo e inténtalo de nuevo.',
  CHARGE_ALREADY_PAID: 'Este cargo ya está liquidado; no hay saldo por cobrar.',
  CHARGE_CANCELLED: 'Este cargo está cancelado; no se le pueden registrar pagos.',
  CHARGE_HAS_PAYMENTS: 'Este cargo ya tiene pagos registrados; cancélalo en lugar de borrarlo.',
  MISSING_CHARGE: 'Falta indicar a qué cargo corresponde el pago.',
  INVALID_DUE_DATE: 'La fecha de vencimiento no es válida.',
  INVALID_PAYMENT_DATE: 'La fecha del pago no es válida o está en el futuro.',
  DISCOUNT_NOT_APPLICABLE: 'Ese descuento ya no aplica a este concepto (vigencia o tipo). Recarga e inténtalo de nuevo.',
  INVALID_DISCOUNT: 'Revisa el descuento: un porcentaje debe ser mayor que 0 y como máximo 100, un monto fijo debe ser mayor que 0, elige al menos un tipo de concepto y la vigencia debe ser coherente.',
  AMOUNT_LOCKED: 'El monto de un cargo ya creado no se puede cambiar. Cancélalo y crea uno nuevo.',
  PAYMENT_LOCKED: 'El monto de un pago registrado no se puede cambiar. Bórralo y regístralo de nuevo.',
  REMINDER_COOLDOWN: 'Ya se envió un recordatorio de este cargo en las últimas 24 horas.',
  // Concurrency (Codex review on PR #190, 2026-09-30).
  PAYMENT_CONFLICT: 'Otro pago se registró al mismo tiempo; revisa el saldo y vuelve a intentar.',
  PAYMENT_CONFLICT_UNRESOLVED: 'Otro pago se registró al mismo tiempo y este quedó de más. Revisa los pagos del cargo y borra el sobrante.',
  REMINDER_IN_PROGRESS: 'Ya se está enviando un recordatorio de este cargo. Espera un momento y recarga.',
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

/**
 * True when a sign-in was refused because the e-mail was never verified with
 * the one-time code. Base44 words it in English ("Please verify your email",
 * "verification code"); the text can sit on the error, its `data`, or the raw
 * axios `response.data`.
 */
export function needsEmailVerification(error) {
  if (!error || typeof error !== 'object') return false;
  const bodies = [error.data, error.response?.data, error.originalError?.response?.data];
  const text = [error.message, ...bodies.flatMap((b) => (b && typeof b === 'object' ? [b.message, b.detail, b.error] : [b]))]
    .filter((t) => typeof t === 'string')
    .join(' ');
  return /verify your email|verification code|email (is )?not verified|not verified/i.test(text);
}

/** One user-facing Spanish sentence for any thrown error. */
export function humanizeError(error) {
  if (!error) return GENERIC_ERROR_MESSAGE;
  // A function's refusal body: Base44Error `.data`, or AxiosError
  // `.response.data` (functions.invoke rejects with the raw axios error).
  const code = functionErrorCode(error);
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
  // Registered but never entered the e-mail code (closed the tab, lost the
  // mail): not a bad password. The login screen sends them to the code step.
  if (needsEmailVerification(error)) {
    return { kind: 'unverified', message: 'Falta confirmar tu correo. Escribe el código que te enviamos.' };
  }
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

/**
 * Password-reset request. Returns null when the answer must look like success
 * — any 4xx, which is how "no account with that e-mail" comes back, so the form
 * can't be used to find out who has an account at a school — and a message
 * when the request never reached a verdict (offline, rate limit, server error),
 * so nobody waits for an e-mail that was never sent.
 */
export function describeResetRequestError(error) {
  if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE;
  const status = errorStatus(error);
  if (status === 429) return STATUS_MESSAGES[429];
  if (status && status >= 500) return SERVER_ERROR_MESSAGE;
  return null;
}
