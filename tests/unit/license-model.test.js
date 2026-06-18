import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_TIERS, PLAN_LIMITS, PLAN_CATALOG, TRIAL_DURATION_DAYS,
  planRank, planLabel, isReadOnlyStatus, currentPeriod, computeTrialDaysLeft,
  calculateExpiry, normalizeSubscription, buildTrialSubscription,
  buildActivationUpdate, buildPaymentConfirmationUpdate,
} from '../../src/lib/license/licenseModel.js';

test('tiers are ordered start < growth < plus and limits track the catalog', () => {
  assert.deepEqual(PLAN_TIERS, ['start', 'growth', 'plus']);
  assert.equal(planRank('start'), 0);
  assert.equal(planRank('growth'), 1);
  assert.equal(planRank('plus'), 2);
  assert.equal(planRank('unknown'), 0);
  assert.equal(PLAN_LIMITS.start, PLAN_CATALOG.start.studentLimit);
  assert.equal(PLAN_LIMITS.plus, null);
});

test('planLabel maps to public names', () => {
  assert.equal(planLabel('growth'), 'LIUMA Growth');
  assert.equal(planLabel(undefined), '—');
});

test('read-only statuses block writes; trial/active do not', () => {
  for (const s of ['view_only', 'suspended', 'inactive', 'canceled']) {
    assert.equal(isReadOnlyStatus(s), true, s);
  }
  assert.equal(isReadOnlyStatus('trial'), false);
  assert.equal(isReadOnlyStatus('active'), false);
});

test('computeTrialDaysLeft is clamped at 0 and null without a date', () => {
  const now = new Date('2026-06-10T00:00:00Z');
  assert.equal(computeTrialDaysLeft('2026-06-15T00:00:00Z', now), 5);
  assert.equal(computeTrialDaysLeft('2026-06-01T00:00:00Z', now), 0);
  assert.equal(computeTrialDaysLeft(null, now), null);
});

test('currentPeriod formats YYYY-MM', () => {
  assert.equal(currentPeriod(new Date('2026-06-18T12:00:00Z')), '2026-06');
  assert.equal(currentPeriod(new Date('2026-01-02T12:00:00Z')), '2026-01');
});

test('calculateExpiry never shortens an active license and lands on the 1st', () => {
  const now = new Date('2026-06-18T12:00:00Z');
  // No prior expiry → extend from now, land on 1st of next month.
  const fromNow = new Date(calculateExpiry(null, 1, now));
  assert.equal(fromNow.getDate(), 1);
  assert.equal(fromNow.getMonth(), 6); // July (0-indexed)

  // Future expiry → extend from that future date, not from now.
  const future = '2026-09-01T00:00:00Z';
  const extended = new Date(calculateExpiry(future, 1, now));
  assert.equal(extended.getMonth(), 9); // October
  assert.equal(extended.getDate(), 1);
});

test('buildTrialSubscription seeds a 30-day trial with tier and limit', () => {
  const now = new Date('2026-06-18T00:00:00Z');
  const sub = buildTrialSubscription('school-1', now);
  assert.equal(sub.school_id, 'school-1');
  assert.equal(sub.subscription_status, 'trial');
  assert.equal(sub.license_tier, 'start');
  assert.equal(sub.licensed_student_limit, PLAN_LIMITS.start);
  const end = new Date(sub.trial_end_date);
  const days = Math.round((end - now) / 86400000);
  assert.equal(days, TRIAL_DURATION_DAYS);
});

test('normalizeSubscription exposes UI shape and read-only flag', () => {
  const now = new Date('2026-06-10T00:00:00Z');
  const norm = normalizeSubscription({
    id: 's1', school_id: 'sch', subscription_status: 'view_only', license_tier: 'growth',
    licensed_student_limit: 400, trial_end_date: '2026-06-15T00:00:00Z',
  }, now);
  assert.equal(norm.exists, true);
  assert.equal(norm.isReadOnly, true);
  assert.equal(norm.licenseTier, 'growth');
  assert.equal(norm.trialDaysLeft, null); // only computed while status === 'trial'

  const empty = normalizeSubscription(null);
  assert.equal(empty.exists, false);
  assert.equal(empty.licenseTier, 'start');
});

test('buildActivationUpdate sets activation metadata and derives the limit', () => {
  const now = new Date('2026-06-18T00:00:00Z');
  const update = buildActivationUpdate({
    subscription_status: 'active', license_tier: 'plus',
    activation_notes: 'manual', adminEmail: 'owner@acaciaco.com.mx', now,
  });
  assert.equal(update.subscription_status, 'active');
  assert.equal(update.license_tier, 'plus');
  assert.equal(update.licensed_student_limit, PLAN_LIMITS.plus); // null = unlimited
  assert.equal(update.activated_by_admin, 'owner@acaciaco.com.mx');
  assert.equal(update.license_activated_at, now.toISOString());
  assert.throws(() => buildActivationUpdate({ license_tier: 'bogus' }), /Tier inválido/);
});

test('buildPaymentConfirmationUpdate activates, records payment, computes expiry', () => {
  const now = new Date('2026-06-18T00:00:00Z');
  const update = buildPaymentConfirmationUpdate({
    subscription: { license_expires_at: null, license_tier: 'start' },
    license_tier: 'growth',
    payment_period: '2026-06',
    payment_reference: 'MP-123',
    auto_renewal: true,
    adminEmail: 'owner@acaciaco.com.mx',
    now,
  });
  assert.equal(update.subscription_status, 'active');
  assert.equal(update.license_tier, 'growth');
  assert.equal(update.last_payment_period, '2026-06');
  assert.equal(update.last_payment_reference, 'MP-123');
  assert.equal(update.payment_reference, 'MP-123');
  assert.equal(update.auto_renewal, true);
  assert.equal(new Date(update.license_expires_at).getDate(), 1);
  assert.throws(() => buildPaymentConfirmationUpdate({ payment_period: '' }), /payment_period/);
});
