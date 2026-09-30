// _payments.ts — what guardedEntityWrite does with the money of a write to
// ChargeItem, PaymentRecord or PaymentConcept, AFTER entry.ts has decided who
// may write (role, PermissionOverride, license, school). Loose-ends pass,
// 2026-09-30; the arithmetic itself is ./_money.ts.
//
// The rules, in one place:
//   - A charge's price is computed HERE: original amount, the discount (the
//     client only names which one; the server checks it is active, in its
//     window and for this concept type, and clamps it), and amount = the net.
//     concept_type comes from the stored PaymentConcept, not the form.
//   - A charge's status and amount_paid are never taken from a client. They
//     are re-derived from the charge's PaymentRecords and its due date
//     (settleCharge) after every payment, every deleted payment and every
//     charge edit. A client patch of `{ status: 'OVERDUE' }` (PagosAdmin's
//     overdue sync) is therefore just "refresh it"; the only status a
//     director may SET is CANCELLED.
//   - A payment must be positive, in whole cents, not larger than what is
//     still owed, and against a charge of the same school that is neither
//     paid nor cancelled. Its student is the charge's student. Once saved its
//     amount, charge and date do not change: delete it and record it again.
//
// Duck-typed on `sr.entities[Name]` and importing only ./_money.ts, so
// tests/unit/payments-money.test.js runs it against the in-memory database.
import {
  CONCEPT_TYPES,
  PAYMENT_METHODS,
  centsToAmount,
  checkPayment,
  deriveChargeStatus,
  discountApplies,
  isValidDate,
  mexicoToday,
  parseAmountCents,
  priceCharge,
  storedCents,
  sumPaymentsCents,
} from './_money.ts';

// deno-lint-ignore no-explicit-any
type Db = any;
type Rec = Record<string, unknown>;
export type PaymentPrep = { ok: true; data: Rec } | { ok: false; status: number; code: string; message: string };

export const PAYMENT_ENTITIES = ['ChargeItem', 'PaymentRecord', 'PaymentConcept'];

// Fields of a charge that fix its price. After create they are read-only:
// changing what a family owes on a charge that may already carry payments is
// cancel-and-recreate, never an edit.
const CHARGE_LOCKED_FIELDS = ['amount', 'original_amount', 'discount_amount', 'discount_id', 'concept_id', 'concept_type', 'event_id', 'student_id'];
const PAYMENT_LOCKED_FIELDS = ['amount', 'charge_id', 'payment_date', 'student_id'];
const MAX_TEXT = 500;
const MAX_PAYMENTS_PER_CHARGE = 1000;

function fail(status: number, code: string, message: string): PaymentPrep {
  return { ok: false, status, code, message };
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, MAX_TEXT) : '';
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') return storedCents(a) === storedCents(b) && a !== '' && b !== '';
  return String(a ?? '') === String(b ?? '');
}

async function sameSchoolRecord(sr: Db, entity: string, id: unknown, schoolId: string): Promise<Rec | null> {
  if (typeof id !== 'string' || !id) return null;
  const record: Rec | null = await sr.entities[entity].get(id).catch(() => null);
  return record && String(record.school_id || '') === schoolId ? record : null;
}

async function paymentsFor(sr: Db, chargeId: string, schoolId: string): Promise<Rec[]> {
  const rows: Rec[] = await sr.entities.PaymentRecord.filter({ school_id: schoolId, charge_id: chargeId }, '-created_date', MAX_PAYMENTS_PER_CHARGE);
  return (rows || []).filter((p) => String(p.charge_id || '') === chargeId && String(p.school_id || '') === schoolId);
}

