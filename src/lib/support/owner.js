/**
 * Decide whether the current actor is the LIUMA platform owner (entitled to see
 * support tickets across every tenant), as opposed to a school director who
 * only sees their own school.
 *
 * Two signals, OR'd:
 *  - `UserProfile.is_super_admin === true` — the server-persisted owner flag the
 *    rest of the app uses. Declared on UserProfile with a field-level write
 *    lock (only the platform owner, role admin, may set it — P7, 2026-09-29);
 *    before that it was undeclared and a user could set it on their own
 *    profile to unlock the owner UI. It still only gates UI: data access is
 *    decided by RLS and the backend functions, never by this flag.
 *  - the authenticated Base44 `User.role === 'admin'` — the app creator/owner at
 *    the platform level (a regular app user is `user`). This is the fallback so
 *    owner access doesn't silently break when `is_super_admin` isn't defined.
 */
export function isPlatformOwner({ userProfile, user } = {}) {
  if (userProfile?.is_super_admin === true) return true;
  if (user?.role === 'admin') return true;
  return false;
}
