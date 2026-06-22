import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

/**
 * Loads the authenticated user and their UserProfile — the two-query pattern
 * that was copy-pasted into ~26 pages. Deliberately reuses the same
 * ['currentUser'] and ['userProfile', user.id] query keys those pages already
 * used, so the react-query cache is shared (no extra network calls) and pages
 * can adopt this hook incrementally without any behavior change.
 *
 * Returns `userProfile` as the first matching profile (or undefined while it
 * loads / if none exists), mirroring the previous inline `profiles[0]` usage.
 */
export function useCurrentProfile() {
  const userQuery = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });
  const user = userQuery.data;

  const profileQuery = useQuery({
    queryKey: ['userProfile', user?.id],
    queryFn: async () => {
      const profiles = await base44.entities.UserProfile.filter({ user_id: user.id });
      return profiles[0];
    },
    enabled: !!user,
  });

  return {
    user,
    userProfile: profileQuery.data,
    // True until we know the user and (if there is one) their profile.
    isLoading: userQuery.isLoading || (!!user && profileQuery.isLoading),
  };
}
