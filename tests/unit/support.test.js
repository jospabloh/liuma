import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSupportRouting, isPlatformCategory } from '../../src/lib/support/routing.js';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_TIER,
  SUPPORT_AUTHOR_ROLE,
  SUPPORT_STATUS,
  SUPPORT_PRIORITIES,
} from '../../src/lib/support/constants.js';
import { addBusinessDays, computeSlaDueAt, isSlaBreached, SLA_BUSINESS_DAYS } from '../../src/lib/support/sla.js';
import { generateTicketNumber, parseTicketNumber } from '../../src/lib/support/ticketNumber.js';
import { canTransition, assertTransition } from '../../src/lib/support/statusMachine.js';

// --- Routing (two-tier) ---------------------------------------------------

test('parent academic question routes to the school director', () => {
  const r = resolveSupportRouting({ requesterRole: 'PARENT', category: SUPPORT_CATEGORIES.ACADEMIC });
  assert.equal(r.tier, SUPPORT_TIER.SCHOOL_ADMIN);
  assert.equal(r.assigneeRole, SUPPORT_AUTHOR_ROLE.SCHOOL_ADMIN);
});

test('parent technical and billing issues escalate to the platform owner', () => {
  for (const category of [SUPPORT_CATEGORIES.TECHNICAL, SUPPORT_CATEGORIES.BILLING]) {
    const r = resolveSupportRouting({ requesterRole: 'PARENT', category });
    assert.equal(r.tier, SUPPORT_TIER.PLATFORM);
    assert.equal(r.assigneeRole, SUPPORT_AUTHOR_ROLE.OWNER);
  }
});

test('teacher payment question stays with the school', () => {
  const r = resolveSupportRouting({ requesterRole: 'TEACHER', category: SUPPORT_CATEGORIES.PAYMENTS });
  assert.equal(r.tier, SUPPORT_TIER.SCHOOL_ADMIN);
});

test('a director (ADMIN) own ticket always goes to the platform owner', () => {
  const r = resolveSupportRouting({ requesterRole: 'ADMIN', category: SUPPORT_CATEGORIES.ACADEMIC });
  assert.equal(r.tier, SUPPORT_TIER.PLATFORM);
  assert.equal(r.assigneeRole, SUPPORT_AUTHOR_ROLE.OWNER);
});

test('missing category defaults to the school tier', () => {
  const r = resolveSupportRouting({ requesterRole: 'PARENT' });
  assert.equal(r.tier, SUPPORT_TIER.SCHOOL_ADMIN);
});

test('isPlatformCategory flags only app-level categories', () => {
  assert.equal(isPlatformCategory(SUPPORT_CATEGORIES.TECHNICAL), true);
  assert.equal(isPlatformCategory(SUPPORT_CATEGORIES.ACADEMIC), false);
});

// --- SLA (relaxed, business days) -----------------------------------------

// 2026-01-01 is a Thursday (UTC).
const THURSDAY = new Date('2026-01-01T09:00:00Z');

test('addBusinessDays skips weekends', () => {
  // Thu +2 business days -> Mon 2026-01-05 (skips Sat 3, Sun 4).
  assert.equal(addBusinessDays(THURSDAY, 2).toISOString(), '2026-01-05T09:00:00.000Z');
});

test('relaxed SLA targets are URGENT 1 / HIGH 2 / NORMAL 3 / LOW 5', () => {
  assert.equal(SLA_BUSINESS_DAYS.URGENT, 1);
  assert.equal(SLA_BUSINESS_DAYS.HIGH, 2);
  assert.equal(SLA_BUSINESS_DAYS.NORMAL, 3);
  assert.equal(SLA_BUSINESS_DAYS.LOW, 5);
});

test('computeSlaDueAt honors priority and weekends', () => {
  assert.equal(computeSlaDueAt({ priority: SUPPORT_PRIORITIES.URGENT, from: THURSDAY }), '2026-01-02T09:00:00.000Z');
  assert.equal(computeSlaDueAt({ priority: SUPPORT_PRIORITIES.NORMAL, from: THURSDAY }), '2026-01-06T09:00:00.000Z');
  assert.equal(computeSlaDueAt({ priority: SUPPORT_PRIORITIES.LOW, from: THURSDAY }), '2026-01-08T09:00:00.000Z');
});

test('unknown priority falls back to the NORMAL target', () => {
  assert.equal(computeSlaDueAt({ priority: 'WHATEVER', from: THURSDAY }), computeSlaDueAt({ priority: 'NORMAL', from: THURSDAY }));
});

test('isSlaBreached is true only for an open, past-due, un-responded ticket', () => {
  const slaDueAt = '2026-01-02T09:00:00.000Z';
  const now = new Date('2026-01-05T09:00:00Z');
  assert.equal(isSlaBreached({ slaDueAt, status: SUPPORT_STATUS.ESCALATED, now }), true);
  assert.equal(isSlaBreached({ slaDueAt, status: SUPPORT_STATUS.RESOLVED, now }), false);
  assert.equal(isSlaBreached({ slaDueAt, status: SUPPORT_STATUS.ESCALATED, firstResponseAt: '2026-01-01T10:00:00Z', now }), false);
  assert.equal(isSlaBreached({ slaDueAt, status: SUPPORT_STATUS.ESCALATED, now: new Date('2026-01-01T10:00:00Z') }), false);
});

// --- Ticket numbers -------------------------------------------------------

test('generateTicketNumber zero-pads the per-year sequence', () => {
  assert.equal(generateTicketNumber({ sequence: 42, date: new Date('2026-03-01T00:00:00Z') }), 'LIUMA-2026-000042');
});

test('parseTicketNumber round-trips a valid number and rejects junk', () => {
  assert.deepEqual(parseTicketNumber('LIUMA-2026-000042'), { prefix: 'LIUMA', year: 2026, sequence: 42 });
  assert.equal(parseTicketNumber('not-a-ticket'), null);
});

// --- Status machine -------------------------------------------------------

test('valid lifecycle transitions are allowed', () => {
  assert.equal(canTransition(SUPPORT_STATUS.OPEN, SUPPORT_STATUS.ESCALATED), true);
  assert.equal(canTransition(SUPPORT_STATUS.ESCALATED, SUPPORT_STATUS.IN_PROGRESS), true);
  assert.equal(canTransition(SUPPORT_STATUS.RESOLVED, SUPPORT_STATUS.IN_PROGRESS), true); // reopen
});

test('illegal transitions are rejected', () => {
  assert.equal(canTransition(SUPPORT_STATUS.CLOSED, SUPPORT_STATUS.IN_PROGRESS), false);
  const result = assertTransition(SUPPORT_STATUS.CLOSED, SUPPORT_STATUS.OPEN);
  assert.equal(result.valid, false);
  assert.match(result.reason, /Invalid support status transition/);
});
