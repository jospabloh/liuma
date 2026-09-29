import { useQuery } from '@tanstack/react-query';
import { schoolRead } from '@/lib/data/schoolRead';
import { useSubscription } from '@/hooks/useSubscription';
import { PAYWALL_GATING_ENABLED } from '@/lib/featureGates';
import { evaluateStudentQuota } from '@/lib/license/licenseModel';

/**
 * useStudentQuota — licensed student-capacity gating for the current school.
 *
 * Combines the tenant's tier/status (from useSubscription) with the live count
 * of active students to tell the UI whether a new student can be added under
 * the current license. Gating only bites when PAYWALL_GATING_ENABLED is on and
 * the actor is not the ACACIA platform owner.
 */
export function useStudentQuota() {
  const { userProfile, isPlatformOwner, licenseTier, billingStatus, isLoading: subLoading } = useSubscription();
  const schoolId = userProfile?.school_id || null;

  const { data: activeStudentCount = 0, isLoading: countLoading } = useQuery({
    queryKey: ['activeStudentCount', schoolId],
    queryFn: async () => {
      const students = await schoolRead('Student', { school_id: schoolId, is_active: true });
      return students.length;
    },
    enabled: !!schoolId,
    staleTime: 60 * 1000,
  });

  const quota = evaluateStudentQuota({
    licenseTier,
    billingStatus,
    activeStudentCount,
    gatingEnabled: PAYWALL_GATING_ENABLED,
    isPlatformOwner,
  });

  return { ...quota, licenseTier, billingStatus, isLoading: subLoading || (!!schoolId && countLoading) };
}
