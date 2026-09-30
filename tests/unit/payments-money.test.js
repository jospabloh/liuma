// Money: charges, discounts, partial payments and reminders (loose-ends pass,
// 2026-09-30). What these pin, and why:
//
//   - "Registrar pago" with $400 on a $1,000 charge marked the WHOLE charge
//     PAID (PagosAdmin wrote status:'PAID' unconditionally, before the payment
//     even existed). The family's Pagos page then said "Al día" with $600
//     still owed. Now the server re-derives the status from the payments:
//     PAID only when they cover the charge, PARTIAL otherwise, OVERDUE when
//     the due date (Mexico calendar day) has passed and it is not fully paid.
//   - A $500 fixed discount on a $300 charge was saved as amount -200, and a
//     150 % or -10 % Discount was accepted by the form and by the server.
//   - Reportes read PENDING only, so every charge PagosAdmin had flipped to
//     OVERDUE vanished from "Pagos pendientes" and from "N vencidos".
//   - An overdue charge was never reminded, and there was no manual reminder.
//
// The server rules run for real here: _money.ts (pure) and _payments.ts
// (against the in-memory database), not grepped.
process.env.TZ = 'America/Mexico_City';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeFakeDb } from '../fixtures/fake-entity-db.js';
import * as server from '../../base44/functions/guardedEntityWrite/_money.ts';
import * as client from '../../src/lib/payments/money.js';
import {
  prepareChargeCreate,
  prepareChargeUpdate,
  preparePaymentCreate,
  preparePaymentUpdate,
  prepareConceptWrite,
  settleCharge,
  chargeDeleteProblem,
} from '../../base44/functions/guardedEntityWrite/_payments.ts';
import { runSchoolWrite } from '../../base44/functions/guardedEntityWrite/_schoolWrite.ts';
import { SERVER_ONLY_FIELDS, stripServerOnlyFields } from '../../base44/functions/guardedEntityWrite/_policy.ts';
import { planChargeReminder, mexicoToday as fanoutToday } from '../../base44/functions/sendBulkNotification/_fanout.ts';
import { mexicoToday as lumiToday, chargeOwed } from '../../base44/functions/lumiQuery/_lumiCore.ts';
import { READ_RULES } from '../../base44/functions/schoolRead/_scope.ts';
import { summarizeUnpaidCharges, partitionCharges, isChargeOverdue, UNPAID_CHARGE_STATUSES } from '../../src/lib/payments/overdue.js';
import { canReadEntity } from '../../src/lib/authorization/policy.js';
import { NOTIFICATION_TEMPLATES } from '../../base44/functions/sendBulkNotification/_templates.ts';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// 29 Sept 2026, 20:00 in Mexico = 30 Sept 02:00 UTC. The server runs in UTC:
// a naive toISOString() date says "the 30th" here.
const EVENING_MX = new Date('2026-09-30T02:00:00.000Z');
const TODAY_MX = '2026-09-29';

// --- the two copies agree ----------------------------------------------------

const SHARED = [
  'parseAmountCents', 'storedCents', 'centsToAmount', 'isValidDate', 'discountCents', 'discountApplies',
  'validateDiscount', 'priceCharge', 'deriveChargeStatus', 'chargeBalanceCents', 'sumPaymentsCents',
  'checkPayment', 'isChargeOpen', 'manualReminderAvailableAt',
];

test('the client money helpers mirror the server ones (same functions, same answers)', () => {
  for (const name of SHARED) {
    assert.equal(typeof server[name], 'function', `server ${name}`);
    assert.equal(typeof client[name], 'function', `client ${name}`);
  }
  for (const name of ['CHARGE_STATUSES', 'CONCEPT_TYPES', 'PAYMENT_METHODS', 'DISCOUNT_TYPES', 'MAX_AMOUNT_CENTS', 'MANUAL_REMINDER_COOLDOWN_MS']) {
    assert.deepEqual(client[name], server[name], name);
  }
  const amounts = [1000, '1000', '999.99', 0.1, 0.3, '0', 0, -5, '12.345', 'abc', '', null, undefined, true, Infinity, 1e7, 1e7 + 0.01, ' 450.5 '];
  for (const a of amounts) {
    assert.deepEqual(client.parseAmountCents(a), server.parseAmountCents(a), `parseAmountCents(${a})`);
    assert.deepEqual(client.parseAmountCents(a, { allowZero: true }), server.parseAmountCents(a, { allowZero: true }), `allowZero ${a}`);
  }
  const discounts = [
    null,
    { discount_type: 'PERCENTAGE', discount_value: 10 },
    { discount_type: 'PERCENTAGE', discount_value: 150 },
    { discount_type: 'PERCENTAGE', discount_value: -10 },
    { discount_type: 'PERCENTAGE', discount_value: 33.33 },
    { discount_type: 'FIXED_AMOUNT', discount_value: 500 },
    { discount_type: 'FIXED_AMOUNT', discount_value: 99.99 },
    { discount_type: 'BOGUS', discount_value: 10 },
  ];
  for (const d of discounts) {
    for (const cents of [0, 1, 30000, 100000, 99999]) {
      assert.equal(client.discountCents(d, cents), server.discountCents(d, cents), `discountCents ${JSON.stringify(d)} ${cents}`);
    }
    if (d) {
      const full = { ...d, applicable_to_concepts: ['OTRO'] };
      assert.deepEqual(client.validateDiscount(full), server.validateDiscount(full), `validateDiscount ${JSON.stringify(d)}`);
    }
  }
  const statuses = [
    { amountCents: 100000, paidCents: 0, dueDate: '2026-10-01' },
    { amountCents: 100000, paidCents: 40000, dueDate: '2026-10-01' },
    { amountCents: 100000, paidCents: 40000, dueDate: '2026-09-28' },
    { amountCents: 100000, paidCents: 100000, dueDate: '2026-09-28' },
    { amountCents: 0, paidCents: 0, dueDate: '2026-09-28' },
    { amountCents: 100000, paidCents: 0, dueDate: TODAY_MX },
    { amountCents: 100000, paidCents: 0, dueDate: '2026-09-28', current: 'CANCELLED' },
  ];
  for (const input of statuses) {
    assert.equal(client.deriveChargeStatus({ ...input, today: TODAY_MX }), server.deriveChargeStatus({ ...input, today: TODAY_MX }), JSON.stringify(input));
  }
});