/** The server-built record of a new charge. `data` is the client's (or the event carve-out's) input. */
export async function prepareChargeCreate(sr: Db, data: Rec, schoolId: string, now: Date): Promise<PaymentPrep> {
  const today = mexicoToday(now);
  if (!isValidDate(data.due_date)) return fail(400, 'INVALID_DUE_DATE', 'due_date must be a calendar date');
  const original = parseAmountCents(data.original_amount ?? data.amount);
  if (!original.ok) return fail(400, 'INVALID_AMOUNT', 'amount must be a positive amount in whole cents');

  let conceptType = CONCEPT_TYPES.includes(String(data.concept_type)) ? String(data.concept_type) : 'OTRO';
  let conceptName = text(data.concept_name);
  let concept: Rec | null = null;
  if (typeof data.concept_id === 'string' && data.concept_id) {
    concept = await sameSchoolRecord(sr, 'PaymentConcept', data.concept_id, schoolId);
    if (!concept) return fail(400, 'REFERENCE_NOT_IN_SCHOOL', 'concept_id does not belong to this school');
    conceptType = CONCEPT_TYPES.includes(String(concept.concept_type)) ? String(concept.concept_type) : 'OTRO';
    conceptName = conceptName || text(concept.name);
  }
  if (!conceptName) return fail(400, 'MISSING_FIELDS', 'concept_name is required');

  let discount: Rec | null = null;
  if (typeof data.discount_id === 'string' && data.discount_id) {
    discount = await sameSchoolRecord(sr, 'Discount', data.discount_id, schoolId);
    if (!discount) return fail(400, 'REFERENCE_NOT_IN_SCHOOL', 'discount_id does not belong to this school');
    const applies = discountApplies(discount, { conceptType, today, allowsDiscounts: concept?.allows_discounts });
    if (!applies.ok) return fail(400, applies.code, 'That discount does not apply to this charge today');
  }

  const price = priceCharge(original.cents, discount);
  const record: Rec = {
    student_id: data.student_id,
    concept_id: concept ? String(concept.id) : null,
    concept_name: conceptName,
    concept_type: conceptType,
    original_amount: centsToAmount(price.originalCents),
    discount_id: discount ? String(discount.id) : null,
    discount_amount: centsToAmount(price.discountCents),
    amount: centsToAmount(price.amountCents),
    amount_paid: 0,
    due_date: data.due_date,
    status: deriveChargeStatus({ amountCents: price.amountCents, paidCents: 0, dueDate: data.due_date, today }),
    reminder_sent: false,
  };
  if (typeof data.event_id === 'string' && data.event_id) record.event_id = data.event_id;
  const notes = text(data.notes);
  if (notes) record.notes = notes;
  return { ok: true, data: record };
}

/**
 * The patch to write for a charge edit: the few fields a director may change,
 * plus the re-derived status and amount_paid.
 */
export async function prepareChargeUpdate(sr: Db, existing: Rec, patch: Rec, schoolId: string, now: Date): Promise<PaymentPrep> {
  for (const field of CHARGE_LOCKED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field) && !sameValue(patch[field], existing[field])) {
      return fail(400, 'AMOUNT_LOCKED', `${field} cannot change once a charge exists; cancel it and create a new one`);
    }
  }
  const out: Rec = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'due_date')) {
    if (!isValidDate(patch.due_date)) return fail(400, 'INVALID_DUE_DATE', 'due_date must be a calendar date');
    out.due_date = patch.due_date;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'notes')) out.notes = text(patch.notes);
  if (Object.prototype.hasOwnProperty.call(patch, 'concept_name')) {
    const name = text(patch.concept_name);
    if (!name) return fail(400, 'MISSING_FIELDS', 'concept_name is required');
    out.concept_name = name;
  }
  const payments = await paymentsFor(sr, String(existing.id), schoolId);
  const paidCents = sumPaymentsCents(payments);
  out.status = deriveChargeStatus({
    amountCents: storedCents(existing.amount),
    paidCents,
    dueDate: out.due_date ?? existing.due_date,
    today: mexicoToday(now),
    current: patch.status === 'CANCELLED' ? 'CANCELLED' : existing.status,
  });
  out.amount_paid = centsToAmount(paidCents);
  return { ok: true, data: out };
}

/** The server-built record of a new payment. */
export async function preparePaymentCreate(sr: Db, data: Rec, schoolId: string, now: Date): Promise<PaymentPrep> {
  if (typeof data.charge_id !== 'string' || !data.charge_id) return fail(400, 'MISSING_CHARGE', 'charge_id is required');
  const charge = await sameSchoolRecord(sr, 'ChargeItem', data.charge_id, schoolId);
  if (!charge) return fail(400, 'REFERENCE_NOT_IN_SCHOOL', 'charge_id does not belong to this school');
  const amount = parseAmountCents(data.amount);
  if (!amount.ok) return fail(400, 'INVALID_AMOUNT', 'amount must be a positive amount in whole cents');

  const paidCents = sumPaymentsCents(await paymentsFor(sr, String(charge.id), schoolId));
  const check = checkPayment({ charge, paidCents, amountCents: amount.cents });
  if (!check.ok) {
    const status = check.code === 'OVERPAYMENT' || check.code === 'INVALID_AMOUNT' ? 400 : 409;
    return fail(status, check.code, `${check.code}: balance is ${centsToAmount(check.balanceCents).toFixed(2)}`);
  }

  const today = mexicoToday(now);
  const paymentDate = data.payment_date === undefined || data.payment_date === null || data.payment_date === '' ? today : data.payment_date;
  if (!isValidDate(paymentDate) || paymentDate > today) return fail(400, 'INVALID_PAYMENT_DATE', 'payment_date must be a calendar date, not in the future');
  const method = data.payment_method === undefined || data.payment_method === null || data.payment_method === '' ? 'cash' : String(data.payment_method);
  if (!PAYMENT_METHODS.includes(method)) return fail(400, 'INVALID_FIELD', 'payment_method is not valid');

  const record: Rec = {
    charge_id: String(charge.id),
    // The charge's student, never the client's: a payment cannot land on one
    // child's charge while naming another.
    student_id: charge.student_id,
    amount: centsToAmount(amount.cents),
    payment_date: paymentDate,
    payment_method: method,
  };
  const reference = text(data.reference);
  if (reference) record.reference = reference;
  const notes = text(data.notes);
  if (notes) record.notes = notes;
  return { ok: true, data: record };
}

