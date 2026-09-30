// Two requests at once (Codex review on PR #190, 2026-09-30). Base44 has no
// transactions and no compare-and-set, so both fixes are compensating:
//
//   - P1: two "Registrar pago" on the same charge could both pass the balance
//     check and overpay it. Now every request re-reads the charge's payments
//     after its insert, orders them (created_date, then id), keeps greedily
//     what fits, and deletes ITS OWN record if it is the overflow.
//   - P2: the manual reminder's 24 h cooldown was written after delivery, so
//     two clicks both mailed the family. Now it is claimed before sending,
//     verified after a pause, and given back when nobody was reached.
//
// The REAL server code runs here (_payments.ts, _fanout.ts) against a small
// in-memory store whose every call is a separate await, so two requests
// genuinely interleave at each I/O boundary.
process.env.TZ = 'America/Mexico_City';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPayments,
  orderPayments,
  preparePaymentCreate,
  resolvePaymentRace,
  settleCharge,
} from '../../base44/functions/guardedEntityWrite/_payments.ts';
import {
  claimChargeReminder,
  releaseChargeReminder,
  REMINDER_CLAIM_TTL_MS,
} from '../../base44/functions/sendBulkNotification/_fanout.ts';

const NOW = new Date('2026-09-30T02:00:00.000Z');
const tick = () => new Promise((r) => setImmediate(r));

// A store where created_date increases per insert (unless pinned) and every
// call yields to the event loop first, so Promise.all really interleaves.
function makeStore(tables, { pinCreatedDate = null, failDelete = false } = {}) {
  let seq = 0;
  const entities = {};
  for (const [name, rows] of Object.entries(tables)) {
    entities[name] = {
      async filter(query) {
        await tick();
        return rows.filter((r) => Object.entries(query).every(([k, v]) => r[k] === v)).map((r) => ({ ...r }));
      },
      async get(id) {
        await tick();
        const row = rows.find((r) => r.id === id);
        if (!row) throw new Error('not found');
        return { ...row };
      },
      async create(data) {
        await tick();
        seq += 1;
        const row = {
          id: `${name}-${String(seq).padStart(4, '0')}`,
          created_date: pinCreatedDate || new Date(Date.UTC(2026, 8, 30, 12, 0, 0, seq)).toISOString(),
          ...data,
        };
        rows.push(row);
        return { ...row };
      },
      async update(id, patch) {
        await tick();
        const row = rows.find((r) => r.id === id);
        if (!row) throw new Error('not found');
        Object.assign(row, patch);
        return { ...row };
      },
      async delete(id) {
        await tick();
        if (failDelete) throw new Error('store down');
        const i = rows.findIndex((r) => r.id === id);
        if (i < 0) throw new Error('not found');
        rows.splice(i, 1);
      },
    };
  }
  return { entities, tables };
}

function chargeStore(opts) {
  return makeStore({
    ChargeItem: [{ id: 'ch1', school_id: 'sA', student_id: 'stu1', amount: 1000, amount_paid: 0, status: 'PENDING', due_date: '2026-10-10' }],
    PaymentRecord: [],
  }, opts);
}

// One "Registrar pago" through the same steps entry.ts runs, in order:
// balance check → insert → race resolution → settle (kept only).
async function recordPayment(db, amount) {
  const prepared = await preparePaymentCreate(db, { charge_id: 'ch1', amount }, 'sA', NOW);
  if (!prepared.ok) return { status: prepared.status, code: prepared.code };
  const created = await db.entities.PaymentRecord.create({ ...prepared.data, school_id: 'sA' });
  const race = await resolvePaymentRace(db, created, 'sA');
  if (!race.ok) return { status: race.status, code: race.code, id: created.id };
  const charge = await settleCharge(db, 'ch1', 'sA', NOW, { keptOnly: true });
  return { status: 200, id: created.id, charge };
}

function paidCents(db) {
  return db.tables.PaymentRecord.reduce((s, p) => s + Math.round(Number(p.amount) * 100), 0);
}

// --- P1: payments ------------------------------------------------------------

