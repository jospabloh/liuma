/**
 * Pure write-guard helper (no React / Base44) so it is unit-testable and shared
 * across mutation handlers. See useCanWrite for the React hook that computes the
 * `canWrite` flag from the school's license status.
 */

/**
 * Returns true when the write may proceed; otherwise runs `onBlocked` (e.g. a
 * toast / open upgrade modal) and returns false. Keeps the read-only check
 * identical across call sites.
 */
export function guardWrite(canWrite, onBlocked) {
  if (canWrite) return true;
  onBlocked?.();
  return false;
}
