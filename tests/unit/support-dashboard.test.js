import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPendingTicket, filterPendingTickets, priorityRank, compareTickets,
  groupByCategory, groupByPriority, summarizePending,
  PRIORITY_ORDER, CATEGORY_ORDER,
} from '../../src/lib/support/dashboard.js';

const NOW = new Date('2026-06-18T12:00:00Z');

function ticket(overrides = {}) {
  return {
    id: overrides.id || Math.random().toString(36).slice(2),
    category: 'OTHER',
    priority: 'NORMAL',
    status: 'ESCALATED',
    sla_due_at: null,
    first_response_at: null,
    created_date: '2026-06-10T00:00:00Z',
    ...overrides,
  };
}

test('isPendingTicket excludes terminal statuses', () => {
  assert.equal(isPendingTicket(ticket({ status: 'OPEN' })), true);
  assert.equal(isPendingTicket(ticket({ status: 'ESCALATED' })), true);
  assert.equal(isPendingTicket(ticket({ status: 'IN_PROGRESS' })), true);
  assert.equal(isPendingTicket(ticket({ status: 'WAITING_USER' })), true);
  for (const s of ['AI_RESOLVED', 'RESOLVED', 'CLOSED']) {
    assert.equal(isPendingTicket(ticket({ status: s })), false, s);
  }
});

test('filterPendingTickets drops resolved/closed tickets', () => {
  const list = [
    ticket({ status: 'OPEN' }),
    ticket({ status: 'RESOLVED' }),
    ticket({ status: 'CLOSED' }),
    ticket({ status: 'IN_PROGRESS' }),
  ];
  assert.equal(filterPendingTickets(list).length, 2);
});

test('priorityRank orders urgent highest', () => {
  assert.equal(priorityRank('URGENT'), 0);
  assert.ok(priorityRank('URGENT') < priorityRank('HIGH'));
  assert.ok(priorityRank('HIGH') < priorityRank('NORMAL'));
  assert.ok(priorityRank('NORMAL') < priorityRank('LOW'));
  assert.equal(priorityRank('UNKNOWN'), PRIORITY_ORDER.length);
});

test('compareTickets sorts by priority, then breach, then SLA, then age', () => {
  const urgent = ticket({ id: 'u', priority: 'URGENT' });
  const normal = ticket({ id: 'n', priority: 'NORMAL' });
  assert.ok(compareTickets(urgent, normal, NOW) < 0);

  // Same priority: breached (past SLA, no first response) comes first.
  const breached = ticket({ id: 'b', priority: 'NORMAL', sla_due_at: '2026-06-17T00:00:00Z' });
  const healthy = ticket({ id: 'h', priority: 'NORMAL', sla_due_at: '2026-06-20T00:00:00Z' });
  assert.ok(compareTickets(breached, healthy, NOW) < 0);
});

test('groupByCategory returns non-empty groups in CATEGORY_ORDER, triage-sorted', () => {
  const list = [
    ticket({ id: 'a', category: 'OTHER', priority: 'LOW' }),
    ticket({ id: 'b', category: 'TECHNICAL', priority: 'URGENT' }),
    ticket({ id: 'c', category: 'TECHNICAL', priority: 'NORMAL' }),
    ticket({ id: 'd', category: 'ACADEMIC', priority: 'HIGH' }),
    ticket({ id: 'x', category: 'ACADEMIC', priority: 'HIGH', status: 'CLOSED' }), // excluded
  ];
  const groups = groupByCategory(list, NOW);
  assert.deepEqual(groups.map((g) => g.key), ['ACADEMIC', 'TECHNICAL', 'OTHER']);
  // Within TECHNICAL, urgent before normal.
  const technical = groups.find((g) => g.key === 'TECHNICAL');
  assert.deepEqual(technical.tickets.map((t) => t.id), ['b', 'c']);
  // Closed ticket not present anywhere.
  assert.equal(groups.some((g) => g.tickets.some((t) => t.id === 'x')), false);
});

test('groupByPriority returns non-empty groups in PRIORITY_ORDER', () => {
  const list = [
    ticket({ priority: 'LOW' }),
    ticket({ priority: 'URGENT' }),
    ticket({ priority: 'URGENT' }),
  ];
  const groups = groupByPriority(list, NOW);
  assert.deepEqual(groups.map((g) => g.key), ['URGENT', 'LOW']);
  assert.equal(groups[0].tickets.length, 2);
});

test('summarizePending counts total, urgent and breached', () => {
  const list = [
    ticket({ priority: 'URGENT' }),
    ticket({ priority: 'NORMAL', sla_due_at: '2026-06-17T00:00:00Z' }), // breached
    ticket({ priority: 'LOW', status: 'RESOLVED' }), // excluded
  ];
  const s = summarizePending(list, NOW);
  assert.equal(s.total, 2);
  assert.equal(s.urgent, 1);
  assert.equal(s.breached, 1);
});

test('exposed orders cover all categories and priorities', () => {
  assert.equal(CATEGORY_ORDER.length, 6);
  assert.equal(PRIORITY_ORDER.length, 4);
});
