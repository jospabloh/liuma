// When to retry a failed backend-function call, and how long to wait (v1.8.3).
//
// WHY. Base44 rate-limits the app's entity calls (about 150 a minute, shared
// by every user's function invocations — see base44/functions/schoolRead/
// _answer.ts). With three people browsing at once, schoolRead and
// getMySubscription failed by the hundred, and each failure became an empty
// screen: "Sin avisos", "Sin hijos vinculados", a locked "Crear aviso". The
// limit is a pause, not a verdict, so a READ that hits it is retried after a
// growing, jittered wait; and while one call is waiting out a rate limit, the
// next reads wait too instead of spending the budget that is already gone.
//
// WRITES ARE NEVER RETRIED HERE. A write that timed out or hit the limit may
// have happened (a guardedEntityWrite can fail after its first create), and
// doing it twice is a duplicate payment or a second email. The person sees the
// Spanish error and decides. Only functions listed in IDEMPOTENT_READ_FUNCTIONS
// (or a call that passes `{ idempotent: true }`) are retried.
//
// Import-free so `node --test` loads it.

/** Backend functions that only read (or whose only write is idempotent). */
export const IDEMPOTENT_READ_FUNCTIONS = new Set([
  'schoolRead',
  // Its one write (a missing join_code) is generated once and then read back.
  'getMySubscription',
  'listSchoolMembers',
]);

/** Retries after the first attempt. 4 tries ≈ up to ~10 s of waiting. */
export const MAX_READ_RETRIES = 3;
export const BACKOFF_BASE_MS = 600;
export const BACKOFF_CAP_MS = 6000;
/** A server's Retry-After is honoured up to this. */
export const RETRY_AFTER_CAP_MS = 10000;

function statusOf(error) {
  if (!error || typeof error !== 'object') return undefined;
  const status = error.status ?? error.response?.status ?? error.originalError?.response?.status;
  return typeof status === 'number' && status > 0 ? status : undefined;
}

function bodyOf(error) {
  if (!error || typeof error !== 'object') return null;
  const body = error.response?.data ?? error.data ?? error.originalError?.response?.data;
  return body && typeof body === 'object' ? body : null;
}

/** The platform's (or our function's) rate-limit answer, in any of its shapes. */
export function isRateLimitError(error) {
  if (!error) return false;
  if (statusOf(error) === 429) return true;
  const body = bodyOf(error);
  if (body?.code === 'RATE_LIMITED') return true;
  // Functions deployed before v1.8.3 answered 500 with the raw SDK message
  // (getMySubscription) — keep recognising it until every one is redeployed.
  const text = `${body?.error ?? ''} ${body?.message ?? ''} ${error.message ?? ''}`;
  return /rate limit/i.test(text);
}

/** No HTTP answer at all (offline, DNS, timeout, CORS). */
function isNoAnswer(error) {
  if (statusOf(error) !== undefined) return false;
  const code = error?.code || error?.originalError?.code;
  if (code === 'ERR_NETWORK' || code === 'ECONNABORTED' || code === 'ETIMEDOUT') return true;
  return /network\s*error|failed to fetch|load failed|timeout/i.test(String(error?.message || ''));
}

/**
 * Whether a failed READ is worth trying again: the rate limit, a 5xx gateway
 * hiccup, schoolRead's generic 500 INTERNAL (which, before v1.8.3, was what
 * the rate limit looked like), or no answer at all. A 4xx refusal — FORBIDDEN,
 * NOT_FOUND, an invalid filter — gets the same answer every time: never.
 */
export function isRetryableReadError(error, { online = true } = {}) {
  if (!error) return false;
  if (!online) return false;
  if (isRateLimitError(error)) return true;
  const status = statusOf(error);
  if (status === 502 || status === 503 || status === 504) return true;
  if (status === 500) return bodyOf(error)?.code === 'INTERNAL' || !bodyOf(error)?.code;
  return isNoAnswer(error);
}

/** Retry-After from the response (seconds or an HTTP date), in ms, or 0. */
export function retryAfterMs(error, now = Date.now()) {
  const headers = error?.response?.headers || error?.originalError?.response?.headers;
  const raw = headers && (typeof headers.get === 'function' ? headers.get('retry-after') : (headers['retry-after'] ?? headers['Retry-After']));
  if (raw === undefined || raw === null || raw === '') return 0;
  const seconds = Number(raw);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(String(raw)) - now;
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, RETRY_AFTER_CAP_MS) : 0;
}

/**
 * Exponential backoff with "equal jitter": half the step is fixed, half is
 * random, so a page's worth of failed reads does not come back in one burst.
 * attempt 1 → 300–600 ms, 2 → 600–1200, 3 → 1.2–2.4 s, capped at 6 s.
 */
export function backoffDelay(attempt, { baseMs = BACKOFF_BASE_MS, capMs = BACKOFF_CAP_MS, random = Math.random } = {}) {
  const step = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(step / 2 + random() * (step / 2));
}

/**
 * A shared pause: when any read is told to wait (429 + Retry-After), reads
 * that start meanwhile wait out the same window instead of spending a budget
 * the server already said is gone. Writes do not pass through it.
 */
export function makeCooldown({ now = () => Date.now() } = {}) {
  let until = 0;
  return {
    hold(ms) { until = Math.max(until, now() + ms); },
    remaining() { return Math.max(0, until - now()); },
  };
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isOnline = () => typeof navigator === 'undefined' || !navigator || navigator.onLine !== false;

/**
 * Run `attempt()` and retry it while it fails with a retryable read error.
 * The error that finally escapes carries `retriesExhausted: true` (and
 * `attempts`) so React Query does not retry the same call a second time on top.
 */
export async function withReadRetry(attempt, {
  retries = MAX_READ_RETRIES,
  sleep = defaultSleep,
  random = Math.random,
  cooldown = null,
  online = isOnline,
  onRetry = null,
} = {}) {
  for (let n = 0; ; n += 1) {
    const wait = cooldown ? cooldown.remaining() : 0;
    if (wait > 0) await sleep(wait);
    try {
      return await attempt();
    } catch (error) {
      const retryable = isRetryableReadError(error, { online: online() });
      if (!retryable || n >= retries) {
        if (retryable && error && typeof error === 'object') {
          try {
            error.retriesExhausted = true;
            error.attempts = n + 1;
          } catch {
            // frozen error: React Query may retry once more, harmless
          }
        }
        throw error;
      }
      const hinted = retryAfterMs(error);
      const delay = Math.max(backoffDelay(n + 1, { random }), hinted);
      if (cooldown && isRateLimitError(error)) cooldown.hold(delay);
      if (onRetry) onRetry({ attempt: n + 1, delay, error });
      await sleep(delay);
    }
  }
}
