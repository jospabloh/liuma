// Run these under Mexico's time zone: the bug they guard against (a
// 'YYYY-MM-DD' field rendering one day early) is invisible under UTC, which is
// what CI runners default to. Node re-reads process.env.TZ on change, and
// node --test gives each file its own process, so this does not leak.
process.env.TZ = 'America/Mexico_City';

import test from 'node:test';
import assert from 'node:assert/strict';
import { format } from 'date-fns';
import {
  parseLocalDate,
  formatLocalDate,
  startOfLocalDay,
  isBeforeToday,
  isOnOrAfterToday,
} from '../../src/lib/dates.js';

test('the suite really runs at UTC-6 (otherwise every assertion below is vacuous)', () => {
  assert.equal(new Date(2026, 8, 15).getTimezoneOffset(), 360);
  // The original defect, reproduced: native parsing lands on the previous day.
  assert.equal(new Date('2026-09-15').getDate(), 14);
});

test('parseLocalDate keeps the calendar day the school entered', () => {
  const d = parseLocalDate('2026-09-15');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8);
  assert.equal(d.getDate(), 15);
  assert.equal(d.getHours(), 0);
  // What the UI actually does with it: format with date-fns.
  assert.equal(format(d, 'yyyy-MM-dd'), '2026-09-15');
});

test('parseLocalDate handles year and month boundaries without shifting', () => {
  assert.equal(formatLocalDate(parseLocalDate('2026-01-01')), '2026-01-01');
  assert.equal(formatLocalDate(parseLocalDate('2025-12-31')), '2025-12-31');
  assert.equal(formatLocalDate(parseLocalDate('2028-02-29')), '2028-02-29');
});

test('parseLocalDate rejects impossible or empty dates instead of rendering a wrong one', () => {
  assert.equal(parseLocalDate('2026-02-30'), null);
  assert.equal(parseLocalDate('2026-13-01'), null);
  assert.equal(parseLocalDate(''), null);
  assert.equal(parseLocalDate(null), null);
  assert.equal(parseLocalDate(undefined), null);
  assert.equal(parseLocalDate('not a date'), null);
  assert.equal(parseLocalDate(new Date('garbage')), null);
});

test('parseLocalDate leaves real timestamps (created_date) as the instant they are', () => {
  const d = parseLocalDate('2026-09-15T03:00:00.000Z');
  assert.equal(d.toISOString(), '2026-09-15T03:00:00.000Z');
  // 03:00Z is still the 14th in Mexico — correct for a timestamp.
  assert.equal(formatLocalDate(d), '2026-09-14');
});

test('parseLocalDate copies a Date rather than aliasing it', () => {
  const src = new Date(2026, 8, 15);
  const out = parseLocalDate(src);
  assert.notEqual(out, src);
  assert.equal(out.getTime(), src.getTime());
});

test('formatLocalDate uses the local day, not the UTC day (after 18:00 toISOString is already tomorrow)', () => {
  const evening = new Date(2026, 8, 15, 20, 30); // 20:30 local = 02:30Z on the 16th
  assert.equal(evening.toISOString().slice(0, 10), '2026-09-16');
  assert.equal(formatLocalDate(evening), '2026-09-15');
  assert.equal(formatLocalDate(null), '');
  assert.equal(formatLocalDate('2026-02-30'), '');
});

test('startOfLocalDay truncates to local midnight', () => {
  const d = startOfLocalDay(new Date(2026, 8, 15, 23, 59));
  assert.equal(d.getTime(), new Date(2026, 8, 15).getTime());
  assert.equal(startOfLocalDay('bad'), null);
});

test('a charge due today is not overdue, even late in the evening', () => {
  const now = new Date(2026, 8, 15, 21, 0);
  assert.equal(isBeforeToday('2026-09-15', now), false);
  assert.equal(isBeforeToday('2026-09-14', now), true);
  assert.equal(isBeforeToday('2026-09-16', now), false);
  // Contrast with the old expression, which flagged it overdue:
  assert.equal(new Date('2026-09-15') < now, true);
});

test('an event dated today still shows as upcoming all day', () => {
  const morning = new Date(2026, 8, 15, 8, 0);
  const night = new Date(2026, 8, 15, 23, 30);
  assert.equal(isOnOrAfterToday('2026-09-15', morning), true);
  assert.equal(isOnOrAfterToday('2026-09-15', night), true);
  assert.equal(isOnOrAfterToday('2026-09-14', morning), false);
  assert.equal(isOnOrAfterToday('2026-09-20', night), true);
  // The old expression dropped today's event from "upcoming":
  assert.equal(new Date('2026-09-15') >= morning, false);
});

test('comparison helpers treat invalid input as neither overdue nor upcoming', () => {
  assert.equal(isBeforeToday('', new Date()), false);
  assert.equal(isOnOrAfterToday(null, new Date()), false);
});