test('"today" is the Mexico calendar day in every server copy, even at 20:00', () => {
  assert.equal(server.mexicoToday(EVENING_MX), TODAY_MX);
  assert.equal(fanoutToday(EVENING_MX), TODAY_MX);
  assert.equal(lumiToday(EVENING_MX), TODAY_MX);
  assert.notEqual(EVENING_MX.toISOString().slice(0, 10), TODAY_MX, 'the naive UTC date really is the next day');
});

// --- arithmetic ---------------------------------------------------------------

test('amounts are whole cents: no negatives, no third decimal, no float drift', () => {
  assert.deepEqual(server.parseAmountCents('1000'), { ok: true, cents: 100000 });
  assert.deepEqual(server.parseAmountCents(0.1), { ok: true, cents: 10 });
  assert.equal(server.parseAmountCents(-1).ok, false);
  assert.equal(server.parseAmountCents('12.345').ok, false);
  assert.equal(server.parseAmountCents(0).ok, false);
  assert.equal(server.parseAmountCents(0, { allowZero: true }).ok, true);
  assert.equal(server.parseAmountCents(Infinity).ok, false);
  assert.equal(server.parseAmountCents('abc').ok, false);
  assert.equal(server.parseAmountCents(1e7).ok, true);
  assert.equal(server.parseAmountCents(1e7 + 0.01).ok, false, 'above the 10-million ceiling');
  // 0.1 + 0.2 !== 0.3 in floats; in cents it is exact.
  assert.equal(server.sumPaymentsCents([{ amount: 0.1 }, { amount: 0.2 }]), server.parseAmountCents(0.3).cents);
});

test('three payments of 333.33 + 333.33 + 333.34 close a $1,000 charge exactly', () => {
  const paid = server.sumPaymentsCents([{ amount: 333.33 }, { amount: 333.33 }, { amount: 333.34 }]);
  assert.equal(paid, 100000);
  assert.equal(server.deriveChargeStatus({ amountCents: 100000, paidCents: paid, dueDate: '2026-10-10', today: TODAY_MX }), 'PAID');
  assert.equal(server.deriveChargeStatus({ amountCents: 100000, paidCents: paid - 1, dueDate: '2026-10-10', today: TODAY_MX }), 'PARTIAL');
});

test('status: PAID only when payments cover the charge; PARTIAL otherwise; OVERDUE once the Mexico day passed', () => {
  const s = (paidCents, dueDate, current) => server.deriveChargeStatus({ amountCents: 100000, paidCents, dueDate, today: TODAY_MX, current });
  assert.equal(s(0, '2026-10-01'), 'PENDING');
  assert.equal(s(40000, '2026-10-01'), 'PARTIAL');
  assert.equal(s(100000, '2026-10-01'), 'PAID');
  assert.equal(s(120000, '2026-10-01'), 'PAID');
  // Late and not fully paid — half-paid is still late.
  assert.equal(s(0, '2026-09-28'), 'OVERDUE');
  assert.equal(s(40000, '2026-09-28'), 'OVERDUE');
  assert.equal(s(100000, '2026-09-28'), 'PAID');
  // Due TODAY in Mexico is not late, even though UTC already says tomorrow.
  assert.equal(s(0, TODAY_MX), 'PENDING');
  // Cancelled is a decision, not arithmetic.
  assert.equal(s(0, '2026-09-28', 'CANCELLED'), 'CANCELLED');
  // A stale stored status never wins over the payments.
  assert.equal(s(40000, '2026-10-01', 'PAID'), 'PARTIAL');
});

test('a discount never makes a charge negative, and percentages are capped at 100', () => {
  const fixed500 = { discount_type: 'FIXED_AMOUNT', discount_value: 500 };
  assert.deepEqual(server.priceCharge(30000, fixed500), { originalCents: 30000, discountCents: 30000, amountCents: 0 });
  assert.deepEqual(server.priceCharge(100000, fixed500), { originalCents: 100000, discountCents: 50000, amountCents: 50000 });
  assert.equal(server.discountCents({ discount_type: 'PERCENTAGE', discount_value: 150 }, 100000), 100000);
  assert.equal(server.discountCents({ discount_type: 'PERCENTAGE', discount_value: -10 }, 100000), 0);
  assert.equal(server.discountCents({ discount_type: 'PERCENTAGE', discount_value: 12.5 }, 99999), 12500);
});

