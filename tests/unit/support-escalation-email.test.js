import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeSlaDueAt, selectTicketsToAutoEscalate } from '../../src/lib/support/sla.js';
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

// ---- L1 → L2 handoff: director (SCHOOL_ADMIN) → soporte (PLATFORM) ----

const NOW = new Date('2026-06-22T12:00:00.000Z');
const PAST = new Date('2026-06-20T12:00:00.000Z').toISOString(); // SLA already lapsed
const FUTURE = new Date('2026-06-30T12:00:00.000Z').toISOString();

test('auto-escalation selects only breached director-tier tickets', () => {
  const tickets = [
    { id: 'a', tier: SUPPORT_TIER.SCHOOL_ADMIN, status: 'ESCALATED', sla_due_at: PAST, first_response_at: null },
    { id: 'b', tier: SUPPORT_TIER.SCHOOL_ADMIN, status: 'ESCALATED', sla_due_at: FUTURE, first_response_at: null }, // not due yet
    { id: 'c', tier: SUPPORT_TIER.SCHOOL_ADMIN, status: 'IN_PROGRESS', sla_due_at: PAST, first_response_at: PAST }, // director responded
    { id: 'd', tier: SUPPORT_TIER.PLATFORM, status: 'ESCALATED', sla_due_at: PAST, first_response_at: null }, // already with soporte
    { id: 'e', tier: SUPPORT_TIER.SCHOOL_ADMIN, status: 'RESOLVED', sla_due_at: PAST, first_response_at: null }, // terminal
  ];
  const due = selectTicketsToAutoEscalate(tickets, NOW).map((t) => t.id);
  assert.deepEqual(due, ['a']);
});

test('auto-escalation tolerates empty / non-array input', () => {
  assert.deepEqual(selectTicketsToAutoEscalate(null, NOW), []);
  assert.deepEqual(selectTicketsToAutoEscalate([], NOW), []);
});

test('escalateTicketToSupport re-tiers to PLATFORM with a fresh 48h SLA and emails soporte', () => {
  const source = read('src/lib/support/tickets.js');
  assert.match(source, /export async function escalateTicketToSupport/);
  assert.match(source, /tier: SUPPORT_TIER\.PLATFORM/);
  assert.match(source, /computeSlaDueAt\(\{ priority: ticket\.priority, tier: SUPPORT_TIER\.PLATFORM/);
  assert.match(source, /first_response_at: null/);
  // routes through notifyAssignees, which emails SUPPORT_EMAIL on PLATFORM tier
  assert.match(source, /notifyAssignees\(\{[\s\S]*tier: SUPPORT_TIER\.PLATFORM/);
  // guards: no double-escalation, no escalating terminal tickets
  assert.match(source, /ticket\.tier === SUPPORT_TIER\.PLATFORM\) return ticket/);
  assert.match(source, /TERMINAL_STATUSES\.includes\(ticket\.status\)/);
});

test('director queue wires both manual and automatic escalation', () => {
  const source = read('src/pages/SoporteAdmin.jsx');
  assert.match(source, /handleEscalateToSupport/);
  assert.match(source, /autoEscalateBreachedTickets/);
  assert.match(source, /Escalar a soporte/);
  // manual button is director-only (hidden for owners) and school-tier only
  assert.match(source, /!isOwner[\s\S]*activeTicket\.tier === SUPPORT_TIER\.SCHOOL_ADMIN/);
});
