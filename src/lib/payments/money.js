// Money arithmetic for the payment screens — the CLIENT MIRROR of
// base44/functions/guardedEntityWrite/_money.ts (Deno functions cannot be
// imported from src/, and src/ cannot import them either).
//
// The server is the one that decides: it prices a charge (discount clamped to
// the charge), refuses a payment larger than the balance, and derives a
// charge's status from its PaymentRecords. This copy only lets the forms show
// the same numbers BEFORE the director presses the button, and name the
// field that is wrong instead of a generic error.
// tests/unit/payments-money.test.js runs both copies over the same cases and
// fails if they ever disagree. Change one, change the other.
//
// Everything is integer CENTS internally: "is it fully paid" is an equality
// question, and 333.33 + 333.33 + 333.34 must equal 1000 exactly.
//
// Import-free so `node --test` loads it.

export const CHARGE_STATUSES = ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED'];
export const CONCEPT_TYPES = ['INSCRIPCION', 'COLEGIATURA', 'HORARIO_EXTENDIDO', 'EVENTO', 'OTRO'];
export const PAYMENT_METHODS = ['cash', 'transfer', 'card', 'other'];
export const DISCOUNT_TYPES = ['PERCENTAGE', 'FIXED_AMOUNT'];
export const MAX_AMOUNT_CENTS = 1_000_000_000;
export const MANUAL_REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Spanish labels for the concept types (form selects, discount chips). */
export const CONCEPT_TYPE_LABELS = Object.freeze({
  INSCRIPCION: 'Inscripción',
  COLEGIATURA: 'Colegiatura',
  HORARIO_EXTENDIDO: 'Horario extendido',
  EVENTO: 'Evento',
  OTRO: 'Otro',
});

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseAmountCents(value, opts = {}) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return { ok: false, code: 'INVALID_AMOUNT' };
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  if (!Number.isFinite(n) || n < 0) return { ok: false, code: 'INVALID_AMOUNT' };
  const scaled = n * 100;
  const cents = Math.round(scaled);
  if (Math.abs(scaled - cents) > 1e-4) return { ok: false, code: 'INVALID_AMOUNT' };
  if (cents === 0 && !opts.allowZero) return { ok: false, code: 'INVALID_AMOUNT' };
  if (cents > MAX_AMOUNT_CENTS) return { ok: false, code: 'INVALID_AMOUNT' };
  return { ok: true, cents };
}

export function storedCents(value) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function centsToAmount(cents) {
  return Math.round(cents) / 100;
}

export function isValidDate(value) {
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

export function discountCents(discount, originalCents) {
  if (!discount || !(originalCents > 0)) return 0;
  const value = Number(discount.discount_value);
  if (!Number.isFinite(value) || value <= 0) return 0;
  let cents = 0;
  if (discount.discount_type === 'PERCENTAGE') cents = Math.round((originalCents * Math.min(value, 100)) / 100);
  else if (discount.discount_type === 'FIXED_AMOUNT') cents = Math.round(value * 100);
  return Math.min(Math.max(cents, 0), originalCents);
}

export function discountApplies(discount, { conceptType, today, allowsDiscounts } = {}) {
  const no = { ok: false, code: 'DISCOUNT_NOT_APPLICABLE' };
  if (!discount) return no;
  if (allowsDiscounts === false) return no;
  if (discount.is_active === false) return no;
  const concepts = Array.isArray(discount.applicable_to_concepts) ? discount.applicable_to_concepts : [];
  if (!concepts.includes(conceptType)) return no;
  if (isValidDate(discount.valid_from) && discount.valid_from > today) return no;
  if (isValidDate(discount.valid_until) && discount.valid_until < today) return no;
  return { ok: true };
}

export function validateDiscount(d) {
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

/** Spanish message for each field validateDiscount can name. */
export const DISCOUNT_FIELD_ERRORS = Object.freeze({
  discount_type: 'Elige si el descuento es porcentaje o monto fijo.',
  discount_value: 'El valor debe ser mayor que 0; un porcentaje, como máximo 100, y un monto fijo, con dos decimales como máximo.',
  applicable_to_concepts: 'Elige al menos un tipo de concepto al que aplique el descuento.',
  valid_from: '"Válido desde" no es una fecha válida.',
  valid_until: '"Válido hasta" debe ser igual o posterior a "Válido desde".',
});

export function priceCharge(originalCents, discount) {
  const off = discountCents(discount, originalCents);
  return { originalCents, discountCents: off, amountCents: originalCents - off };
}

export function deriveChargeStatus({ amountCents, paidCents, dueDate, today, current }) {
  if (current === 'CANCELLED') return 'CANCELLED';
  const owed = Math.max(0, Math.round(amountCents));
  const paid = Math.max(0, Math.round(paidCents));
  if (paid >= owed) return 'PAID';
  if (isValidDate(dueDate) && dueDate < today) return 'OVERDUE';
  return paid > 0 ? 'PARTIAL' : 'PENDING';
}

export function chargeBalanceCents(charge) {
  if (!charge) return 0;
  if (charge.status === 'PAID' || charge.status === 'CANCELLED') return 0;
  return Math.max(0, storedCents(charge.amount) - storedCents(charge.amount_paid));
}

export function sumPaymentsCents(payments = []) {
  return (payments || []).reduce((sum, p) => sum + Math.max(0, storedCents(p?.amount)), 0);
}

export function checkPayment({ charge, paidCents, amountCents }) {
  const owed = Math.max(0, storedCents(charge.amount));
  const balance = Math.max(0, owed - Math.max(0, paidCents));
  if (charge.status === 'CANCELLED') return { ok: false, code: 'CHARGE_CANCELLED', balanceCents: 0 };
  if (charge.status === 'PAID' || balance === 0) return { ok: false, code: 'CHARGE_ALREADY_PAID', balanceCents: 0 };
  if (!(amountCents > 0)) return { ok: false, code: 'INVALID_AMOUNT', balanceCents: balance };
  if (amountCents > balance) return { ok: false, code: 'OVERPAYMENT', balanceCents: balance };
  return { ok: true, balanceCents: balance };
}

export function isChargeOpen(charge) {
  if (!charge) return false;
  if (!['PENDING', 'PARTIAL', 'OVERDUE'].includes(String(charge.status))) return false;
  return chargeBalanceCents(charge) > 0;
}

export function manualReminderAvailableAt(charge, now = new Date()) {
  const last = Date.parse(String(charge?.last_reminder_at || ''));
  if (Number.isNaN(last)) return 0;
  const next = last + MANUAL_REMINDER_COOLDOWN_MS;
  return next > now.getTime() ? next : 0;
}

// --- Display helpers (client only) -------------------------------------------

/** What a stored charge still owes, in pesos. */
export function chargeBalance(charge) {
  return centsToAmount(chargeBalanceCents(charge));
}

/** What has been paid on a stored charge, in pesos (a PAID legacy row counts as fully paid). */
export function chargePaid(charge) {
  if (!charge) return 0;
  if (charge.status === 'PAID') return centsToAmount(Math.max(storedCents(charge.amount), storedCents(charge.amount_paid)));
  return centsToAmount(storedCents(charge.amount_paid));
}

/** "$1,250.00" — pesos with two decimals, the way every money figure is shown. */
export function formatMoney(amount) {
  const n = Number(amount);
  const safe = Number.isFinite(n) ? n : 0;
  return `$${safe.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
