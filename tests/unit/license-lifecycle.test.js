// License lifecycle inside LIUMA (audit F10, owner decision 2026-09-29):
// a missing or expired license FAILS CLOSED to read-only, the school is warned
// BEFORE (7 days, urgent at 3) and AFTER expiry, and every notice for an admin
// carries a way to pay.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ALL_LICENSE_TIERS,
  PLAN_LIMITS,
  UPCOMING_NOTICE_DAYS,
  effectiveStudentLimit,
  licenseNotice,
  normalizeSubscription,
  planLabel,
  resolveEffectiveLicense,
} from '../../src/lib/license/licenseModel.js';
import { licenseNoticeCopy } from '../../src/lib/license/licenseNoticeCopy.js';
import { licensePaymentAction } from '../../src/lib/license/billingContact.js';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const now = new Date('2026-09-29T12:00:00Z');
const inDays = (d) => new Date(now.getTime() + d * 86_400_000).toISOString();

test('no subscription row is read-only, not free forever', () => {
  // Production had 0 SchoolSubscription rows: every school wrote with no license.
  assert.deepEqual(resolveEffectiveLicense(null, now), { status: 'missing', isReadOnly: true, reason: 'missing' });
  assert.equal(normalizeSubscription(null, now).isReadOnly, true);
});

test('a trial past its end date is read-only — nothing else in the portfolio ends a trial', () => {
  const expired = { subscription_status: 'trial', trial_end_date: inDays(-1) };
  assert.deepEqual(resolveEffectiveLicense(expired, now), { status: 'view_only', isReadOnly: true, reason: 'trial_expired' });
  assert.equal(resolveEffectiveLicense({ subscription_status: 'trial', trial_end_date: inDays(3) }, now).isReadOnly, false);
  // A malformed trial must not become an endless one.
  assert.equal(resolveEffectiveLicense({ subscription_status: 'trial' }, now).isReadOnly, true);
});

test('Mission Control statuses are honoured; a paid license keeps writing through MC\'s grace period', () => {
  for (const s of ['view_only', 'suspended', 'inactive', 'canceled']) {
    assert.equal(resolveEffectiveLicense({ subscription_status: s }, now).isReadOnly, true, s);
  }
  const overdue = { subscription_status: 'active', license_expires_at: inDays(-2) };
  assert.deepEqual(resolveEffectiveLicense(overdue, now), { status: 'active', isReadOnly: false, reason: 'active_overdue' });
});

test('the founder tier Mission Control assigns is recognised and never expires by date', () => {
  assert.ok(ALL_LICENSE_TIERS.includes('founder'));
  const schema = JSON.parse(read('base44/entities/SchoolSubscription.jsonc'));
  assert.deepEqual(schema.properties.license_tier.enum, ALL_LICENSE_TIERS);
  const founder = { subscription_status: 'active', license_tier: 'founder', license_expires_at: inDays(-400) };
  assert.equal(resolveEffectiveLicense(founder, now).isReadOnly, false);
  assert.equal(licenseNotice(founder, now), null);
  assert.equal(PLAN_LIMITS.founder, null);
  assert.equal(effectiveStudentLimit('founder', 'active'), null, 'not capped as Start');
  assert.equal(planLabel('founder'), 'LIUMA Fundador');
  // ...but MC can still suspend a founder school.
  assert.equal(resolveEffectiveLicense({ ...founder, subscription_status: 'suspended' }, now).isReadOnly, true);
});

test('notices start 7 days before expiry and turn urgent at 3', () => {
  assert.equal(UPCOMING_NOTICE_DAYS, 7);
  const trial = (d) => licenseNotice({ subscription_status: 'trial', trial_end_date: inDays(d) }, now);
  assert.equal(trial(10), null);
  assert.deepEqual([trial(7).kind, trial(7).tone, trial(7).daysLeft], ['trial_ending', 'warning', 7]);
  assert.equal(trial(3).tone, 'danger');

  const paid = (d, extra = {}) => licenseNotice({ subscription_status: 'active', license_expires_at: inDays(d), ...extra }, now);
  assert.equal(paid(20), null);
  assert.equal(paid(5).kind, 'renewal_upcoming');
  assert.equal(paid(5, { auto_renewal: true }), null, 'Mercado Pago auto-charges on the 1st; MC mails that');
  assert.equal(paid(-1).kind, 'active_overdue');
});

