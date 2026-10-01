import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { selectCurrentUserProfile } from '@/lib/tenantSelection';
import { isPlatformOwner } from '@/lib/support/owner';
import { normalizeSubscription } from '@/lib/license/licenseModel';
import { invokeFunction } from '@/lib/functionResponse';
import {
  MY_SUBSCRIPTION_QUERY_KEY, SUBSCRIPTION_FRESH_MS, readSessionSubscription, writeSessionSubscription,
} from '@/lib/license/subscriptionSession';

/**
 * useSubscription — the current user's school license, normalized for the UI
 * (billingStatus, isReadOnly, licenseTier, trialDaysLeft, limits, …), plus the
 * school header (name / logo / theme, and join_code for ADMIN).
 *
 * Reads through the getMySubscription backend function, NOT the entity: the
 * SchoolSubscription read rule is platform-only, and its old tenant branch
 * depended on User fields nobody has, so a direct read always returned null
 * for school users (audit F10). The function re-derives the school from the
 * caller's own ACTIVE profile; the client sends nothing.
 *
 * Fail closed (owner decision 2026-09-29): no subscription row, an expired
 * trial, or a failed read → isReadOnly. `effective` from the server wins over
 * the client's own computation so both sides agree on the same clock.
 */
export { MY_SUBSCRIPTION_QUERY_KEY };

export function useSubscription() {
  const { data: user, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: userProfile, isLoading: profileLoading } = useQuery({
    queryKey: ['userProfile', user?.id],
    queryFn: async () => {
      const profiles = await base44.entities.UserProfile.filter({ user_id: user.id }, '-created_date');
      return selectCurrentUserProfile(profiles);
    },
    enabled: !!user?.id,
  });

  const canQuery = !!userProfile?.school_id && userProfile?.status === 'ACTIVE';
  const sessionKey = { userId: user?.id, schoolId: userProfile?.school_id };
  // One request per session (subscriptionSession.js): a fresh answer from
  // this tab's sessionStorage seeds the cache, so a reload does not ask again.
  const stored = canQuery ? readSessionSubscription(sessionKey) : undefined;
  const { data: result, isLoading: subLoading, isError, refetch } = useQuery({
    queryKey: [MY_SUBSCRIPTION_QUERY_KEY, user?.id, userProfile?.school_id],
    // invokeFunction unwraps the axios response to the function's body, and
    // retries it with backoff on Base44's rate limit (it is a read).
    queryFn: async () => {
      const body = await invokeFunction(base44, 'getMySubscription', {});
      writeSessionSubscription({ ...sessionKey, data: body });
      return body;
    },
    enabled: canQuery,
    initialData: stored?.data,
    initialDataUpdatedAt: stored?.updatedAt,
    staleTime: SUBSCRIPTION_FRESH_MS,
    // invokeFunction already retried it; React Query's default policy
    // (query-client.js) does not stack more retries on top.
  });

  const subscription = result?.subscription || null;
  const license = normalizeSubscription(subscription);
  const effective = result?.effective || null;
  const isReadOnly = effective ? Boolean(effective.isReadOnly) : license.isReadOnly;

  const isLoading = userLoading || (!!user && profileLoading) || (canQuery && subLoading);

  return {
    user,
    userProfile,
    subscription,
    school: result?.school || null,
    isLoading,
    loadFailed: isError,
    isPlatformOwner: isPlatformOwner({ userProfile, user }),
    isSchoolAdmin: userProfile?.app_role === 'ADMIN',
    refetchSubscription: refetch,
    ...license,
    effectiveStatus: effective?.status || license.effectiveStatus,
    readOnlyReason: isReadOnly ? (effective?.reason || license.readOnlyReason || 'missing') : null,
    isReadOnly,
  };
}