/** A payment edit may only touch how it was paid and its notes. */
export function preparePaymentUpdate(existing: Rec, patch: Rec): PaymentPrep {
  for (const field of PAYMENT_LOCKED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field) && !sameValue(patch[field], existing[field])) {
      return fail(400, 'PAYMENT_LOCKED', `${field} cannot change once a payment is recorded; delete it and record it again`);
    }
  }
  const out: Rec = {};
  if (Object.prototype.hasOwnProperty.call(patch, 'payment_method')) {
    if (!PAYMENT_METHODS.includes(String(patch.payment_method))) return fail(400, 'INVALID_FIELD', 'payment_method is not valid');
    out.payment_method = patch.payment_method;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'reference')) out.reference = text(patch.reference);
  if (Object.prototype.hasOwnProperty.call(patch, 'notes')) out.notes = text(patch.notes);
  if (Object.keys(out).length === 0) return fail(400, 'EMPTY_PATCH', 'Nothing to update');
  return { ok: true, data: out };
}

/** A payment concept's price and type, checked the same way a charge's are. */
export function prepareConceptWrite(operation: string, data: Rec): PaymentPrep {
  const out: Rec = { ...data };
  if (operation === 'create' || Object.prototype.hasOwnProperty.call(data, 'name')) {
    const name = text(data.name);
    if (!name) return fail(400, 'MISSING_FIELDS', 'name is required');
    out.name = name;
  }
  if (operation === 'create' || Object.prototype.hasOwnProperty.call(data, 'default_amount')) {
    const amount = parseAmountCents(data.default_amount, { allowZero: true });
    if (!amount.ok) return fail(400, 'INVALID_AMOUNT', 'default_amount must be an amount in whole cents');
    out.default_amount = centsToAmount(amount.cents);
  }
  if (operation === 'create' || Object.prototype.hasOwnProperty.call(data, 'concept_type')) {
    const type = data.concept_type === undefined || data.concept_type === null || data.concept_type === '' ? 'OTRO' : String(data.concept_type);
    if (!CONCEPT_TYPES.includes(type)) return fail(400, 'INVALID_FIELD', 'concept_type is not valid');
    out.concept_type = type;
  }
  return { ok: true, data: out };
}

/**
 * A charge that already carries payments is not deleted: its PaymentRecords
 * would point at nothing and the money would drop out of every total.
 * Cancel it instead (status CANCELLED keeps the history).
 */
export async function chargeDeleteProblem(sr: Db, existing: Rec, schoolId: string): Promise<PaymentPrep | null> {
  const payments = await paymentsFor(sr, String(existing.id), schoolId);
  return payments.length > 0
    ? fail(409, 'CHARGE_HAS_PAYMENTS', 'This charge has payments; cancel it instead of deleting it')
    : null;
}

// --- two payments at once (Codex review on PR #190, 2026-09-30) -------------
//
// preparePaymentCreate checks the balance BEFORE the insert, and Base44 has no
// transactions and no conditional writes: two "Registrar pago" of $600 on a
// $1,000 charge, sent at the same moment, both read "balance 1000", both pass,
// both insert — $1,200 recorded on a $1,000 charge. The fix is compensating:
// insert, then re-read every payment of the charge and decide, in ONE order
// every request agrees on, which records fit.
//
//   - Order: created_date ascending, then id ascending. Both requests sort the
//     same set the same way, so they agree on who was first.
//   - Greedy: walk that order adding each payment to a running total of the
//     KEPT ones; a payment that would push the total past the charge's net
//     amount (`amount`, already net of the discount, in cents) is an overflow
//     and is not added. A record's fate therefore depends only on the records
//     BEFORE it, so the earlier of two colliding payments is kept whatever the
//     later one sees — two overflowing inserts cannot both be deleted, and the
//     first is never the one thrown away.
//   - Each request deletes ONLY its own record, and only when it is an
//     overflow; it never touches another request's row.
//
// What remains (documented, not solved — solving it needs a compare-and-set
// Base44 does not have): the order is only as good as created_date. Two
// inserts stamped in the same millisecond are ordered by id; if the ids are
// not monotonic AND each request's re-read missed the other's row (replica
// lag), both can be kept. Every other interleaving keeps exactly one.