test('two $600 payments at once on a $1,000 charge: exactly one is kept, never overpaid', async () => {
  const db = chargeStore();
  const [a, b] = await Promise.all([recordPayment(db, 600), recordPayment(db, 600)]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409], JSON.stringify([a, b]));
  const loser = a.status === 409 ? a : b;
  const winner = a.status === 200 ? a : b;
  assert.equal(loser.code, 'PAYMENT_CONFLICT');
  assert.equal(db.tables.PaymentRecord.length, 1);
  assert.equal(db.tables.PaymentRecord[0].id, winner.id);
  // The EARLIER insert is the one kept.
  assert.ok(winner.id < loser.id, 'the first insert wins');
  assert.equal(paidCents(db), 60000);
  const charge = db.tables.ChargeItem[0];
  assert.equal(charge.amount_paid, 600);
  assert.equal(charge.status, 'PARTIAL');
});

test('the same race, one request fully ahead: the second is refused before or after its insert, never kept', async () => {
  for (const order of ['ab', 'ba']) {
    const db = chargeStore();
    // Both pass the balance check before either inserts.
    const pa = await preparePaymentCreate(db, { charge_id: 'ch1', amount: 700 }, 'sA', NOW);
    const pb = await preparePaymentCreate(db, { charge_id: 'ch1', amount: 700 }, 'sA', NOW);
    assert.ok(pa.ok && pb.ok, 'the pre-insert check cannot see the other request');
    const ca = await db.entities.PaymentRecord.create({ ...pa.data, school_id: 'sA' });
    const cb = await db.entities.PaymentRecord.create({ ...pb.data, school_id: 'sA' });
    const [first, second] = order === 'ab' ? [ca, cb] : [cb, ca];
    const r1 = await resolvePaymentRace(db, first, 'sA');
    const r2 = await resolvePaymentRace(db, second, 'sA');
    const byId = { [first.id]: r1, [second.id]: r2 };
    assert.equal(byId[ca.id].ok, true, `${order}: the earlier insert is kept whoever resolves first`);
    assert.equal(byId[cb.id].ok, false, order);
    assert.equal(byId[cb.id].status, 409);
    assert.deepEqual(db.tables.PaymentRecord.map((p) => p.id), [ca.id], order);
  }
});