test('a discount applies only when active, in its (inclusive) window, for the concept TYPE', () => {
  const d = { discount_type: 'PERCENTAGE', discount_value: 10, applicable_to_concepts: ['COLEGIATURA'], valid_from: '2026-09-01', valid_until: TODAY_MX };
  const applies = (discount, conceptType = 'COLEGIATURA', allowsDiscounts) =>
    server.discountApplies(discount, { conceptType, today: TODAY_MX, allowsDiscounts }).ok;
  assert.equal(applies(d), true, '"hasta el 29" still applies on the 29th');
  assert.equal(applies(d, 'OTRO'), false, 'scoped to COLEGIATURA');
  assert.equal(applies({ ...d, valid_until: '2026-09-28' }), false, 'expired');
  assert.equal(applies({ ...d, valid_from: '2026-09-30' }), false, 'not started');
  assert.equal(applies({ ...d, is_active: false }), false);
  assert.equal(applies(d, 'COLEGIATURA', false), false, 'concept does not allow discounts');
});

test('validateDiscount refuses what the form used to accept, and names the field', () => {
  const base = { discount_type: 'PERCENTAGE', discount_value: 10, applicable_to_concepts: ['COLEGIATURA'] };
  assert.deepEqual(server.validateDiscount(base), { ok: true });
  assert.equal(server.validateDiscount({ ...base, discount_value: 150 }).field, 'discount_value');
  assert.equal(server.validateDiscount({ ...base, discount_value: -10 }).field, 'discount_value');
  assert.equal(server.validateDiscount({ ...base, discount_value: 0 }).field, 'discount_value');
  assert.equal(server.validateDiscount({ ...base, discount_value: '' }).field, 'discount_value');
  assert.equal(server.validateDiscount({ ...base, discount_type: 'FIXED_AMOUNT', discount_value: 1500 }).ok, true, 'a fixed amount may exceed 100');
  assert.equal(server.validateDiscount({ ...base, discount_type: 'FIXED_AMOUNT', discount_value: 10.555 }).field, 'discount_value');
  assert.equal(server.validateDiscount({ ...base, applicable_to_concepts: [] }).field, 'applicable_to_concepts');
  assert.equal(server.validateDiscount({ ...base, applicable_to_concepts: ['NOPE'] }).field, 'applicable_to_concepts');
  assert.equal(server.validateDiscount({ ...base, valid_from: '2026-10-10', valid_until: '2026-10-01' }).field, 'valid_until');
  assert.equal(server.validateDiscount({ ...base, valid_from: '2026-02-30' }).field, 'valid_from');
  assert.ok(client.DISCOUNT_FIELD_ERRORS.discount_value && client.DISCOUNT_FIELD_ERRORS.valid_until);
});

test('a payment larger than the balance, or on a closed charge, is refused', () => {
  const charge = { amount: 1000, status: 'PARTIAL' };
  assert.deepEqual(server.checkPayment({ charge, paidCents: 40000, amountCents: 60000 }), { ok: true, balanceCents: 60000 });
  assert.equal(server.checkPayment({ charge, paidCents: 40000, amountCents: 60001 }).code, 'OVERPAYMENT');
  assert.equal(server.checkPayment({ charge: { amount: 1000, status: 'PAID' }, paidCents: 0, amountCents: 100 }).code, 'CHARGE_ALREADY_PAID');
  assert.equal(server.checkPayment({ charge: { amount: 1000, status: 'CANCELLED' }, paidCents: 0, amountCents: 100 }).code, 'CHARGE_CANCELLED');
  assert.equal(server.checkPayment({ charge, paidCents: 100000, amountCents: 1 }).code, 'CHARGE_ALREADY_PAID');
});

test('the balance is what is still owed; a legacy PAID row owes nothing', () => {
  assert.equal(server.chargeBalanceCents({ amount: 1000, amount_paid: 400, status: 'PARTIAL' }), 60000);
  assert.equal(server.chargeBalanceCents({ amount: 1000, status: 'PENDING' }), 100000, 'no amount_paid yet');
  assert.equal(server.chargeBalanceCents({ amount: 1000, status: 'PAID' }), 0);
  assert.equal(client.chargeBalance({ amount: 1000, amount_paid: 400, status: 'OVERDUE' }), 600);
  assert.equal(client.chargePaid({ amount: 1000, status: 'PAID' }), 1000);
  assert.equal(client.formatMoney(600), '$600.00');
});

// --- the server write path against an in-memory database -----------------------

