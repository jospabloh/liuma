import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { selectCurrentUserProfile } from '@/lib/tenantSelection';
import { isPlatformOwner } from '@/lib/support/owner';
import { normalizeSubscription } from '@/lib/license/licenseModel';

/**
 * useSubscription — loads the current user's school subscription and exposes the
 * normalized license state the UI consumes (billingStatus, isReadOnly,
 * licenseTier, trialDaysLeft, limits, …).
 *
 * This is the LIUMA analogue of FlowFin's FamilyContext license slice. It reads
 * the SchoolSubscription entity directly (RLS-scoped) rather than via a backend
 * function, matching LIUMA's client-side data-access pattern.
 */
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

  const { data: subscription, isLoading: subLoading, refetch } = useQuery({
    queryKey: ['schoolSubscription', userProfile?.school_id],
    queryFn: async () => {
      const subs = await base44.entities.SchoolSubscription.filter({ school_id: userProfile.school_id });
      return subs[0] || null;
    },
    enabled: !!userProfile?.school_id,
    staleTime: 2 * 60 * 1000,
  });

  const isLoading = userLoading || (!!user && profileLoading) || (!!userProfile?.school_id && subLoading);
  const license = normalizeSubscription(subscription);

  return {
    user,
    userProfile,
    subscription,
    isLoading,
    isPlatformOwner: isPlatformOwner({ userProfile, user }),
    isSchoolAdmin: userProfile?.app_role === 'ADMIN',
    refetchSubscription: refetch,
    ...license,
  };
}
