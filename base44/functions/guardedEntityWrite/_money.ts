// _money.ts — the arithmetic of a school's charges, discounts and payments,
// in ONE place (loose-ends pass, 2026-09-30).
//
// WHY THIS EXISTS. Every rule below used to live in the director's browser:
//   - PagosAdmin wrote `status: 'PAID'` on "Registrar pago" whatever amount
//     was typed, so $400 on a $1,000 charge closed it and the family's Pagos
//     page said "Al día" while $600 was still owed;
//   - the discount was computed client-side with no clamp, so a $500 fixed
//     discount on a $300 charge saved amount = -200;
//   - a Discount of 150 % or -10 % was accepted by the form and the server.
// guardedEntityWrite is the only write path for these entities, so the rules
// live here and the server applies them; the forms only preview them.
//
// Money is handled in integer CENTS. 0.1 + 0.2 !== 0.3 in floating point, and
// "is it fully paid" is an equality question: three payments of $333.33 +
// $333.33 + $333.34 must close a $1,000 charge, exactly.
//
// Import-free, so `node --test` loads it (Node 22 strips the types).
// MIRRORED for the forms in src/lib/payments/money.js —
// tests/unit/payments-money.test.js runs both over the same cases and fails
// if they ever answer differently. Change one, change the other.

export const CHARGE_STATUSES = ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED'];
export const CONCEPT_TYPES = ['INSCRIPCION', 'COLEGIATURA', 'HORARIO_EXTENDIDO', 'EVENTO', 'OTRO'];
export const PAYMENT_METHODS = ['cash', 'transfer', 'card', 'other'];
export const DISCOUNT_TYPES = ['PERCENTAGE', 'FIXED_AMOUNT'];

/** 10 millones de pesos: far above any school charge, low enough to catch a typo'd extra zero run. */
export const MAX_AMOUNT_CENTS = 1_000_000_000;

/** A family is reminded by hand at most once per charge per day. */
export const MANUAL_REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type Cents = { ok: true; cents: number } | { ok: false; code: string };

/**
 * A client-typed amount → integer cents. Rejects non-numbers, Infinity,
 * negatives, more than two decimals ("100.005" is a typo, not a price), and
 * zero unless `allowZero`.
 */
export function parseAmountCents(value: unknown, opts: { allowZero?: boolean } = {}): Cents {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return { ok: false, code: 'INVALID_AMOUNT' };
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  if (!Number.isFinite(n) || n < 0) return { ok: false, code: 'INVALID_AMOUNT' };
  const scaled = n * 100;
  const cents = Math.round(scaled);
  // Absolute tolerance: n * 100 carries at most ~1e-7 of float error below
  // MAX_AMOUNT_CENTS, while a third decimal is off by at least 0.1 cent.
  if (Math.abs(scaled - cents) > 1e-4) return { ok: false, code: 'INVALID_AMOUNT' };
  if (cents === 0 && !opts.allowZero) return { ok: false, code: 'INVALID_AMOUNT' };
  if (cents > MAX_AMOUNT_CENTS) return { ok: false, code: 'INVALID_AMOUNT' };
  return { ok: true, cents };
}

/** A number already stored on a record → cents (lenient: garbage reads as 0). */
export function storedCents(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Cents → the pesos number the entities store (two decimals, exact). */
export function centsToAmount(cents: number): number {
  return Math.round(cents) / 100;
}

/** A real calendar day 'YYYY-MM-DD' ('2026-02-30' is not). */
export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= daysInMonth;
}

/**
 * Today's calendar day in Mexico ('YYYY-MM-DD'). The server runs in UTC: after
 * 18:00 in Aguascalientes `toISOString().slice(0, 10)` is already tomorrow,
 * which would flag a charge due today as overdue.
 */
export function mexicoToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

type DiscountLike = {
  id?: string;
  discount_type?: unknown;
  discount_value?: unknown;
  applicable_to_concepts?: unknown;
  is_active?: unknown;
  valid_from?: unknown;
  valid_until?: unknown;
};