function db() {
  return makeFakeDb({
    PaymentConcept: [
      { id: 'pcA', school_id: 'sA', name: 'Colegiatura', concept_type: 'COLEGIATURA', default_amount: 1000 },
      { id: 'pcA-nodisc', school_id: 'sA', name: 'Uniforme', concept_type: 'OTRO', default_amount: 300, allows_discounts: false },
      { id: 'pcA-legacy', school_id: 'sA', name: 'Otro cargo', default_amount: 300 },
      { id: 'pcB', school_id: 'sB', name: 'Colegiatura B', concept_type: 'COLEGIATURA', default_amount: 900 },
    ],
    Discount: [
      { id: 'dA-10', school_id: 'sA', name: 'Hermanos', discount_type: 'PERCENTAGE', discount_value: 10, applicable_to_concepts: ['COLEGIATURA'], is_active: true },
      { id: 'dA-500', school_id: 'sA', name: 'Beca', discount_type: 'FIXED_AMOUNT', discount_value: 500, applicable_to_concepts: ['OTRO', 'COLEGIATURA'], is_active: true },
      { id: 'dA-old', school_id: 'sA', name: 'Vencido', discount_type: 'PERCENTAGE', discount_value: 50, applicable_to_concepts: ['COLEGIATURA'], valid_until: '2026-01-01', is_active: true },
      { id: 'dB', school_id: 'sB', name: 'B', discount_type: 'PERCENTAGE', discount_value: 90, applicable_to_concepts: ['COLEGIATURA'], is_active: true },
    ],
    ChargeItem: [
      { id: 'chA', school_id: 'sA', student_id: 'stuA1', concept_name: 'Colegiatura', amount: 1000, original_amount: 1000, discount_amount: 0, due_date: '2026-10-10', status: 'PENDING' },
      { id: 'chA-late', school_id: 'sA', student_id: 'stuA1', concept_name: 'Inscripción', amount: 500, due_date: '2026-09-01', status: 'PENDING' },
      { id: 'chA-paid', school_id: 'sA', student_id: 'stuA1', concept_name: 'Viejo', amount: 700, due_date: '2026-08-01', status: 'PAID' },
      { id: 'chA-cancel', school_id: 'sA', student_id: 'stuA1', concept_name: 'Anulado', amount: 700, due_date: '2026-10-01', status: 'CANCELLED' },
      { id: 'chB', school_id: 'sB', student_id: 'stuB1', concept_name: 'B', amount: 900, due_date: '2026-10-10', status: 'PENDING' },
    ],
    PaymentRecord: [
      { id: 'prB', school_id: 'sB', charge_id: 'chB', student_id: 'stuB1', amount: 100, payment_date: '2026-09-20' },
    ],
  });
}

const sr = (d) => ({ entities: d.entities });

async function pay(d, chargeId, amount, extra = {}) {
  const prepared = await preparePaymentCreate(sr(d), { charge_id: chargeId, amount, ...extra }, 'sA', EVENING_MX);
  if (!prepared.ok) return prepared;
  const record = await d.entities.PaymentRecord.create({ ...prepared.data, school_id: 'sA' });
  const charge = await settleCharge(sr(d), chargeId, 'sA', EVENING_MX);
  return { ok: true, record, charge };
}

test('THE BUG: $400 on a $1,000 charge leaves it PARTIAL with $600 owed; $600 more closes it', async () => {
  const d = db();
  const first = await pay(d, 'chA', 400);
  assert.equal(first.ok, true);
  assert.equal(first.charge.status, 'PARTIAL');
  assert.equal(first.charge.amount_paid, 400);
  assert.equal(first.charge.last_payment_date, TODAY_MX, 'payment date defaults to the Mexico day');
  assert.equal(client.chargeBalance(first.charge), 600);

  const tooMuch = await pay(d, 'chA', 600.01);
  assert.equal(tooMuch.ok, false);
  assert.equal(tooMuch.code, 'OVERPAYMENT');

  const second = await pay(d, 'chA', '600.00');
  assert.equal(second.charge.status, 'PAID');
  assert.equal(second.charge.amount_paid, 1000);

  const third = await pay(d, 'chA', 1);
  assert.equal(third.code, 'CHARGE_ALREADY_PAID');
  assert.equal(third.status, 409);
});

test('a partial payment on a late charge keeps it OVERDUE', async () => {
  const d = db();
  const r = await pay(d, 'chA-late', 100);
  assert.equal(r.charge.status, 'OVERDUE');
  assert.equal(r.charge.amount_paid, 100);
});

test('a payment takes its student from the charge and cannot cross schools', async () => {
  const d = db();
  const r = await preparePaymentCreate(sr(d), { charge_id: 'chA', amount: 10, student_id: 'stuB1' }, 'sA', EVENING_MX);
  assert.equal(r.ok, true);
  assert.equal(r.data.student_id, 'stuA1');
  const foreign = await preparePaymentCreate(sr(d), { charge_id: 'chB', amount: 10 }, 'sA', EVENING_MX);
  assert.equal(foreign.code, 'REFERENCE_NOT_IN_SCHOOL');
  assert.equal((await preparePaymentCreate(sr(d), { amount: 10 }, 'sA', EVENING_MX)).code, 'MISSING_CHARGE');
  // Other schools' payments never count toward this school's charge.
  assert.equal((await settleCharge(sr(d), 'chA', 'sA', EVENING_MX)).amount_paid, 0);
  assert.equal(await settleCharge(sr(d), 'chB', 'sA', EVENING_MX), null);
});

