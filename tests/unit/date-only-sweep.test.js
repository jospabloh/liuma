// Run under Mexico's time zone: every bug this file guards against (a
// 'YYYY-MM-DD' field read as UTC midnight = the previous evening here) is
// invisible under UTC, which is what CI runners default to. node --test gives
// each file its own process, so this does not leak into other suites.
process.env.TZ = 'America/Mexico_City';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { selectEventsNeedingReminder } from '../../src/lib/events/reminder-selection.js';
import { partitionLinkedStudents } from '../../src/lib/relations/partitionLinkedStudents.js';

const ROOT = new URL('../../', import.meta.url);

test('the suite really runs at UTC-6 (otherwise the reminder test is vacuous)', () => {
  assert.equal(new Date(2026, 8, 15).getTimezoneOffset(), 360);
});

test('confirmation reminder fires 3 calendar days before a date-only deadline, in Mexico', () => {
  // With new Date('2026-06-25') the deadline read as June 24 18:00 local, the
  // day difference came out as 2 on the 22nd, so the reminder went out a day
  // early (on the 21st) instead of 3 days before the deadline.
  const events = [{ id: 'due', requires_confirmation: true, confirmation_deadline: '2026-06-25' }];
  for (const t of ['2026-06-22T00:01:00', '2026-06-22T12:00:00', '2026-06-22T23:59:00']) {
    assert.deepEqual(selectEventsNeedingReminder(events, new Date(t)).map((e) => e.id), ['due'], `at ${t}`);
  }
  // A malformed deadline is skipped, not treated as "Invalid Date" math.
  assert.deepEqual(
    selectEventsNeedingReminder([{ id: 'bad', requires_confirmation: true, confirmation_deadline: '2026-02-30' }], new Date('2026-02-27T10:00:00')),
    [],
  );
  // ...and it does not fire a day early any more (old code matched on the 21st).
  assert.deepEqual(selectEventsNeedingReminder(events, new Date('2026-06-21T12:00:00')), []);
});

test('batched linked-student lookup still reports orphaned links and keeps link order', () => {
  // getLinkedStudents now asks for every child in one `id: { $in }` query. A
  // batch can't fail per id, so a link whose student row is missing must be
  // detected by absence — otherwise a deleted child silently disappears from
  // the parent's app instead of being flagged.
  const rows = [
    { id: 's3', is_active: true },
    { id: 's1', is_active: true },
    { id: 's2', is_active: false },
  ];
  const result = partitionLinkedStudents(['s1', 's2', 's3', 'gone'], rows);
  assert.deepEqual(result.studentIds, ['s1', 's3']);
  assert.deepEqual(result.orphanedLinkIds, ['gone']);
  // Inactive is dropped but is not an orphan: the row exists.
  assert.ok(!result.orphanedLinkIds.includes('s2'));
});

test('withdrawn / non-ACTIVE enrollments are not shown as linked children', () => {
  const rows = [
    { id: 'a', status: 'WITHDRAWN' },
    { id: 'b', enrollment_status: 'GRADUATED' },
    { id: 'c' },
  ];
  assert.deepEqual(partitionLinkedStudents(['a', 'b', 'c'], rows).studentIds, ['c']);
  assert.deepEqual(partitionLinkedStudents(['a'], null).orphanedLinkIds, ['a']);
});

// ── Static guard: no new `new Date(x.<date-only field>)` in src/ ─────────────

const DATE_ONLY_FIELDS = [
  'date', 'due_date', 'absence_date', 'birth_date', 'valid_from', 'valid_until',
  'confirmation_deadline', 'payment_date', 'assigned_date', 'estimated_delivery',
];
const NATIVE_PARSE = new RegExp(
  String.raw`new Date\(\s*[\w.?]*\.(?:${DATE_ONLY_FIELDS.join('|')})\s*\)`,
);

// Files another fix package of the same pass is rewriting (P4 attendance and
// reports, P5 admin home/payments/setup). They carry the same defect and fix it
// there with parseLocalDate; drop each entry once its package merges.
const PENDING_IN_OTHER_PACKAGES = new Set([
  'src/components/home/AdminHome.jsx',
  'src/pages/PagosAdmin.jsx',
  'src/pages/GestionPedidosAdmin.jsx',
  'src/pages/ConfiguracionInicial.jsx',
  'src/pages/Asistencia.jsx',
  'src/pages/Reportes.jsx',
  'src/pages/GestionAlumno.jsx',
  'src/pages/AvisosAdmin.jsx',
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('date-only fields are never parsed with new Date(...) (they would render a day early)', () => {
  const srcDir = new URL('src/', ROOT).pathname;
  const offenders = [];
  for (const file of walk(srcDir)) {
    const rel = path.relative(new URL('.', ROOT).pathname, file).split(path.sep).join('/');
    if (rel === 'src/lib/dates.js' || PENDING_IN_OTHER_PACKAGES.has(rel)) continue;
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (NATIVE_PARSE.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], 'use parseLocalDate / isBeforeToday / isOnOrAfterToday from src/lib/dates.js');
});
