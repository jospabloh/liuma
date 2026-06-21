/**
 * Feature gating configuration for LIUMA's license tiers.
 *
 * Mirrors FlowFin's featureGates: a map of feature_key → minimum tier that
 * includes it, combined with the school's `billing_status` and `license_tier`
 * by `useFeatureGate`.
 *
 * Tier hierarchy (cumulative — each tier inherits the previous one):
 *   start → growth → plus
 *
 * `trial` is treated as a preview of all features so the institution can
 * validate the product before paying. `view_only` / `suspended` (and the legacy
 * `inactive` / `canceled`) block premium features regardless of `license_tier`.
 *
 * Gating is controlled by VITE_PAYWALL_GATING_ENABLED and is ON by default
 * (see PAYWALL_GATING_ENABLED below); set it to `false` in the build env to
 * disable it for a sandbox tenant. `trial` previews all features, so existing
 * trial tenants are unaffected even with gating on.
 */

import { PLAN_LIMITS, PLAN_TIERS, planRank } from '@/lib/license/licenseModel';

export { PLAN_TIERS, planRank };

/**
 * feature_key → minimum tier (string), or a per-tier quota object.
 *
 * Page-level gates are intentionally left empty for now: the public LIUMA
 * pricing differentiates tiers by capacity/depth rather than by hiding modules,
 * so the only gate shipped today is the licensed student capacity. Add
 * `'page.<Name>': 'growth'` style entries here when a module becomes tier-only.
 */
export const FEATURE_TIERS = {
  // Licensed student capacity per tier (null = unlimited). Used for soft limits.
  student_limit: {
    trial: PLAN_LIMITS.plus, // trial previews the largest capacity
    start: PLAN_LIMITS.start,
    growth: PLAN_LIMITS.growth,
    plus: PLAN_LIMITS.plus,
  },
};

/**
 * Gating master switch. Tier gating is ON by default; set
 * VITE_PAYWALL_GATING_ENABLED=false in the build env to disable it (e.g. for a
 * sandbox tenant). The ACACIA platform owner always bypasses gating regardless.
 */
export const PAYWALL_GATING_ENABLED =
  import.meta.env.VITE_PAYWALL_GATING_ENABLED !== 'false';