test('legacy PAID and CANCELLED charges take no payments; future-dated and bad-method payments are refused', async () => {
  const d = db();
  assert.equal((await preparePaymentCreate(sr(d), { charge_id: 'chA-paid', amount: 10 }, 'sA', EVENING_MX)).code, 'CHARGE_ALREADY_PAID');
  assert.equal((await preparePaymentCreate(sr(d), { charge_id: 'chA-cancel', amount: 10 }, 'sA', EVENING_MX)).code, 'CHARGE_CANCELLED');
  assert.equal((await preparePaymentCreate(sr(d), { charge_id: 'chA', amount: 10, payment_date: '2026-09-30' }, 'sA', EVENING_MX)).code, 'INVALID_PAYMENT_DATE');
  assert.equal((await preparePaymentCreate(sr(d), { charge_id: 'chA', amount: 10, payment_method: 'bitcoin' }, 'sA', EVENING_MX)).code, 'INVALID_FIELD');
  assert.equal((await preparePaymentCreate(sr(d), { charge_id: 'chA', amount: -10 }, 'sA', EVENING_MX)).code, 'INVALID_AMOUNT');
  assert.equal((await preparePaymentCreate(sr(d), { charge_id: 'chA', amount: 10.005 }, 'sA', EVENING_MX)).code, 'INVALID_AMOUNT');
});

test('deleting a payment reopens its charge; a charge with payments cannot be deleted', async () => {
  const d = db();
  const r = await pay(d, 'chA', 1000);
  assert.equal(r.charge.status, 'PAID');
  assert.equal((await chargeDeleteProblem(sr(d), { id: 'chA' }, 'sA')).code, 'CHARGE_HAS_PAYMENTS');
  await d.entities.PaymentRecord.delete(r.record.id);
  const reopened = await settleCharge(sr(d), 'chA', 'sA', EVENING_MX);
  assert.equal(reopened.status, 'PENDING');
  assert.equal(reopened.amount_paid, 0);
  assert.equal(reopened.last_payment_date, null);
  assert.equal(await chargeDeleteProblem(sr(d), { id: 'chA' }, 'sA'), null);
});

test('a recorded payment\'s amount, charge and date are locked; how it was paid is not', () => {
  const existing = { amount: 400, charge_id: 'chA', payment_date: '2026-09-20', payment_method: 'cash' };
  assert.equal(preparePaymentUpdate(existing, { amount: 500 }).code, 'PAYMENT_LOCKED');
  assert.equal(preparePaymentUpdate(existing, { charge_id: 'chA-late' }).code, 'PAYMENT_LOCKED');
  assert.equal(preparePaymentUpdate(existing, { payment_date: '2026-09-21' }).code, 'PAYMENT_LOCKED');
  assert.deepEqual(preparePaymentUpdate(existing, { amount: 400, payment_method: 'transfer', reference: ' TRX-1 ' }), {
    ok: true, data: { payment_method: 'transfer', reference: 'TRX-1' },
  });
});

test('the server prices a charge: concept type from the stored concept, discount re-checked and clamped', async () => {
  const d = db();
  // The client claims OTRO and sends its own amounts; the concept says COLEGIATURA.
  const r = await prepareChargeCreate(sr(d), {
    student_id: 'stuA1', concept_id: 'pcA', concept_type: 'OTRO', original_amount: 1000, discount_id: 'dA-10',
    discount_amount: 999, amount: 1, status: 'PAID', amount_paid: 1000, due_date: '2026-10-15',
  }, 'sA', EVENING_MX);
  assert.equal(r.ok, true);
  assert.equal(r.data.concept_type, 'COLEGIATURA');
  assert.equal(r.data.concept_name, 'Colegiatura');
  assert.equal(r.data.original_amount, 1000);
  assert.equal(r.data.discount_amount, 100);
  assert.equal(r.data.amount, 900);
  assert.equal(r.data.amount_paid, 0);
  assert.equal(r.data.status, 'PENDING');

  // THE BUG: $500 fixed on a $300 charge was saved as -200.
  const clamped = await prepareChargeCreate(sr(d), { student_id: 'stuA1', concept_id: 'pcA-legacy', original_amount: 300, discount_id: 'dA-500', due_date: '2026-10-15' }, 'sA', EVENING_MX);
  assert.equal(clamped.data.amount, 0);
  assert.equal(clamped.data.discount_amount, 300);
  assert.equal(clamped.data.status, 'PAID', 'nothing is owed');
  assert.equal(clamped.data.concept_type, 'OTRO', 'a concept saved before types existed reads as OTRO');

  const late = await prepareChargeCreate(sr(d), { student_id: 'stuA1', concept_id: 'pcA', original_amount: 100, due_date: '2026-09-28' }, 'sA', EVENING_MX);
  assert.equal(late.data.status, 'OVERDUE');
});

test('a charge refuses a discount that does not apply, belongs to another school, or a bad amount/date', async () => {
  const d = db();
  const base = { student_id: 'stuA1', concept_id: 'pcA', original_amount: 1000, due_date: '2026-10-15' };
  const code = async (patch) => (await prepareChargeCreate(sr(d), { ...base, ...patch }, 'sA', EVENING_MX)).code;
  assert.equal(await code({ discount_id: 'dA-old' }), 'DISCOUNT_NOT_APPLICABLE');
  assert.equal(await code({ discount_id: 'dB' }), 'REFERENCE_NOT_IN_SCHOOL');
  assert.equal(await code({ concept_id: 'pcB' }), 'REFERENCE_NOT_IN_SCHOOL');
  assert.equal(await code({ concept_id: 'pcA-nodisc', discount_id: 'dA-500' }), 'DISCOUNT_NOT_APPLICABLE');
  assert.equal(await code({ original_amount: -300 }), 'INVALID_AMOUNT');
  assert.equal(await code({ original_amount: 0 }), 'INVALID_AMOUNT');
  assert.equal(await code({ due_date: '2026-02-30' }), 'INVALID_DUE_DATE');
});