test('two payments that both fit are both kept, and the charge settles from both', async () => {
  const db = chargeStore();
  const [a, b] = await Promise.all([recordPayment(db, 400), recordPayment(db, 500)]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  assert.equal(db.tables.PaymentRecord.length, 2);
  // Re-settle once more so the assertion does not depend on which settle
  // wrote last (a separate, pre-existing staleness; see the report).
  await settleCharge(db, 'ch1', 'sA', NOW, { keptOnly: true });
  assert.equal(db.tables.ChargeItem[0].amount_paid, 900);
  assert.equal(db.tables.ChargeItem[0].status, 'PARTIAL');
});

test('many concurrent payments: whatever interleaving, the kept total never exceeds the charge', async () => {
  for (const amounts of [[600, 600, 600], [300, 300, 300, 300, 300], [1000, 1, 999, 500], [250, 250, 250, 250, 250, 250]]) {
    const db = chargeStore();
    const results = await Promise.all(amounts.map((x) => recordPayment(db, x)));
    const kept = results.filter((r) => r.status === 200);
    assert.ok(kept.length >= 1, `${amounts}: at least one payment is kept`);
    assert.ok(paidCents(db) <= 100000, `${amounts}: kept ${paidCents(db)} cents on a 100000-cent charge`);
    assert.equal(db.tables.PaymentRecord.length, kept.length, `${amounts}: every 200 is a stored record, every 409 is gone`);
    for (const r of results) if (r.status !== 200) assert.ok(['PAYMENT_CONFLICT', 'OVERPAYMENT', 'CHARGE_ALREADY_PAID'].includes(r.code), r.code);
  }
});

test('a tie on created_date is broken by id, so both requests still agree', async () => {
  const db = chargeStore({ pinCreatedDate: '2026-09-30T12:00:00.000Z' });
  const [a, b] = await Promise.all([recordPayment(db, 600), recordPayment(db, 600)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(db.tables.PaymentRecord.length, 1);
  assert.equal(db.tables.PaymentRecord[0].id, [a, b].find((r) => r.status === 200).id);
  assert.ok(db.tables.PaymentRecord[0].id < [a, b].find((r) => r.status === 409).id);
});

test('an overflow not yet deleted by its own request never counts as money received', async () => {
  const db = chargeStore();
  db.tables.PaymentRecord.push(
    { id: 'p1', school_id: 'sA', charge_id: 'ch1', amount: 600, created_date: '2026-09-30T12:00:00.001Z', payment_date: '2026-09-29' },
    { id: 'p2', school_id: 'sA', charge_id: 'ch1', amount: 600, created_date: '2026-09-30T12:00:00.002Z', payment_date: '2026-09-29' },
  );
  const charge = await settleCharge(db, 'ch1', 'sA', NOW, { keptOnly: true });
  assert.equal(charge.amount_paid, 600);
  assert.equal(charge.status, 'PARTIAL');
  // Without keptOnly (the delete path, legacy data) the raw sum is kept.
  assert.equal((await settleCharge(db, 'ch1', 'sA', NOW)).amount_paid, 1200);
});

test('the just-created record is counted even if the re-read cannot see it yet', async () => {
  const db = chargeStore();
  db.tables.PaymentRecord.push({ id: 'p1', school_id: 'sA', charge_id: 'ch1', amount: 600, created_date: '2026-09-30T12:00:00.001Z' });
  // A 600 inserted later but missing from the (lagging) re-read.
  const ghost = { id: 'p9', school_id: 'sA', charge_id: 'ch1', amount: 600, created_date: '2026-09-30T12:00:00.009Z' };
  db.entities.PaymentRecord.delete = async () => {}; // it is not in the table to delete
  const r = await resolvePaymentRace(db, ghost, 'sA');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PAYMENT_CONFLICT');
});

test('if the overflow cannot be deleted, the director is told to fix it by hand (500), not "retry"', async () => {
  const db = chargeStore({ failDelete: true });
  db.tables.PaymentRecord.push({ id: 'p1', school_id: 'sA', charge_id: 'ch1', amount: 600, created_date: '2026-09-30T12:00:00.001Z' });
  const mine = { id: 'p2', school_id: 'sA', charge_id: 'ch1', amount: 600, created_date: '2026-09-30T12:00:00.002Z' };
  db.tables.PaymentRecord.push(mine);
  const r = await resolvePaymentRace(db, mine, 'sA');
  assert.equal(r.status, 500);
  assert.equal(r.code, 'PAYMENT_CONFLICT_UNRESOLVED');
});

test('classification is greedy over one fixed order, and depends only on what came before', () => {
  const rows = [
    { id: 'c', amount: 300, created_date: '2026-09-30T12:00:00.003Z' },
    { id: 'a', amount: 600, created_date: '2026-09-30T12:00:00.001Z' },
    { id: 'b', amount: 600, created_date: '2026-09-30T12:00:00.002Z' },
  ];
  assert.deepEqual(orderPayments(rows).map((r) => r.id), ['a', 'b', 'c']);
  const { kept, overflow } = classifyPayments(rows, 100000);
  assert.deepEqual(kept.map((r) => r.id), ['a', 'c'], 'a later small payment still fits after an overflow is skipped');
  assert.deepEqual(overflow.map((r) => r.id), ['b']);
  // Seen without the later rows, the earlier ones classify the same way.
  assert.deepEqual(classifyPayments(rows.filter((r) => r.id !== 'c'), 100000).overflow.map((r) => r.id), ['b']);
});

test('entry.ts resolves the race after the insert and settles only after it', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../base44/functions/guardedEntityWrite/entry.ts', import.meta.url), 'utf8');
  const insert = src.indexOf('const created = await sr.entities[entity].create(data);');
  const race = src.indexOf('await resolvePaymentRace(sr, created, schoolId)');
  const settle = src.indexOf("settleAfterPayment(sr, data.charge_id, schoolId, now, { keptOnly: true })");
  assert.ok(insert > 0 && race > insert && settle > race, 'insert → resolve → settle');
});

// --- P2: manual reminder -------------------------------------------------------

function reminderStore(extra = {}) {
  return makeStore({
    ChargeItem: [{ id: 'ch1', school_id: 'sA', student_id: 'stu1', amount: 1000, amount_paid: 0, status: 'OVERDUE', due_date: '2026-09-01', reminder_sent: true, ...extra }],
  });
}

// One click on "Enviar recordatorio", as planPaymentDue + deliver run it.
async function clickRemind(db, sent, { reached = 1, claimId }) {
  const r = await claimChargeReminder(db, 'ch1', { manual: true, now: NOW, claimId, sleep: () => new Promise((res) => setTimeout(res, 5)) });
  if (!r.ok) return r.reason;
  sent.push(claimId);
  await releaseChargeReminder(db, r.claim, reached > 0);
  return 'sent';
}

test('two clicks at once on "Enviar recordatorio": the family is mailed once', async () => {
  const db = reminderStore();
  const sent = [];
  const out = await Promise.all([clickRemind(db, sent, { claimId: 'A' }), clickRemind(db, sent, { claimId: 'B' })]);
  assert.equal(sent.length, 1, JSON.stringify(out));
  assert.deepEqual(out.slice().sort(), ['in_progress', 'sent']);
  const charge = db.tables.ChargeItem[0];
  assert.equal(charge.last_reminder_at, NOW.toISOString());
  assert.equal(charge.reminder_claim_id, null, 'the claim is closed after a successful send');
});

test('a click while another send is in flight gets in_progress; one after it gets the cooldown', async () => {
  const db = reminderStore();
  const first = await claimChargeReminder(db, 'ch1', { manual: true, now: NOW, claimId: 'A', sleep: async () => {} });
  assert.equal(first.ok, true);
  const during = await claimChargeReminder(db, 'ch1', { manual: true, now: NOW, claimId: 'B', sleep: async () => {} });
  assert.deepEqual(during, { ok: false, reason: 'in_progress' });
  await releaseChargeReminder(db, first.claim, true);
  const after = await claimChargeReminder(db, 'ch1', { manual: true, now: NOW, claimId: 'C', sleep: async () => {} });
  assert.deepEqual(after, { ok: false, reason: 'cooldown' });
});

test('a send that reached nobody gives the claim back, so it can be retried now', async () => {
  const earlier = new Date(NOW.getTime() - 30 * 3600e3).toISOString();
  const db = reminderStore({ last_reminder_at: earlier });
  const sent = [];
  assert.equal(await clickRemind(db, sent, { claimId: 'A', reached: 0 }), 'sent');
  assert.equal(db.tables.ChargeItem[0].last_reminder_at, earlier, 'rolled back to the previous value');
  assert.equal(db.tables.ChargeItem[0].reminder_claim_id, null);
  assert.equal(await clickRemind(db, sent, { claimId: 'B' }), 'sent', 'retry allowed immediately');
});

test('a rollback never erases a claim that is no longer ours', async () => {
  const db = reminderStore();
  const a = await claimChargeReminder(db, 'ch1', { manual: true, now: NOW, claimId: 'A', sleep: async () => {} });
  // Someone else's claim lands afterwards (the stalled-rival residual).
  db.tables.ChargeItem[0].reminder_claim_id = 'B';
  await releaseChargeReminder(db, a.claim, false);
  assert.equal(db.tables.ChargeItem[0].reminder_claim_id, 'B');
  assert.equal(db.tables.ChargeItem[0].last_reminder_at, NOW.toISOString());
});

test('a stale claim (a crashed send) stops blocking after the TTL', async () => {
  const stale = new Date(NOW.getTime() - REMINDER_CLAIM_TTL_MS - 1000).toISOString();
  // Still inside the 24 h cooldown for a MANUAL reminder, so use the automatic
  // path's rule (reminder_sent false) to see the TTL on its own.
  const db = reminderStore({ reminder_claim_id: 'dead', last_reminder_at: stale, reminder_sent: false, status: 'PENDING', due_date: '2026-10-03' });
  const r = await claimChargeReminder(db, 'ch1', { manual: false, now: NOW, claimId: 'A', sleep: async () => {} });
  assert.equal(r.ok, true);
});

test('if the store drops reminder_claim_id (field not deployed yet), the verify falls back to last_reminder_at', async () => {
  const db = reminderStore();
  const update = db.entities.ChargeItem.update;
  db.entities.ChargeItem.update = (id, patch) => {
    const { reminder_claim_id: _drop, ...rest } = patch;
    return update(id, rest);
  };
  const r = await claimChargeReminder(db, 'ch1', { manual: true, now: NOW, claimId: 'A', sleep: async () => {} });
  assert.equal(r.ok, true);
});
