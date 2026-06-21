import { useSubscription } from '@/hooks/useSubscription';
import { FEATURE_TIERS, PAYWALL_GATING_ENABLED, planRank } from '@/lib/featureGates';

/**
 * useFeatureGate — tier-based feature gating for LIUMA (mirrors FlowFin).
 *
 * Returns `{ status, requiredTier, currentTier, billingStatus, isLoading }`:
 *   - 'loading' while the subscription is still resolving (render a skeleton,
 *     NOT a paywall — avoids a flash for paying tenants).
 *   - 'allowed' when the tenant can use the feature.
 *   - 'denied' when the feature is gated for the current tier.
 *
 * Resolution order (highest priority first):
 *   1. Platform owner (ACACIA) → always allowed.
 *   2. Master switch off (VITE_PAYWALL_GATING_ENABLED === 'false') → allowed.
 *      NOTE: gating is ON by default (see featureGates.js → PAYWALL_GATING_ENABLED).
 *   3. billing_status read-only (view_only/suspended/inactive/canceled) → denied.
 *   4. billing_status === 'trial' → allowed (preview window).
 *   5. licenseTier rank >= required rank → allowed; else denied.
 */
export function useFeatureGate(featureKey) {
  const { isLoading, isPlatformOwner, isReadOnly, billingStatus, licenseTier } = useSubscription();

  if (isLoading) {
    return { status: 'loading', requiredTier: null, currentTier: licenseTier || null, billingStatus: billingStatus || null, isLoading: true };
  }

  if (isPlatformOwner) {
    return { status: 'allowed', requiredTier: null, currentTier: licenseTier, billingStatus, isLoading: false };
  }

  if (!PAYWALL_GATING_ENABLED) {
    return { status: 'allowed', requiredTier: null, currentTier: licenseTier, billingStatus, isLoading: false };
  }

  const required = FEATURE_TIERS[featureKey];
  // Unknown keys and non-tier (quota) configs are not page gates → allowed here.
  if (!required || typeof required === 'object') {
    return { status: 'allowed', requiredTier: null, currentTier: licenseTier, billingStatus, isLoading: false };
  }

  if (isReadOnly) {
    return { status: 'denied', requiredTier: required, currentTier: licenseTier, billingStatus, isLoading: false };
  }

  if (billingStatus === 'trial') {
    return { status: 'allowed', requiredTier: required, currentTier: licenseTier, billingStatus, isLoading: false };
  }

  if (planRank(licenseTier) >= planRank(required)) {
    return { status: 'allowed', requiredTier: required, currentTier: licenseTier, billingStatus, isLoading: false };
  }

  return { status: 'denied', requiredTier: required, currentTier: licenseTier, billingStatus, isLoading: false };
}
