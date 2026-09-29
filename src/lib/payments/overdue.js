// One definition of "vencido" for every screen that counts charges.
//
// Why this exists: the admin home counted only `status: 'PENDING'` charges with
// a past due date, while PagosAdmin counted only `status: 'OVERDUE'`. A charge
// that PagosAdmin had already flipped to OVERDUE therefore showed as
// "Pagos vencidos 0" on the home and "Vencidos 1" on Pagos — the director saw
// two contradictory money numbers. Both screens now ask this module.
//
// A charge is overdue when:
//   - its stored status is OVERDUE, or
//   - it is still PENDING and its due date is a calendar day before today.
// The second branch matters because the OVERDUE flip is a best-effort write
// (it fails in a read-only license, or when nobody has opened Pagos yet), and
// the count must not depend on that write having happened.
//
// Due dates are date-only ('YYYY-MM-DD'), so they go through parseLocalDate /
// isBeforeToday: a charge due today is NOT overdue, even after 18:00 in Mexico
// (native `new Date('YYYY-MM-DD')` is UTC midnight and flagged it a day early).
//
// Import-free except for the sibling date helper, so `node --test` loads it.

import { isBeforeToday, parseLocalDate, startOfLocalDay } from '../dates.js';

export const CHARGE_STATUS = Object.freeze({
  PENDING: 'PENDING',
  OVERDUE: 'OVERDUE',
  PAID: 'PAID',
});

// Statuses that can still be (or become) overdue — the filter a caller needs
// when it only fetches unpaid charges.
export const UNPAID_CHARGE_STATUSES = Object.freeze([CHARGE_STATUS.PENDING, CHARGE_STATUS.OVERDUE]);

export function isChargeOverdue(charge, now = new Date()) {
  if (!charge) return false;
  if (charge.status === CHARGE_STATUS.OVERDUE) return true;
  if (charge.status !== CHARGE_STATUS.PENDING) return false;
  return isBeforeToday(charge.due_date, now);
}

export function selectOverdueCharges(charges = [], now = new Date()) {
  return (charges || []).filter((charge) => isChargeOverdue(charge, now));
}

/**
 * PENDING charges whose due date has passed but whose stored status was never
 * flipped. PagosAdmin persists OVERDUE for these; the display does not wait
 * for that write.
 */
export function selectChargesToMarkOverdue(charges = [], now = new Date()) {
  return (charges || []).filter(
    (charge) => charge?.status === CHARGE_STATUS.PENDING && isBeforeToday(charge.due_date, now),
  );
}

/**
 * Split charges into the three tabs of PagosAdmin. Every charge lands in at
 * most one bucket, and "overdue" uses the same rule as the admin home count.
 */
export function partitionCharges(charges = [], now = new Date()) {
  const pending = [];
  const overdue = [];
  const paid = [];
  for (const charge of charges || []) {
    if (!charge) continue;
    if (charge.status === CHARGE_STATUS.PAID) paid.push(charge);
    else if (isChargeOverdue(charge, now)) overdue.push(charge);
    else if (charge.status === CHARGE_STATUS.PENDING) pending.push(charge);
  }
  return { pending, overdue, paid };
}

/** Whole calendar days from today to the due date (negative once past). */
export function calendarDaysUntilDue(dueDate, now = new Date()) {
  const due = parseLocalDate(dueDate);
  const today = startOfLocalDay(now);
  if (!due || !today) return null;
  const dueDay = startOfLocalDay(due);
  // Round, not floor: the two midnights can be 23h or 25h apart across a DST
  // change in zones that still have one.
  return Math.round((dueDay.getTime() - today.getTime()) / 86400000);
}

export const PAYMENT_REMINDER_LEAD_DAYS = 7;

/**
 * A pending charge gets its one reminder once it is within the lead window
 * (due in 0..7 days) and has not been reminded yet. The window — rather than
 * "exactly 7 days before" — is deliberate: the reminder is sent from the
 * admin's browser, so if nobody opens Pagos on that exact day an exact-match
 * rule would silently skip the reminder forever.
 */
export function isPaymentReminderDue(charge, now = new Date(), leadDays = PAYMENT_REMINDER_LEAD_DAYS) {
  if (!charge || charge.status !== CHARGE_STATUS.PENDING || charge.reminder_sent) return false;
  const days = calendarDaysUntilDue(charge.due_date, now);
  if (days == null) return false;
  return days >= 0 && days <= leadDays;
}
