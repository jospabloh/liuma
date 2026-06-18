import { useSubscription } from '@/hooks/useSubscription';
import { guardWrite } from '@/lib/license/writeGuard';

export { guardWrite };

/**
 * useCanWrite — central read-only gate driven by the school's license status.
 *
 * When the subscription is in a read-only state (view_only / suspended /
 * inactive / canceled), write actions must be blocked in the UI. The ACACIA
 * platform owner always retains write access, and while the subscription is
 * still loading we optimistically allow writes to avoid a flash / false block
 * for paying tenants.
 *
 * Returns `{ canWrite, isReadOnly, billingStatus, isLoading }`.
 */
export function useCanWrite() {
  const { isLoading, isReadOnly, isPlatformOwner, billingStatus } = useSubscription();

  // Don't block while we don't yet know the status.
  const blocked = !isLoading && isReadOnly && !isPlatformOwner;

  return {
    canWrite: !blocked,
    isReadOnly: blocked,
    billingStatus,
    isLoading,
  };
}