test('a charge edit cannot change its price, and never takes a status from the client (except CANCELLED)', async () => {
  const d = db();
  const existing = (await d.entities.ChargeItem.get('chA-late'));
  assert.equal((await prepareChargeUpdate(sr(d), existing, { amount: 1 }, 'sA', EVENING_MX)).code, 'AMOUNT_LOCKED');
  assert.equal((await prepareChargeUpdate(sr(d), existing, { discount_id: 'dA-500' }, 'sA', EVENING_MX)).code, 'AMOUNT_LOCKED');
  // PagosAdmin's overdue refresh: { status: 'OVERDUE' } is re-derived, not trusted.
  const refresh = await prepareChargeUpdate(sr(d), existing, { status: 'OVERDUE' }, 'sA', EVENING_MX);
  assert.deepEqual(refresh.data, { status: 'OVERDUE', amount_paid: 0 });
  const forgedPaid = await prepareChargeUpdate(sr(d), existing, { status: 'PAID' }, 'sA', EVENING_MX);
  assert.equal(forgedPaid.data.status, 'OVERDUE', 'a client cannot mark an unpaid charge PAID');
  const moved = await prepareChargeUpdate(sr(d), existing, { due_date: '2026-12-01' }, 'sA', EVENING_MX);
  assert.equal(moved.data.status, 'PENDING', 'moving the due date forward un-lates it');
  const cancelled = await prepareChargeUpdate(sr(d), existing, { status: 'CANCELLED' }, 'sA', EVENING_MX);
  assert.equal(cancelled.data.status, 'CANCELLED');
});

