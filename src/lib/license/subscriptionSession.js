// One getMySubscription per session (v1.8.3).
//
// useSubscription is mounted by a dozen components (nav, banners, every
// write-gated screen). React Query already shares one request between them
// within a page, but the answer was fresh for only 2 minutes and lived only in
// memory, so every full load of the app — a reload, a link opened from an
// email, an installed PWA resuming — asked again; under Base44's app-wide rate
// limit that request was one of the two that failed most (with the director's
// "Crear aviso" locked behind it). The license does not change from one minute
// to the next: it is kept for SUBSCRIPTION_FRESH_MS, in memory and in this
// tab's sessionStorage, keyed by user AND school so another account in the
// same tab never inherits it.
//
// This is display state. The server still decides every write
// (guardedEntityWrite re-checks the license), so a stale or edited copy here
// can at most show a banner late — it cannot let a read-only school write.
//
// Import-free so `node --test` loads it.

export const MY_SUBSCRIPTION_QUERY_KEY = 'mySubscription';
export const SUBSCRIPTION_FRESH_MS = 5 * 60 * 1000;
export const SUBSCRIPTION_STORAGE_KEY = 'liuma.mySubscription.v1';

function safeStorage(storage) {
  if (storage !== undefined) return storage;
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null; // storage blocked (privacy mode, sandboxed iframe)
  }
}

/**
 * The stored answer for this user and school, if it is still fresh:
 * `{ data, updatedAt }`, or undefined. Anything unreadable is ignored.
 */
export function readSessionSubscription({ userId, schoolId, now = Date.now(), storage } = {}) {
  const store = safeStorage(storage);
  if (!store || !userId || !schoolId) return undefined;
  try {
    const raw = store.getItem(SUBSCRIPTION_STORAGE_KEY);
    if (!raw) return undefined;
    const entry = JSON.parse(raw);
    if (entry?.userId !== userId || entry?.schoolId !== schoolId) return undefined;
    const updatedAt = Number(entry.updatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt > now || now - updatedAt >= SUBSCRIPTION_FRESH_MS) return undefined;
    if (!entry.data || typeof entry.data !== 'object' || entry.data.ok !== true) return undefined;
    return { data: entry.data, updatedAt };
  } catch {
    return undefined;
  }
}

/** Remember a successful answer for this user and school. Never throws. */
export function writeSessionSubscription({ userId, schoolId, data, now = Date.now(), storage } = {}) {
  const store = safeStorage(storage);
  if (!store || !userId || !schoolId || !data || data.ok !== true) return;
  try {
    store.setItem(SUBSCRIPTION_STORAGE_KEY, JSON.stringify({ userId, schoolId, updatedAt: now, data }));
  } catch {
    // quota or blocked storage: the in-memory cache still works
  }
}

/** Forget it (sign-out, or a license change made from this tab). */
export function clearSessionSubscription({ storage } = {}) {
  const store = safeStorage(storage);
  try {
    store?.removeItem(SUBSCRIPTION_STORAGE_KEY);
  } catch {
    // nothing to do
  }
}
