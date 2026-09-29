// Decides which React Query failures get a global toast (query-client.js).
// Kept apart from query-client.js — which imports sonner and the `@` alias —
// so `node --test` can load it.
import { errorStatus, humanizeError } from './errorMessages.js';

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
