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
//   - it is still PENDING or PARTIAL (partly paid) and its due date is a
//     calendar day before today — a half-paid late charge is still late.
// The second branch matters because the OVERDUE flip is a best-effort write
// (it fails in a read-only license, or when nobody has opened Pagos yet), and
// the count must not depend on that write having happened.
//
// Due dates are date-only ('YYYY-MM-DD'), so they go through parseLocalDate /
// isBeforeToday: a charge due today is NOT overdue, even after 18:00 in Mexico
// (native `new Date('YYYY-MM-DD')` is UTC midnight and flagged it a day early).
//
// Import-free except for the sibling date and money helpers, so `node --test`
// loads it.

import { isBeforeToday, parseLocalDate, schoolTodayDate, startOfLocalDay } from '../dates.js';
import { centsToAmount, chargeBalanceCents } from './money.js';

export const CHARGE_STATUS = Object.freeze({
  PENDING: 'PENDING',
  // Something paid, not all of it (loose-ends pass, 2026-09-30). Before it a
  // $400 payment on a $1,000 charge marked the whole charge PAID. The server
  // (guardedEntityWrite) derives it from the PaymentRecords; see
  // src/lib/payments/money.js.
  PARTIAL: 'PARTIAL',
  OVERDUE: 'OVERDUE',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
});

// Statuses that still owe money and can still be (or become) overdue — the
// filter a caller needs when it only fetches unpaid charges. Reportes used to
// fetch PENDING alone, so every charge PagosAdmin had flipped to OVERDUE fell
// out of "Pagos pendientes" and its "vencidos" count.
export const UNPAID_CHARGE_STATUSES = Object.freeze([CHARGE_STATUS.PENDING, CHARGE_STATUS.PARTIAL, CHARGE_STATUS.OVERDUE]);

const NOT_YET_OVERDUE = [CHARGE_STATUS.PENDING, CHARGE_STATUS.PARTIAL];

export function isChargeOverdue(charge, now = new Date()) {
  if (!charge) return false;
  if (charge.status === CHARGE_STATUS.OVERDUE) return true;
  if (!NOT_YET_OVERDUE.includes(charge.status)) return false;
  return isBeforeToday(charge.due_date, now);
}

export function selectOverdueCharges(charges = [], now = new Date()) {
  return (charges || []).filter((charge) => isChargeOverdue(charge, now));
}

/**
 * PENDING / PARTIAL charges whose due date has passed but whose stored status
 * was never flipped. PagosAdmin asks the server to refresh these (it derives
 * OVERDUE itself); the display does not wait for that write.
 */
export function selectChargesToMarkOverdue(charges = [], now = new Date()) {
  return (charges || []).filter(
    (charge) => NOT_YET_OVERDUE.includes(charge?.status) && isBeforeToday(charge.due_date, now),
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
    else if (NOT_YET_OVERDUE.includes(charge.status)) pending.push(charge);
  }
  return { pending, overdue, paid };
}

/**
 * The money half of "Pagos pendientes" (Reportes, admin home): how many unpaid
 * charges, how many of them late, and what is still OWED — the balance after
 * partial payments, not each charge's full amount.
 */
export function summarizeUnpaidCharges(charges = [], now = new Date()) {
  const { pending, overdue } = partitionCharges(charges, now);
  const owed = (list) => centsToAmount(list.reduce((sum, charge) => sum + chargeBalanceCents(charge), 0));
  return {
    count: pending.length + overdue.length,
    overdueCount: overdue.length,
    upcomingCount: pending.length,
    total: owed([...pending, ...overdue]),
    overdueTotal: owed(overdue),
  };
}

/** Whole calendar days from today to the due date (negative once past). */
export function calendarDaysUntilDue(dueDate, now = new Date()) {
  const due = parseLocalDate(dueDate);
  // The school's day, like isBeforeToday above: with the device's day a
  // browser off Mexico time counted a charge as due "in -1 days" (reminder
  // window, labels) while isChargeOverdue still called it due today.
  const today = schoolTodayDate(now);
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
  if (!charge || !NOT_YET_OVERDUE.includes(charge.status) || charge.reminder_sent) return false;
  const days = calendarDaysUntilDue(charge.due_date, now);
  if (days == null) return false;
  return days >= 0 && days <= leadDays;
}
