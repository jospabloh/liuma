// The ONE place the client talks to backend functions.
//
// `base44.functions.invoke()` does NOT behave like `base44.entities.*`. The
// SDK builds its functions client with `interceptResponses: false`
// (node_modules/@base44/sdk/dist/client.js), so:
//
//   - on success it resolves to the whole axios RESPONSE — `{ data, status,
//     headers, config }` — and the function's JSON body is `response.data`
//     (the SDK's own doc example reads `result.data.total`);
//   - on a non-2xx it rejects with a raw AxiosError, whose body is
//     `error.response.data` — there is no `error.data` like a Base44Error has.
//
// Before the 2026-09-29 integration every call site read the body straight
// off the response (`result.record`, `response.text`, `out.done`,
// `result.users`) and the error straight off `error.data`, so all of them got
// undefined: guardedCreate returned nothing (CrearBitacora crashed on
// `entry.id` before notifyParents), the member directory was always empty,
// the Lumi diary draft and the support intake never showed a result, the
// emergency alert's "X de Y" summary was blank, and every specific error
// message ("Esta solicitud ya fue atendida", "límite diario") fell through to
// the generic one. Four packages of that pass had each grown their own unwrap
// helper; this module replaces all of them.
//
// Rule: every `functions.invoke` in src/ goes through `invokeFunction`
// (tests/unit/function-response.test.js fails otherwise). Its only import is
// import-free, so `node --test` loads it.
//
// v1.8.3: a READ function (IDEMPOTENT_READ_FUNCTIONS in functionRetry.js) is
// retried here on Base44's rate limit, a gateway 5xx, a 500 INTERNAL or no
// answer — with a jittered exponential backoff and a shared pause while the
// server says to wait. Writes go out once, always.
import { IDEMPOTENT_READ_FUNCTIONS, makeCooldown, withReadRetry } from './functionRetry.js';

/** A function's JSON body from what `functions.invoke` resolved to. Accepts a
 * bare body too, so a test double or a future SDK that unwraps keeps working;
 * a body that merely has a `data` key is not mistaken for an axios response. */
export function unwrapFunctionResponse(response) {
  if (
    response &&
    typeof response === 'object' &&
    'data' in response &&
    ('status' in response || 'headers' in response || 'config' in response)
  ) {
    return response.data;
  }
  return response;
}

/** The JSON body a failed function call answered with (`{ code, error, … }`),
 * from an AxiosError (`error.response.data`) or a Base44Error (`error.data`).
 * Null when the request never got an answer (network) or the body isn't JSON. */
export function functionErrorBody(error) {
  if (!error || typeof error !== 'object') return null;
  const body = error.response?.data ?? error.data ?? error.originalError?.response?.data;
  return body && typeof body === 'object' ? body : null;
}

/** The machine-readable `code` a function refused with (e.g. 'WRITE_BLOCKED'). */
export function functionErrorCode(error) {
  const code = functionErrorBody(error)?.code;
  return typeof code === 'string' && code ? code : null;
}

/**
 * Give a raw AxiosError the same `error.data` / `error.status` a Base44Error
 * carries, so existing `error?.data?.code` checks and humanizeError() see the
 * function's answer. Mutates and returns the same error (stack preserved).
 */
export function normalizeFunctionError(error) {
  if (!error || typeof error !== 'object') return error;
  const body = functionErrorBody(error);
  try {
    if (body && error.data === undefined) error.data = body;
    const status = error.response?.status;
    if (typeof status === 'number' && error.status === undefined) error.status = status;
  } catch {
    // A frozen error object: leave it; functionErrorBody() still reads it.
  }
  return error;
}

// One pause for the whole tab: Base44's budget is app-wide, so a rate limit
// seen by one read applies to the next one too.
const readCooldown = makeCooldown();

async function invokeOnce(client, name, payload) {
  let response;
  try {
    response = await client.functions.invoke(name, payload);
  } catch (error) {
    throw normalizeFunctionError(error);
  }
  return unwrapFunctionResponse(response);
}

/**
 * Call a backend function and resolve to its JSON body. Rejects with the
 * original error, normalized (see normalizeFunctionError).
 *
 * @param {{ functions: { invoke: (name: string, payload?: object) => Promise<any> } }} client
 *   the Base44 client (`base44` from '@/api/base44Client')
 * @param {string} name
 * @param {object} [payload]
 * @param {{ idempotent?: boolean, retry?: object }} [options]
 *   `idempotent` overrides the read list (true: retry a call that is safe to
 *   repeat; false: never retry). `retry` is passed to withReadRetry (tests).
 */
// Listeners told after a non-read function call succeeded (query-client.js
// marks every cached list stale, so the next screen reads fresh data).
const writeListeners = new Set();

/** Register `fn(name)` to run after any successful non-read call. Returns an unsubscribe. */
export function onFunctionWrite(fn) {
  writeListeners.add(fn);
  return () => writeListeners.delete(fn);
}

export async function invokeFunction(client, name, payload = {}, options = {}) {
  const idempotent = options.idempotent ?? IDEMPOTENT_READ_FUNCTIONS.has(name);
  if (!idempotent) {
    const body = await invokeOnce(client, name, payload);
    for (const fn of writeListeners) {
      try { fn(name); } catch { /* a listener never fails the write */ }
    }
    return body;
  }
  return withReadRetry(() => invokeOnce(client, name, payload), { cooldown: readCooldown, ...(options.retry || {}) });
}
