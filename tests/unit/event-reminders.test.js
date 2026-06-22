import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectEventsNeedingReminder, selectNonResponders } from '../../src/lib/events/reminder-selection.js';

const now = new Date('2026-06-22T15:30:00'); // mid-afternoon, local

test('selects only confirmation events whose deadline is 3 days out and not yet reminded', () => {
  const events = [
    { id: 'due', requires_confirmation: true, confirmation_deadline: '2026-06-25' },
    { id: 'already', requires_confirmation: true, confirmation_deadline: '2026-06-25', reminder_sent: true },
    { id: 'too-far', requires_confirmation: true, confirmation_deadline: '2026-06-27' },
    { id: 'too-soon', requires_confirmation: true, confirmation_deadline: '2026-06-23' },
    { id: 'no-deadline', requires_confirmation: true },
    { id: 'no-confirm', requires_confirmation: false, confirmation_deadline: '2026-06-25' },
  ];
  assert.deepEqual(selectEventsNeedingReminder(events, now).map((e) => e.id), ['due']);
});

test('day-granularity comparison is not thrown off by current time-of-day', () => {
  // Deadline is a date-only value; `now` carries a time. With naive
  // differenceInDays this would compute 2 and miss the day — startOfDay fixes it.
  const events = [{ id: 'due', requires_confirmation: true, confirmation_deadline: '2026-06-25' }];
  for (const t of ['2026-06-22T00:01:00', '2026-06-22T12:00:00', '2026-06-22T23:59:00']) {
    assert.equal(selectEventsNeedingReminder(events, new Date(t)).length, 1, `should select at ${t}`);
  }
});

test('handles empty / nullish input without throwing', () => {
  assert.deepEqual(selectEventsNeedingReminder(undefined, now), []);
  assert.deepEqual(selectEventsNeedingReminder([null], now), []);
});

test('selectNonResponders returns audience pairs with no matching response', () => {
  const audience = [
    { parentId: 'p1', studentId: 's1' },
    { parentId: 'p2', studentId: 's2' },
    { parentId: 'p3', studentId: 's3' },
  ];
  const responses = [
    { parent_id: 'p1', student_id: 's1', response: 'ACCEPTED' }, // responded
    { parent_id: 'p2', student_id: 's9', response: 'DECLINED' }, // different student → p2/s2 still pending
  ];
  assert.deepEqual(
    selectNonResponders(audience, responses).map((p) => `${p.parentId}/${p.studentId}`),
    ['p2/s2', 'p3/s3'],
  );
});

test('selectNonResponders tolerates empty inputs', () => {
  assert.deepEqual(selectNonResponders([], []), []);
  assert.deepEqual(selectNonResponders(undefined, undefined), []);
  assert.deepEqual(selectNonResponders([{ parentId: 'p1', studentId: 's1' }], []).length, 1);
});