test('the paid/reminder bookkeeping is server-only on ChargeItem', () => {
  assert.deepEqual(SERVER_ONLY_FIELDS.ChargeItem.sort(), ['amount_paid', 'last_payment_date', 'last_reminder_at', 'reminder_sent']);
  assert.deepEqual(stripServerOnlyFields('ChargeItem', { amount_paid: 1000, notes: 'x' }), { notes: 'x' });
  const schema = JSON.parse(read('base44/entities/ChargeItem.jsonc'));
  assert.deepEqual(schema.properties.status.enum, ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED']);
  assert.deepEqual([...schema.properties.status.enum].sort(), [...server.CHARGE_STATUSES].sort());
  for (const field of ['amount_paid', 'last_payment_date', 'last_reminder_at']) {
    assert.equal(schema.properties[field]?.rls?.write, false, `${field} must be rls.write:false`);
  }
  assert.deepEqual(schema.properties.concept_type.enum, server.CONCEPT_TYPES);
  const payment = JSON.parse(read('base44/entities/PaymentRecord.jsonc'));
  assert.deepEqual(payment.properties.payment_method.enum, server.PAYMENT_METHODS);
});

test('a payment concept needs a real price and a real type', () => {
  assert.equal(prepareConceptWrite('create', { name: 'X', default_amount: -1 }).code, 'INVALID_AMOUNT');
  assert.equal(prepareConceptWrite('create', { name: ' ', default_amount: 10 }).code, 'MISSING_FIELDS');
  assert.equal(prepareConceptWrite('create', { name: 'X', default_amount: 10, concept_type: 'NOPE' }).code, 'INVALID_FIELD');
  assert.deepEqual(prepareConceptWrite('create', { name: ' Colegiatura ', default_amount: '1000', concept_type: 'COLEGIATURA' }).data,
    { name: 'Colegiatura', default_amount: 1000, concept_type: 'COLEGIATURA' });
  assert.equal(prepareConceptWrite('create', { name: 'X', default_amount: 0 }).data.concept_type, 'OTRO');
});

// --- Discount through the real school write path ------------------------------

function discountDb() {
  return makeFakeDb({
    UserProfile: [{ id: 'p-adminA', user_id: 'u-adminA', school_id: 'sA', app_role: 'ADMIN', status: 'ACTIVE', onboarding_completed: true, created_date: '2026-09-01T00:00:00Z' }],
    SchoolSubscription: [{ id: 'subA', school_id: 'sA', subscription_status: 'active', license_tier: 'growth' }],
    Discount: [{ id: 'dBad', school_id: 'sA', name: 'Viejo', discount_type: 'PERCENTAGE', discount_value: 150, applicable_to_concepts: ['OTRO'], is_active: true }],
    AuditLog: [],
  });
}
const adminA = { id: 'u-adminA', full_name: 'Directora A', email: 'a@a.mx' };

test('guardedEntityWrite refuses a 150 % / -10 % / backwards-dated discount', async () => {
  const d = discountDb();
  const create = (data) => runSchoolWrite({ sr: { entities: d.entities }, user: adminA, body: { entity: 'Discount', operation: 'create', data }, now: EVENING_MX });
  const base = { name: 'Hermanos', discount_type: 'PERCENTAGE', discount_value: 10, applicable_to_concepts: ['COLEGIATURA'] };
  assert.equal((await create(base)).status, 200);
  for (const [patch, field] of [
    [{ discount_value: 150 }, 'discount_value'],
    [{ discount_value: -10 }, 'discount_value'],
    [{ applicable_to_concepts: [] }, 'applicable_to_concepts'],
    [{ valid_from: '2026-10-10', valid_until: '2026-10-01' }, 'valid_until'],
  ]) {
    const r = await create({ ...base, ...patch });
    assert.equal(r.status, 400, field);
    assert.equal(r.body.code, 'INVALID_DISCOUNT', field);
    assert.match(r.body.error, new RegExp(field));
  }
});

test('an old malformed discount can still be switched off, but not re-saved as is', async () => {
  const d = discountDb();
  const update = (data) => runSchoolWrite({ sr: { entities: d.entities }, user: adminA, body: { entity: 'Discount', operation: 'update', id: 'dBad', data }, now: EVENING_MX });
  assert.equal((await update({ is_active: false })).status, 200);
  assert.equal((await update({ discount_value: 150 })).body.code, 'INVALID_DISCOUNT');
  assert.equal((await update({ discount_value: 15 })).status, 200);
});

// --- reminders -----------------------------------------------------------------

test('reminders ask for the BALANCE, switch to the overdue email when late, and repeat at most daily', () => {
  const now = EVENING_MX;
  const plan = (charge, manual = false) => planChargeReminder(charge, { manual, now });
  assert.deepEqual(plan({ status: 'PARTIAL', amount: 1000, amount_paid: 400, due_date: '2026-10-03' }), { send: true, overdue: false, balance: 600 });
  assert.deepEqual(plan({ status: 'PENDING', amount: 1000, due_date: '2026-09-28' }), { send: true, overdue: true, balance: 1000 });
  assert.deepEqual(plan({ status: 'PENDING', amount: 1000, due_date: TODAY_MX }), { send: true, overdue: false, balance: 1000 });
  assert.equal(plan({ status: 'PAID', amount: 1000 }).reason, 'not_pending');
  assert.equal(plan({ status: 'CANCELLED', amount: 1000 }, true).reason, 'not_pending');
  assert.equal(plan({ status: 'PARTIAL', amount: 1000, amount_paid: 1000 }).reason, 'not_pending');
  // Automatic: once per charge. Manual: overrides that, but once a day.
  const reminded = { status: 'OVERDUE', amount: 1000, due_date: '2026-09-01', reminder_sent: true };
  assert.equal(plan(reminded).reason, 'already_sent');
  assert.equal(plan(reminded, true).send, true);
  const lastHour = { ...reminded, last_reminder_at: new Date(now.getTime() - 3600e3).toISOString() };
  assert.equal(plan(lastHour, true).reason, 'cooldown');
  const yesterday = { ...reminded, last_reminder_at: new Date(now.getTime() - 25 * 3600e3).toISOString() };
  assert.equal(plan(yesterday, true).send, true);
  // The client disables the button on the same clock.
  assert.ok(client.manualReminderAvailableAt(lastHour, now) > now.getTime());
  assert.equal(client.manualReminderAvailableAt(yesterday, now), 0);
});

test('the overdue template exists in every copy and names the balance', () => {
  const ctx = { studentName: 'Ana', conceptName: 'Colegiatura', amountLabel: '$600.00', dueDateLabel: '1 de septiembre, 2026' };
  assert.match(NOTIFICATION_TEMPLATES.payment_overdue.subject(ctx), /vencido/);
  assert.match(NOTIFICATION_TEMPLATES.payment_overdue.emailBody(ctx), /Saldo pendiente:<\/strong> \$600\.00/);
  assert.match(NOTIFICATION_TEMPLATES.payment_due.emailBody(ctx), /Saldo pendiente:/);
  // The client copy (src/lib/notifications/templates.js imports through the
  // '@' alias, so it is read, not loaded).
  for (const path of ['src/lib/notifications/templates.js', 'base44/functions/sendNotificationEmail/_templates.ts']) {
    assert.match(read(path), /payment_overdue: \{/, path);
  }
  // sendNotificationEmail never sends it (no CALLER_ROLES entry): only the
  // server fan-out, which reads the charge itself.
  assert.doesNotMatch(read('base44/functions/sendNotificationEmail/entry.ts'), /payment_overdue:/);
  const bulk = read('base44/functions/sendBulkNotification/entry.ts');
  assert.match(bulk, /eventType: reminder\.overdue \? 'payment_overdue' : 'payment_due'/);
  assert.match(bulk, /amountLabel: moneyLabel\(reminder\.balance\)/);
  assert.match(bulk, /throw new HttpError\(429, 'REMINDER_COOLDOWN'/);
  assert.match(bulk, /last_reminder_at: now\.toISOString\(\)/);
});

// --- screens ---------------------------------------------------------------------

test('Reportes counts OVERDUE and PARTIAL charges, and totals what is still owed', () => {
  const charges = [
    { id: 'a', status: 'PENDING', amount: 1000, due_date: '2026-10-10' },
    { id: 'b', status: 'OVERDUE', amount: 500, due_date: '2026-09-01' },
    { id: 'c', status: 'PARTIAL', amount: 1000, amount_paid: 400, due_date: '2026-10-10' },
    { id: 'd', status: 'PARTIAL', amount: 300, amount_paid: 100, due_date: '2026-09-02' },
    { id: 'e', status: 'PENDING', amount: 200, due_date: '2026-09-03' },
  ];
  const now = new Date(2026, 8, 29, 20, 0);
  assert.deepEqual(summarizeUnpaidCharges(charges, now), {
    count: 5, overdueCount: 3, upcomingCount: 2, total: 1000 + 500 + 600 + 200 + 200, overdueTotal: 500 + 200 + 200,
  });
  assert.equal(isChargeOverdue({ status: 'PARTIAL', due_date: '2026-09-02' }, now), true);
  assert.deepEqual(partitionCharges(charges, now).pending.map((c) => c.id), ['a', 'c']);
  assert.ok(UNPAID_CHARGE_STATUSES.includes('PARTIAL'));

  const reportes = read('src/pages/Reportes.jsx');
  assert.doesNotMatch(reportes, /status: 'PENDING'/, 'PENDING alone dropped every OVERDUE charge');
  assert.match(reportes, /status: \{ \$in: \[\.\.\.UNPAID_CHARGE_STATUSES\] \}/);
  assert.match(reportes, /summarizeUnpaidCharges\(unpaidCharges\)/);
  assert.match(read('src/components/home/ParentHome.jsx'), /status: \{ \$in: \[\.\.\.UNPAID_CHARGE_STATUSES\] \}/);
});

test('PagosAdmin records a payment in ONE write and never sets a charge PAID itself', () => {
  const source = read('src/pages/PagosAdmin.jsx');
  assert.doesNotMatch(source, /status: 'PAID'/);
  assert.doesNotMatch(source, /guardedUpdate\('ChargeItem', selectedCharge\.id/);
  assert.match(source, /const payment = await guardedCreate\('PaymentRecord', data\);/);
  // The default amount is the balance, not the charge's full amount.
  assert.match(source, /centsToAmount\(chargeBalanceCents\(charge\)\)\.toFixed\(2\)/);
  // The client no longer computes (or sends) the net amount or discount amount.
  assert.doesNotMatch(source, /amount: originalAmount - discountAmount/);
  assert.doesNotMatch(source, /discount_amount:/);
  // The concept form sets the type the discounts key on.
  assert.match(source, /concept_type: conceptForm\.concept_type/);
  // Manual reminder, through the server fan-out.
  assert.match(source, /notificationService\.sendBulk\(\{ eventType: 'payment_due', chargeId: charge\.id, manual: true \}\)/);
});

test('guardedEntityWrite runs the money rules on every ChargeItem / PaymentRecord / PaymentConcept write', () => {
  const entry = read('base44/functions/guardedEntityWrite/entry.ts');
  assert.match(entry, /await prepareChargeCreate\(sr, data, schoolId, now\)/);
  assert.match(entry, /await preparePaymentCreate\(sr, data, schoolId, now\)/);
  assert.match(entry, /prepareConceptWrite\('create', data\)/);
  assert.match(entry, /await prepareChargeUpdate\(sr, existing as Record<string, unknown>, patch, schoolId, now\)/);
  assert.match(entry, /preparePaymentUpdate\(existing as Record<string, unknown>, patch\)/);
  assert.match(entry, /const charge = await settleAfterPayment\(sr, data\.charge_id, schoolId, now\);/);
  assert.match(entry, /await settleAfterPayment\(sr, \(existing as \{ charge_id\?: string \}\)\.charge_id, schoolId, now\);/);
  assert.match(entry, /await chargeDeleteProblem\(sr, existing as Record<string, unknown>, schoolId\)/);
  // The event carve-out's charge goes through the same pricing.
  assert.ok(entry.indexOf('eventChargeData ?? stripServerOnlyFields') < entry.indexOf('await prepareChargeCreate('));
});

test('parents see what they paid on each charge — without being given PaymentRecord', () => {
  const fields = READ_RULES.ChargeItem.fields;
  for (const field of ['amount_paid', 'last_payment_date', 'original_amount', 'discount_amount']) {
    assert.ok(fields.includes(field), field);
  }
  assert.ok(READ_RULES.ChargeItem.roles.PARENT);
  assert.equal(READ_RULES.PaymentRecord, undefined, 'PaymentRecord stays unreadable through schoolRead');
  assert.equal(canReadEntity('PARENT', 'PaymentRecord'), false);
  const pagos = read('src/pages/Pagos.jsx');
  assert.match(pagos, /<ChargeAmounts charge=\{charge\}/);
  assert.match(pagos, /chargeBalanceCents\(c\)/);
  assert.match(pagos, /Pago parcial/);
});

test('Lumi reports the balance of partly paid charges too', () => {
  assert.equal(chargeOwed({ status: 'PARTIAL', amount: 1000, amount_paid: 400 }), 600);
  assert.equal(chargeOwed({ status: 'PAID', amount: 1000 }), 0);
  assert.equal(chargeOwed({ status: 'OVERDUE', amount: 500 }), 500);
  const lumi = read('base44/functions/lumiQuery/entry.ts');
  assert.doesNotMatch(lumi, /\['PENDING', 'OVERDUE'\]\.map/);
  assert.match(lumi, /OPEN_CHARGE_STATUSES\.map/);
});
