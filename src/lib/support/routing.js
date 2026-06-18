import {
  SUPPORT_CATEGORIES,
  SUPPORT_TIER,
  SUPPORT_AUTHOR_ROLE,
  DEFAULT_CATEGORY,
} from './constants.js';

/**
 * Categories that are about the LIUMA app itself rather than a particular
 * school's operations, so they escalate to the platform owner instead of the
 * school director.
 */
const PLATFORM_CATEGORIES = new Set([
  SUPPORT_CATEGORIES.TECHNICAL,
  SUPPORT_CATEGORIES.BILLING,
]);

/**
 * Decide who handles an escalated ticket.
 *
 * Rules:
 *  - A school director (ADMIN) sits at the top of their school, so their own
 *    tickets always go to the platform owner regardless of category.
 *  - For parents and teachers, app/billing issues go to the owner; everything
 *    else (academic, payments, account, other) goes to their school director
 *    first.
 *
 * @returns {{ tier: string, assigneeRole: string }}
 */
export function resolveSupportRouting({ requesterRole, category } = {}) {
  const normalizedCategory = category || DEFAULT_CATEGORY;

  if (requesterRole === 'ADMIN') {
    return { tier: SUPPORT_TIER.PLATFORM, assigneeRole: SUPPORT_AUTHOR_ROLE.OWNER };
  }

  if (PLATFORM_CATEGORIES.has(normalizedCategory)) {
    return { tier: SUPPORT_TIER.PLATFORM, assigneeRole: SUPPORT_AUTHOR_ROLE.OWNER };
  }

  return { tier: SUPPORT_TIER.SCHOOL_ADMIN, assigneeRole: SUPPORT_AUTHOR_ROLE.SCHOOL_ADMIN };
}

export function isPlatformCategory(category) {
  return PLATFORM_CATEGORIES.has(category);
}