/**
 * What a discount takes off `originalCents`, never more than the charge
 * itself (a $500 discount on a $300 charge makes it free, not -$200) and never
 * less than zero. A percentage above 100 is treated as 100.
 */
export function discountCents(discount: DiscountLike | null | undefined, originalCents: number): number {
  if (!discount || !(originalCents > 0)) return 0;
  const value = Number(discount.discount_value);
  if (!Number.isFinite(value) || value <= 0) return 0;
  let cents = 0;
  if (discount.discount_type === 'PERCENTAGE') cents = Math.round((originalCents * Math.min(value, 100)) / 100);
  else if (discount.discount_type === 'FIXED_AMOUNT') cents = Math.round(value * 100);
  return Math.min(Math.max(cents, 0), originalCents);
}

/**
 * May this discount be applied to a charge of `conceptType` today? Its window
 * is in calendar days, inclusive: a discount "hasta el 30" still applies on
 * the 30th.
 */
export function discountApplies(
  discount: DiscountLike | null | undefined,
  input: { conceptType: string; today: string; allowsDiscounts?: unknown },
): { ok: true } | { ok: false; code: string } {
  const no = { ok: false as const, code: 'DISCOUNT_NOT_APPLICABLE' };
  if (!discount) return no;
  if (input.allowsDiscounts === false) return no;
  if (discount.is_active === false) return no;
  const concepts = Array.isArray(discount.applicable_to_concepts) ? discount.applicable_to_concepts : [];
  if (!concepts.includes(input.conceptType)) return no;
  if (isValidDate(discount.valid_from) && discount.valid_from > input.today) return no;
  if (isValidDate(discount.valid_until) && discount.valid_until < input.today) return no;
  return { ok: true };
}

export type DiscountCheck = { ok: true } | { ok: false; code: string; field: string };

/**
 * A discount a director may save. The form checks the same thing; this is
 * the copy a direct API call cannot skip.
 */
export function validateDiscount(d: DiscountLike): DiscountCheck {
  if (!DISCOUNT_TYPES.includes(String(d.discount_type))) return { ok: false, code: 'INVALID_DISCOUNT', field: 'discount_type' };
  const value = typeof d.discount_value === 'number' ? d.discount_value : Number(d.discount_value);
  if (d.discount_value === null || d.discount_value === undefined || d.discount_value === '' || !Number.isFinite(value) || value <= 0) {
    return { ok: false, code: 'INVALID_DISCOUNT', field: 'discount_value' };
  }
  if (d.discount_type === 'PERCENTAGE' && value > 100) return { ok: false, code: 'INVALID_DISCOUNT', field: 'discount_value' };
  if (d.discount_type === 'FIXED_AMOUNT' && !parseAmountCents(value).ok) return { ok: false, code: 'INVALID_DISCOUNT', field: 'discount_value' };
  const concepts = Array.isArray(d.applicable_to_concepts) ? d.applicable_to_concepts : [];
  if (concepts.length === 0 || !concepts.every((c) => CONCEPT_TYPES.includes(String(c)))) {
    return { ok: false, code: 'INVALID_DISCOUNT', field: 'applicable_to_concepts' };
  }
  const from = d.valid_from;
  const until = d.valid_until;
  if (from !== null && from !== undefined && from !== '' && !isValidDate(from)) return { ok: false, code: 'INVALID_DISCOUNT', field: 'valid_from' };
  if (until !== null && until !== undefined && until !== '' && !isValidDate(until)) return { ok: false, code: 'INVALID_DISCOUNT', field: 'valid_until' };
  if (isValidDate(from) && isValidDate(until) && until < from) return { ok: false, code: 'INVALID_DISCOUNT', field: 'valid_until' };
  return { ok: true };
}

/** original − discount, all in cents. */
export function priceCharge(originalCents: number, discount: DiscountLike | null | undefined): {
  originalCents: number;
  discountCents: number;
  amountCents: number;
} {
  const off = discountCents(discount, originalCents);
  return { originalCents, discountCents: off, amountCents: originalCents - off };
}

