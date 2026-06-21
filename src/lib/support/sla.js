import { SUPPORT_PRIORITIES, TERMINAL_STATUSES, SUPPORT_TIER, PLATFORM_SLA_HOURS } from './constants.js';

/**
 * First-response SLA targets, expressed in business days (weekends excluded).
 * "Relaxed" profile — conservative while the owner is the sole platform
 * responder. Adjust here to retune every ticket created afterwards.
 */
export const SLA_BUSINESS_DAYS = {
  [SUPPORT_PRIORITIES.URGENT]: 1,
  [SUPPORT_PRIORITIES.HIGH]: 2,
  [SUPPORT_PRIORITIES.NORMAL]: 3,
  [SUPPORT_PRIORITIES.LOW]: 5,
};

const WEEKEND_DAYS = new Set([0, 6]); // Sunday, Saturday

function isWeekend(date) {
  return WEEKEND_DAYS.has(date.getUTCDay());
}

/**
 * Add N business days to a date, skipping Saturdays and Sundays.
 * Time-of-day is preserved.
 */
export function addBusinessDays(date, businessDays) {
  const result = new Date(date.getTime());
  let remaining = Math.max(0, Math.floor(businessDays));

  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (!isWeekend(result)) {
      remaining -= 1;
    }
  }

  return result;
}

/**
 * Compute the first-response SLA deadline for a ticket.
 *
 * Tier-2 (PLATFORM) tickets — the ones that reach "soporte" after Lumi and the
 * school director could not resolve them — get a fixed 48-hour target. All
 * other tickets use the priority-based business-day targets above.
 *
 * @returns {string} ISO timestamp.
 */
export function computeSlaDueAt({ priority, tier, from = new Date() } = {}) {
  const base = from instanceof Date ? from : new Date(from);
  if (tier === SUPPORT_TIER.PLATFORM) {
    return new Date(base.getTime() + PLATFORM_SLA_HOURS * 60 * 60 * 1000).toISOString();
  }
  const days = SLA_BUSINESS_DAYS[priority] ?? SLA_BUSINESS_DAYS[SUPPORT_PRIORITIES.NORMAL];
  return addBusinessDays(base, days).toISOString();
}

/**
 * Has the SLA been breached? Terminal tickets (resolved/closed/AI-resolved)
 * never count as breached.
 */
export function isSlaBreached({ slaDueAt, status, firstResponseAt, now = new Date() } = {}) {
  if (!slaDueAt) return false;
  if (TERMINAL_STATUSES.includes(status)) return false;
  if (firstResponseAt) return false; // the first response already met (or missed) — clock stops
  const current = now instanceof Date ? now : new Date(now);
  return current.getTime() > new Date(slaDueAt).getTime();
}

/** Whole hours left until the SLA deadline (negative once breached). */
export function hoursUntilSla({ slaDueAt, now = new Date() } = {}) {
  if (!slaDueAt) return null;
  const current = now instanceof Date ? now : new Date(now);
  return Math.round((new Date(slaDueAt).getTime() - current.getTime()) / (1000 * 60 * 60));
}
