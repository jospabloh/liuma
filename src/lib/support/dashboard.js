/**
 * Pure helpers for the support triage dashboard (no React / no Base44) so the
 * grouping + ordering logic is unit-testable and shared by the UI.
 *
 * "Pendiente" (pending) means the ticket still needs human attention: any status
 * that is NOT terminal (AI_RESOLVED / RESOLVED / CLOSED).
 */
import { SUPPORT_CATEGORIES, SUPPORT_PRIORITIES, TERMINAL_STATUSES } from './constants.js';
import { isSlaBreached } from './sla.js';

// High → low. Drives ordering of priority groups and within-group sorting.
export const PRIORITY_ORDER = [
  SUPPORT_PRIORITIES.URGENT,
  SUPPORT_PRIORITIES.HIGH,
  SUPPORT_PRIORITIES.NORMAL,
  SUPPORT_PRIORITIES.LOW,
];

// Display order of category groups (matches the help-desk routing model).
export const CATEGORY_ORDER = [
  SUPPORT_CATEGORIES.ACADEMIC,
  SUPPORT_CATEGORIES.PAYMENTS,
  SUPPORT_CATEGORIES.ACCOUNT,
  SUPPORT_CATEGORIES.TECHNICAL,
  SUPPORT_CATEGORIES.BILLING,
  SUPPORT_CATEGORIES.OTHER,
];

export function isPendingTicket(ticket) {
  return !!ticket && !TERMINAL_STATUSES.includes(ticket.status);
}

export function filterPendingTickets(tickets = []) {
  return tickets.filter(isPendingTicket);
}

export function priorityRank(priority) {
  const idx = PRIORITY_ORDER.indexOf(priority);
  return idx < 0 ? PRIORITY_ORDER.length : idx;
}

function createdTime(ticket) {
  const created = ticket?.created_date || ticket?.created_at;
  const t = created ? new Date(created).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Triage ordering for a list of tickets:
 *   1. higher priority first (urgent → low)
 *   2. SLA-breached first
 *   3. soonest SLA deadline first
 *   4. oldest first (created ascending)
 */
export function compareTickets(a, b, now = new Date()) {
  const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
  if (byPriority !== 0) return byPriority;

  const aBreached = isSlaBreached({ slaDueAt: a.sla_due_at, status: a.status, firstResponseAt: a.first_response_at, now });
  const bBreached = isSlaBreached({ slaDueAt: b.sla_due_at, status: b.status, firstResponseAt: b.first_response_at, now });
  if (aBreached !== bBreached) return aBreached ? -1 : 1;

  const aSla = a.sla_due_at ? new Date(a.sla_due_at).getTime() : Infinity;
  const bSla = b.sla_due_at ? new Date(b.sla_due_at).getTime() : Infinity;
  if (aSla !== bSla) return aSla - bSla;

  return createdTime(a) - createdTime(b);
}

function sortTickets(tickets, now) {
  return [...tickets].sort((a, b) => compareTickets(a, b, now));
}

/**
 * Group pending tickets by category, in CATEGORY_ORDER, dropping empty groups.
 * Each group's tickets are triage-sorted.
 * @returns {{ key: string, tickets: object[] }[]}
 */
export function groupByCategory(tickets = [], now = new Date()) {
  const pending = filterPendingTickets(tickets);
  return CATEGORY_ORDER
    .map((key) => ({
      key,
      tickets: sortTickets(
        pending.filter((t) => (t.category || SUPPORT_CATEGORIES.OTHER) === key),
        now,
      ),
    }))
    .filter((group) => group.tickets.length > 0);
}

/**
 * Group pending tickets by priority, in PRIORITY_ORDER, dropping empty groups.
 * @returns {{ key: string, tickets: object[] }[]}
 */
export function groupByPriority(tickets = [], now = new Date()) {
  const pending = filterPendingTickets(tickets);
  return PRIORITY_ORDER
    .map((key) => ({
      key,
      tickets: sortTickets(pending.filter((t) => t.priority === key), now),
    }))
    .filter((group) => group.tickets.length > 0);
}

/** Headline counters for the dashboard. */
export function summarizePending(tickets = [], now = new Date()) {
  const pending = filterPendingTickets(tickets);
  return {
    total: pending.length,
    urgent: pending.filter((t) => t.priority === SUPPORT_PRIORITIES.URGENT).length,
    breached: pending.filter((t) =>
      isSlaBreached({ slaDueAt: t.sla_due_at, status: t.status, firstResponseAt: t.first_response_at, now }),
    ).length,
  };
}
