import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { selectCurrentUserProfile } from '@/lib/tenantSelection';

/**
 * Loads just the authenticated Base44 user. Pages that only need the user (not
 * their school profile) should use this so they don't trigger an unnecessary
 * UserProfile fetch. Shares the ['currentUser'] cache key with the rest of the
 * app, so it never double-fetches.
 */
export function useCurrentUser() {
  const userQuery = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });
  return { user: userQuery.data, isLoading: userQuery.isLoading };
}

/**
 * Loads the authenticated user and their UserProfile — the two-query pattern
 * that was copy-pasted across the app. Deliberately reuses the same
 * ['currentUser'] and ['userProfile', user.id] query keys, so the react-query
 * cache is shared (no extra network calls) and pages can adopt this hook without
 * any behavior change.
 *
 * Returns `userProfile` as the first matching profile (or undefined while it
 * loads / if none exists), mirroring the previous inline `profiles[0]` usage.
 */
export function useCurrentProfile() {
  const { user, isLoading: userLoading } = useCurrentUser();

  const profileQuery = useQuery({
    queryKey: ['userProfile', user?.id],
    queryFn: async () => {
      // Own rows only (UserProfile.read is own-row under RLS). The SAME
      // deterministic pick as the server (selectCurrentUserProfile): pages hand
      // this profile's school_id to schoolRead, which refuses a school other
      // than the one it derives itself.
      const profiles = await base44.entities.UserProfile.filter({ user_id: user.id }, '-created_date');
      return selectCurrentUserProfile(profiles) || undefined;
    },
    enabled: !!user,
  });

  return {
    user,
    userProfile: profileQuery.data,
    // The raw query, so a screen can tell "no profile" from "the read
    // failed" (blockingLoadFailure, v1.8.3).
    profileQuery,
    // True until we know the user and (if there is one) their profile.
    isLoading: userLoading || (!!user && profileQuery.isLoading),
  };
}
