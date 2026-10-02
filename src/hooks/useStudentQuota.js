import { useQuery } from '@tanstack/react-query';
import { schoolRead } from '@/lib/data/schoolRead';
import { useSubscription } from '@/hooks/useSubscription';
import { evaluateStudentQuota } from '@/lib/license/licenseModel';

/**
 * useStudentQuota — licensed student-capacity gating for the current school.
 *
 * Combines the tenant's tier/status (from useSubscription) with the live count
 * of active students to tell the UI whether a new student can be added under
 * the current license. The platform owner always bypasses it.
 *
 * Always gated (v1.9.0). The cap is enforced by the SERVER on every Student
 * create and re-activation (guardedEntityWrite/_policy.ts#studentHardLimit,
 * 403 STUDENT_QUOTA), with no flag. This hook only warns ahead of time, so it
 * must not depend on VITE_PAYWALL_GATING_ENABLED either: a build with the flag
 * off would hide the warning and let the director fill the whole form before
 * the server said no. tests/unit/student-quota-server.test.js holds both
 * copies of the rule to the same answers.
 */
/** The student cap is not behind PAYWALL_GATING_ENABLED (see above). */
export const STUDENT_QUOTA_ALWAYS_GATED = true;

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
    gatingEnabled: STUDENT_QUOTA_ALWAYS_GATED,
    isPlatformOwner,
  });

  return { ...quota, licenseTier, billingStatus, isLoading: subLoading || (!!schoolId && countLoading) };
}
