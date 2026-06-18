/**
 * Support desk constants.
 *
 * LIUMA's support model is a two-tier help desk:
 *   - L0  Lumi AI deflection (answers from the user manual knowledge base).
 *   - L1  Human escalation. School questions go to the school's director
 *         (ADMIN); app/technical/billing questions go to the platform owner.
 *
 * These enums are mirrored by the Base44 `SupportTicket` / `SupportTicketMessage`
 * entity schemas (see docs/support-system.md). Keep them in sync.
 */

export const SUPPORT_CATEGORIES = {
  ACADEMIC: 'ACADEMIC', // homework, attendance, diary, events — handled by the school
  PAYMENTS: 'PAYMENTS', // a specific charge/amount on a student — handled by the school
  ACCOUNT: 'ACCOUNT', // linking a child, join codes, profile data — handled by the school
  TECHNICAL: 'TECHNICAL', // the app fails, errors, won't load — handled by the platform owner
  BILLING: 'BILLING', // the school's LIUMA subscription — handled by the platform owner
  OTHER: 'OTHER', // anything else — defaults to the school first
};

export const SUPPORT_PRIORITIES = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
};

export const SUPPORT_STATUS = {
  OPEN: 'OPEN', // created, AI is still trying to deflect
  AI_RESOLVED: 'AI_RESOLVED', // the requester confirmed Lumi solved it; no human needed
  ESCALATED: 'ESCALATED', // handed to a human (school admin or owner), awaiting first response
  IN_PROGRESS: 'IN_PROGRESS', // a human has picked it up
  WAITING_USER: 'WAITING_USER', // waiting on the requester for more info
  RESOLVED: 'RESOLVED', // marked solved by the assignee
  CLOSED: 'CLOSED', // terminal
};

/** Which human tier owns an escalated ticket. */
export const SUPPORT_TIER = {
  SCHOOL_ADMIN: 'SCHOOL_ADMIN', // the requester's own school director (ADMIN)
  PLATFORM: 'PLATFORM', // the LIUMA app owner (super admin)
};

/** Who authored a message in the ticket thread. */
export const SUPPORT_AUTHOR_ROLE = {
  REQUESTER: 'REQUESTER',
  AI: 'AI',
  SCHOOL_ADMIN: 'SCHOOL_ADMIN',
  OWNER: 'OWNER',
  SYSTEM: 'SYSTEM',
};

/** Where the ticket originated. */
export const SUPPORT_CHANNEL = {
  LUMI_AI: 'LUMI_AI', // escalated from a Lumi support conversation
  MANUAL: 'MANUAL', // opened directly from the support form
};

/** Statuses in which a ticket is considered finished (no SLA clock). */
export const TERMINAL_STATUSES = [
  SUPPORT_STATUS.AI_RESOLVED,
  SUPPORT_STATUS.RESOLVED,
  SUPPORT_STATUS.CLOSED,
];

export const DEFAULT_PRIORITY = SUPPORT_PRIORITIES.NORMAL;
export const DEFAULT_CATEGORY = SUPPORT_CATEGORIES.OTHER;