/**
 * THE status rule, applied by the server after every payment and every
 * charge edit:
 *   - CANCELLED stays CANCELLED (a director's decision, not arithmetic);
 *   - PAID only when what was paid covers what is owed (amount is already
 *     net of the discount);
 *   - otherwise OVERDUE once the due date is a day before today in Mexico —
 *     a half-paid late charge is still late;
 *   - otherwise PARTIAL when something was paid, PENDING when nothing was.
 */
export function deriveChargeStatus(input: {
  amountCents: number;
  paidCents: number;
  dueDate?: unknown;
  today: string;
  current?: unknown;
}): string {
  if (input.current === 'CANCELLED') return 'CANCELLED';
  const owed = Math.max(0, Math.round(input.amountCents));
  const paid = Math.max(0, Math.round(input.paidCents));
  if (paid >= owed) return 'PAID';
  if (isValidDate(input.dueDate) && input.dueDate < input.today) return 'OVERDUE';
  return paid > 0 ? 'PARTIAL' : 'PENDING';
}

/** What is still owed on a stored charge, in cents (0 once PAID or CANCELLED). */
export function chargeBalanceCents(charge: { amount?: unknown; amount_paid?: unknown; status?: unknown } | null | undefined): number {
  if (!charge) return 0;
  // A charge closed by the pre-2026-09-30 flow has no amount_paid: PAID and
  // CANCELLED mean nothing is owed, whatever the arithmetic would say.
  if (charge.status === 'PAID' || charge.status === 'CANCELLED') return 0;
  return Math.max(0, storedCents(charge.amount) - storedCents(charge.amount_paid));
}

export function sumPaymentsCents(payments: Array<{ amount?: unknown }> = []): number {
  return (payments || []).reduce((sum, p) => sum + Math.max(0, storedCents(p?.amount)), 0);
}

/**
 * May a payment of `amountCents` be recorded against this charge, given what
 * its PaymentRecords already add up to? Overpaying is refused rather than
 * silently kept: nothing tracks a credit, so the extra would simply vanish.
 */
export function checkPayment(input: {
  charge: { amount?: unknown; status?: unknown };
  paidCents: number;
  amountCents: number;
}): { ok: true; balanceCents: number } | { ok: false; code: string; balanceCents: number } {
  const { charge } = input;
  const owed = Math.max(0, storedCents(charge.amount));
  const balance = Math.max(0, owed - Math.max(0, input.paidCents));
  if (charge.status === 'CANCELLED') return { ok: false, code: 'CHARGE_CANCELLED', balanceCents: 0 };
  if (charge.status === 'PAID' || balance === 0) return { ok: false, code: 'CHARGE_ALREADY_PAID', balanceCents: 0 };
  if (!(input.amountCents > 0)) return { ok: false, code: 'INVALID_AMOUNT', balanceCents: balance };
  if (input.amountCents > balance) return { ok: false, code: 'OVERPAYMENT', balanceCents: balance };
  return { ok: true, balanceCents: balance };
}

/** Still owed and not cancelled — the charges a family can be reminded about. */
export function isChargeOpen(charge: { status?: unknown; amount?: unknown; amount_paid?: unknown } | null | undefined): boolean {
  if (!charge) return false;
  if (!['PENDING', 'PARTIAL', 'OVERDUE'].includes(String(charge.status))) return false;
  return chargeBalanceCents(charge) > 0;
}

/**
 * When the next manual reminder for this charge may go out (ms epoch), or 0
 * when it may go out now.
 */
export function manualReminderAvailableAt(charge: { last_reminder_at?: unknown } | null | undefined, now: Date = new Date()): number {
  const last = Date.parse(String(charge?.last_reminder_at || ''));
  if (Number.isNaN(last)) return 0;
  const next = last + MANUAL_REMINDER_COOLDOWN_MS;
  return next > now.getTime() ? next : 0;
}
