// Stale-chunk recovery after a deploy.
//
// Every page is React.lazy (pages.config.js), so a tab opened before a deploy
// still asks for the OLD hashed chunk the next time the user navigates. That
// file is gone, the dynamic import rejects, and without recovery the app blanks.
// The fix is one automatic reload — which fetches the new index.html and its new
// chunk names — but only ONE: if the reload itself lands on a broken chunk (a
// half-finished deploy, a CDN hiccup) we must not loop forever, so we remember
// the attempt in sessionStorage and fall back to the error boundary's
// "Recargar" button.
//
// Pure and import-free so `node --test` can load it.

export const CHUNK_RELOAD_KEY = 'liuma.chunkReloadAt';
export const CHUNK_RELOAD_WINDOW_MS = 60 * 1000;

const CHUNK_ERROR_PATTERN = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading chunk [\w-]+ failed/i;

/** Is this the error a missing lazy chunk produces (in any major browser)? */
export function isChunkLoadError(error) {
  if (!error) return false;
  if (error.name === 'ChunkLoadError') return true;
  return CHUNK_ERROR_PATTERN.test(String(error.message || error));
}

/**
 * Returns true — and records the attempt — when a reload is allowed now;
 * false when one already happened within the window. `storage` is
 * sessionStorage in the app, a plain object in tests; any storage failure
 * (private mode, blocked site data) answers false so we never reload blindly.
 */
export function claimChunkReload(storage, now = Date.now(), windowMs = CHUNK_RELOAD_WINDOW_MS) {
  try {
    const last = Number(storage.getItem(CHUNK_RELOAD_KEY));
    if (Number.isFinite(last) && last > 0 && now - last < windowMs) return false;
    storage.setItem(CHUNK_RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}