export type PaymentRace =
  | { ok: true; overflowIds: string[] }
  | { ok: false; status: number; code: string; message: string };

/** created_date ascending, then id ascending — the one order every request uses. */
export function orderPayments(payments: Rec[]): Rec[] {
  return [...(payments || [])].sort((a, b) => {
    const ad = String(a.created_date ?? '');
    const bd = String(b.created_date ?? '');
    if (ad !== bd) return ad < bd ? -1 : 1;
    const ai = String(a.id ?? '');
    const bi = String(b.id ?? '');
    return ai === bi ? 0 : ai < bi ? -1 : 1;
  });
}

/** Which payments fit in `netCents`, walking orderPayments' order (see above). */
export function classifyPayments(payments: Rec[], netCents: number): { kept: Rec[]; overflow: Rec[] } {
  const kept: Rec[] = [];
  const overflow: Rec[] = [];
  let total = 0;
  for (const p of orderPayments(payments)) {
    const cents = Math.max(0, storedCents(p.amount));
    if (total + cents > netCents) {
      overflow.push(p);
    } else {
      total += cents;
      kept.push(p);
    }
  }
  return { kept, overflow };
}

/**
 * Called right after a PaymentRecord insert, BEFORE the charge is settled.
 * If the new record is an overflow it is deleted and a 409 comes back; the
 * director sees "otro pago se registró al mismo tiempo" and the real balance.
 */
export async function resolvePaymentRace(sr: Db, created: Rec, schoolId: string): Promise<PaymentRace> {
  const createdId = String(created?.id || '');
  const chargeId = String(created?.charge_id || '');
  const charge = await sameSchoolRecord(sr, 'ChargeItem', chargeId, schoolId);
  if (!createdId || !charge) return { ok: true, overflowIds: [] };
  const payments = await paymentsFor(sr, chargeId, schoolId);
  // The insert may not be visible to the re-read yet; it is certainly in the
  // set, so add it (its created_date comes from the create response).
  if (!payments.some((p) => String(p.id) === createdId)) payments.push(created);
  const { overflow } = classifyPayments(payments, Math.max(0, storedCents(charge.amount)));
  const overflowIds = overflow.map((p) => String(p.id));
  if (!overflowIds.includes(createdId)) return { ok: true, overflowIds };

  try {
    await sr.entities.PaymentRecord.delete(createdId);
  } catch (e) {
    console.error('guardedEntityWrite: overflowing payment could not be removed', createdId, (e as Error)?.message);
    return {
      ok: false,
      status: 500,
      code: 'PAYMENT_CONFLICT_UNRESOLVED',
      message: `payment ${createdId} overpays charge ${chargeId} and could not be removed; delete it by hand`,
    };
  }
  return {
    ok: false,
    status: 409,
    code: 'PAYMENT_CONFLICT',
    message: 'Otro pago se registró al mismo tiempo; revisa el saldo y vuelve a intentar.',
  };
}

/**
 * Re-derive a charge's amount_paid, status and last_payment_date from its
 * PaymentRecords and write them. Called after a payment is recorded or
 * deleted. Returns the updated charge (null when it is gone or foreign).
 *
 * `keptOnly` (the payment-create path): count only the payments
 * classifyPayments keeps, so a concurrent overflow that its own request has
 * not deleted yet never shows up as money received. Not used elsewhere: a
 * charge overpaid before 2026-09-30 must keep reading as paid.
 */
export async function settleCharge(
  sr: Db, chargeId: unknown, schoolId: string, now: Date, opts: { keptOnly?: boolean } = {},
): Promise<Rec | null> {
  const charge = await sameSchoolRecord(sr, 'ChargeItem', chargeId, schoolId);
  if (!charge) return null;
  const all = await paymentsFor(sr, String(charge.id), schoolId);
  const payments = opts.keptOnly ? classifyPayments(all, Math.max(0, storedCents(charge.amount))).kept : all;
  const paidCents = sumPaymentsCents(payments);
  const lastPayment = payments
    .map((p) => String(p.payment_date || ''))
    .filter((d) => isValidDate(d))
    .sort()
    .pop() || null;
  const patch: Rec = {
    amount_paid: centsToAmount(paidCents),
    last_payment_date: lastPayment,
    status: deriveChargeStatus({
      amountCents: storedCents(charge.amount),
      paidCents,
      dueDate: charge.due_date,
      today: mexicoToday(now),
      current: charge.status,
    }),
  };
  return await sr.entities.ChargeItem.update(String(charge.id), patch);
}