test('after expiry the notice says read-only; no license and suspension say so too', () => {
  assert.equal(licenseNotice({ subscription_status: 'trial', trial_end_date: inDays(-1) }, now).kind, 'read_only');
  assert.equal(licenseNotice({ subscription_status: 'view_only' }, now).kind, 'read_only');
  assert.equal(licenseNotice({ subscription_status: 'suspended' }, now).kind, 'suspended');
  assert.equal(licenseNotice(null, now).kind, 'missing');
});

test('only the school admin gets the pay button; everyone else is told who can pay', () => {
  const kinds = [
    licenseNotice({ subscription_status: 'trial', trial_end_date: inDays(2) }, now),
    licenseNotice({ subscription_status: 'active', license_expires_at: inDays(2) }, now),
    licenseNotice({ subscription_status: 'active', license_expires_at: inDays(-2) }, now),
    licenseNotice({ subscription_status: 'trial', trial_end_date: inDays(-2) }, now),
    licenseNotice({ subscription_status: 'suspended' }, now),
    licenseNotice(null, now),
  ];
  for (const notice of kinds) {
    const admin = licenseNoticeCopy(notice, { isAdmin: true });
    const teacher = licenseNoticeCopy(notice, { isAdmin: false });
    assert.equal(admin.showPay, true, `${notice.kind}: admin must have a way to pay`);
    assert.equal(teacher.showPay, false, `${notice.kind}: a teacher cannot pay`);
    assert.ok(admin.title && admin.body);
  }
  assert.match(licenseNoticeCopy(kinds[3], { isAdmin: true }).title, /prueba/);
  assert.match(licenseNoticeCopy(kinds[3], { isAdmin: false }).body, /dirección/);
});

test('the pay button is the Mercado Pago link when configured, WhatsApp to ACACIA otherwise', () => {
  const mp = licensePaymentAction({ paymentUrl: 'https://mpago.la/abc' });
  assert.deepEqual(mp, { href: 'https://mpago.la/abc', label: 'Pagar con Mercado Pago', isMercadoPago: true });
  const fallback = licensePaymentAction({ schoolName: 'Colegio X', paymentUrl: null });
  assert.equal(fallback.isMercadoPago, false);
  assert.match(fallback.href, /^https:\/\/wa\.me\/524498958291\?text=/);
  assert.match(decodeURIComponent(fallback.href), /Colegio X/);
});

test('the server write gate fails closed too — guardedEntityWrite and getMySubscription mirror the rule', () => {
  const gate = read('base44/functions/guardedEntityWrite/entry.ts');
  assert.doesNotMatch(gate, /if \(sub && READ_ONLY_STATUSES/, 'the old gate skipped schools with no subscription');
  // The only carve-out is P7's ADMIN emergency Notice (child safety is not
  // gated on billing); everything else goes through the fail-closed rule.
  assert.match(gate, /if \(!isEmergencyAlert && effectiveLicenseIsReadOnly\(sub, new Date\(\)\)\)/);
  assert.match(gate, /const isEmergencyAlert = entity === 'Notice' && operation === 'create'\s+&& profile\.app_role === 'ADMIN' && body\?\.data\?\.is_emergency === true;/);
  assert.match(gate, /if \(!sub\) return true;/);
  assert.match(gate, /status === 'trial'[\s\S]{0,160}Number\.isNaN\(end\) \|\| end <= now\.getTime\(\)/);
  assert.match(gate, /license_tier === 'founder'\) return false/);

  const read_ = read('base44/functions/getMySubscription/entry.ts');
  assert.match(read_, /if \(!sub\) return \{ status: 'missing', isReadOnly: true, reason: 'missing' \};/);
  assert.match(read_, /reason: 'trial_expired'/);
  assert.match(read_, /READ_ONLY_STATUSES = \['view_only', 'suspended', 'inactive', 'canceled'\]/);
});

test('useSubscription fails closed and lets the server\'s verdict win', () => {
  const hook = read('src/hooks/useSubscription.js');
  assert.match(hook, /const isReadOnly = effective \? Boolean\(effective\.isReadOnly\) : license\.isReadOnly;/);
});
