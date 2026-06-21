import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeSlaDueAt } from '../../src/lib/support/sla.js';
import { SUPPORT_TIER, SUPPORT_EMAIL, PLATFORM_SLA_HOURS } from '../../src/lib/support/constants.js';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// Support escalation model: L0 Lumi/manual → L1 director (SCHOOL_ADMIN tier) →
// L2 platform owner "soporte" (PLATFORM tier), notified by an automated email
// with a 48-hour SLA.

test('Tier-2 support inbox is the ACACIA support address', () => {
  assert.equal(SUPPORT_EMAIL, 'soporte@acaciaco.com.mx');
  assert.equal(PLATFORM_SLA_HOURS, 48);
});

test('PLATFORM-tier tickets get a fixed 48-hour SLA', () => {
  const from = new Date('2026-06-15T10:00:00.000Z'); // a Monday
  const due = new Date(computeSlaDueAt({ priority: 'NORMAL', tier: SUPPORT_TIER.PLATFORM, from }));
  assert.equal(due.getTime() - from.getTime(), 48 * 60 * 60 * 1000);
});

test('non-platform tickets keep the priority-based business-day SLA', () => {
  const from = new Date('2026-06-15T10:00:00.000Z');
  const platform = computeSlaDueAt({ priority: 'NORMAL', tier: SUPPORT_TIER.PLATFORM, from });
  const school = computeSlaDueAt({ priority: 'NORMAL', tier: SUPPORT_TIER.SCHOOL_ADMIN, from });
  assert.notEqual(platform, school);
});

test('ticket creation emails the fixed support inbox on PLATFORM escalation', () => {
  const source = read('src/lib/support/tickets.js');
  // notifyAssignees emails SUPPORT_EMAIL when the ticket escalates to the platform tier.
  assert.match(source, /tier === SUPPORT_TIER\.PLATFORM/);
  assert.match(source, /sendEventEmailTo\(\{[\s\S]*email: SUPPORT_EMAIL/);
  // SLA is computed with the routing tier so platform tickets get 48h.
  assert.match(source, /computeSlaDueAt\(\{ priority, tier: routing\.tier \}\)/);
});

test('notification service can email a templated message to a fixed address', () => {
  const source = read('src/lib/notifications/service.js');
  assert.match(source, /async sendEventEmailTo\(/);
  assert.match(source, /NOTIFICATION_TEMPLATES\[eventType\]/);
});
