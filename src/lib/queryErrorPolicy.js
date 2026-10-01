// Decides which React Query failures get a global toast (query-client.js).
// Kept apart from query-client.js — which imports sonner and the `@` alias —
// so `node --test` can load it.
import { errorStatus, humanizeError } from './errorMessages.js';
import { backoffDelay, isRetryableReadError } from './functionRetry.js';

/**
 * How long a loaded list stays fresh (v1.8.3). Was 0: every mount of every
 * screen refetched everything it showed — going Home → Avisos → Home asked the
 * server for Home's lists twice. A write still refreshes what it touched
 * (each mutation invalidates its own query keys), so this only removes
 * repeats, never hides a change the person just made.
 */
export const QUERY_STALE_TIME_MS = 30 * 1000;

/** React Query's own retries, on top of invokeFunction's. */
export const QUERY_MAX_RETRIES = 2;

/**
 * Whether React Query should try a failed query again. Never when
 * invokeFunction already spent its retries on it (retriesExhausted) — that
 * would multiply the calls exactly when the server asked for fewer — nor for
 * a 4xx refusal or the "no row" undefined-data error. Otherwise a transient
 * failure (rate limit, 5xx, no answer) of a direct SDK read gets two more
 * tries with backoff.
 */
export function shouldRetryQuery(failureCount, error) {
  if (failureCount >= QUERY_MAX_RETRIES) return false;
  if (!error || error.retriesExhausted) return false;
  if (isUndefinedDataError(error)) return false;
  return isRetryableReadError(error, { online: typeof navigator === 'undefined' || navigator.onLine !== false });
}

/** Delay before React Query's retry number `attempt` (0-based). */
export function queryRetryDelay(attempt) {
  return backoffDelay(attempt + 1);
}

/**
 * Toast for a failed read, or null for none.
 *  - `meta.silentError` opts a background/best-effort query out;
 *  - a 401, and any failure of ['currentUser'], is the auth flow's job: ['currentUser'] is mounted app-wide
 *    (TenantThemeRuntime, NavContext) and legitimately 401s on the login
 *    screen, where "tu sesión expiró" would be wrong and alarming.
 * The id dedupes by message, so going offline — which fails every query on
 * the page at once — shows one toast, not ten.
 */
export function queryErrorToast(error, query) {
  if (query?.meta?.silentError) return null;
  if (errorStatus(error) === 401) return null;
  // Who-am-I is mounted on every screen, the login screen included, and
  // AuthContext already turns its failure into the login / not-registered
  // screens. A toast on top would only say the same thing worse.
  if (Array.isArray(query?.queryKey) && query.queryKey[0] === 'currentUser') return null;
  // React Query v5 turns a queryFn that returns `undefined` into an error.
  // Many of ours do exactly that for "no row" (`(await X.filter(...))[0]`,
  // useCurrentProfile before a user has a profile), and every screen already
  // renders that as "none". It is not a failed load: toasting it would greet
  // every brand-new user on onboarding with "Algo salió mal".
  if (isUndefinedDataError(error)) return null;
  const message = humanizeError(error);
  return { message, id: `query-error:${message}` };
}

export function isUndefinedDataError(error) {
  // query-core throws `${queryHash} data is undefined` (and only logs the
  // longer "Query data cannot be undefined…" to the console in dev).
  return /\bdata is undefined$|Query data cannot be undefined/i.test(String(error?.message || ''));
}

/**
 * Toast for a failed write, or null for none. A mutation with its own
 * `onError` already told the user; showing a second, generic toast on top
 * would contradict the specific one.
 */
export function mutationErrorToast(error, mutation) {
  if (mutation?.options?.onError || mutation?.meta?.silentError) return null;
  return { message: humanizeError(error) };
}
