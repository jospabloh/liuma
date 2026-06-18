import { SUPPORT_STATUS } from './constants.js';

/**
 * Allowed status transitions for a support ticket. Anything not listed is
 * rejected, which keeps the lifecycle auditable and prevents, for example,
 * a closed ticket silently jumping back to "in progress" without an explicit
 * reopen.
 */
export const SUPPORT_TRANSITIONS = {
  [SUPPORT_STATUS.OPEN]: [
    SUPPORT_STATUS.AI_RESOLVED,
    SUPPORT_STATUS.ESCALATED,
    SUPPORT_STATUS.CLOSED,
  ],
  [SUPPORT_STATUS.AI_RESOLVED]: [
    SUPPORT_STATUS.ESCALATED, // requester says it wasn't actually solved
    SUPPORT_STATUS.CLOSED,
  ],
  [SUPPORT_STATUS.ESCALATED]: [
    SUPPORT_STATUS.IN_PROGRESS,
    SUPPORT_STATUS.WAITING_USER,
    SUPPORT_STATUS.RESOLVED,
    SUPPORT_STATUS.CLOSED,
  ],
  [SUPPORT_STATUS.IN_PROGRESS]: [
    SUPPORT_STATUS.WAITING_USER,
    SUPPORT_STATUS.RESOLVED,
    SUPPORT_STATUS.CLOSED,
  ],
  [SUPPORT_STATUS.WAITING_USER]: [
    SUPPORT_STATUS.IN_PROGRESS,
    SUPPORT_STATUS.RESOLVED,
    SUPPORT_STATUS.CLOSED,
  ],
  [SUPPORT_STATUS.RESOLVED]: [
    SUPPORT_STATUS.CLOSED,
    SUPPORT_STATUS.IN_PROGRESS, // reopen
  ],
  [SUPPORT_STATUS.CLOSED]: [],
};

export function canTransition(from, to) {
  return (SUPPORT_TRANSITIONS[from] || []).includes(to);
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    return {
      valid: false,
      reason: `Invalid support status transition: ${from || 'UNKNOWN'} → ${to || 'UNKNOWN'}`,
    };
  }
  return { valid: true };
}

/** Convenience: statuses a human assignee can move an escalated ticket into. */
export function nextStatusesFor(currentStatus) {
  return SUPPORT_TRANSITIONS[currentStatus] || [];
}
