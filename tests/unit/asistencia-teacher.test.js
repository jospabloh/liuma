import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../../src/pages/Asistencia.jsx', import.meta.url), 'utf8');

test("teacher classroom lookup filters on `id` — Base44 silently ignores `_id`", () => {
  // With `_id` the query returned no classroom, so every teacher saw an empty
  // salón selector and could not take attendance at all.
  assert.doesNotMatch(page, /[{\s]_id: \{ \$in/);
  assert.match(page, /schoolRead\('Classroom', \{ id: \{ \$in: classroomIds \}/);
});

test('each empty case says what is actually wrong', () => {
  for (const title of ['No tienes salones asignados', 'Selecciona un salón', 'No hay alumnos en este salón', 'No se pudo cargar la lista de alumnos']) {
    assert.ok(page.includes(title), `missing empty state: ${title}`);
  }
});

test('saving one mark locks only that row, not the whole class', () => {
  // The old `disabled={markAttendanceMutation.isPending}` froze all 25 rows
  // for every tap, so a teacher waited 25 round trips in sequence.
  assert.doesNotMatch(page, /disabled=\{markAttendanceMutation\.isPending/);
  assert.match(page, /const rowPending = isRowPending\(student\.id\)/);
  // Keyed by salón + fecha + alumno, so changing the date mid-save does not
  // lock the same child on the new date.
  assert.match(page, /pendingRowKey\(key\[1\], key\[2\], studentId\)/);
  assert.match(page, /onMutate:/);
  assert.match(page, /onError:/);
});

test('status buttons show a visible label, not only an icon', () => {
  assert.match(page, /\{cfg\.shortLabel\}/);
  assert.doesNotMatch(page, /<span className="sr-only">\{cfg\.label\}<\/span>/);
});

test('status tints have dark-theme variants and statuses come from the shared enum', () => {
  for (const tint of ['bg-green-50 dark:', 'bg-red-50 dark:', 'bg-amber-50 dark:', 'bg-blue-50 dark:']) {
    assert.ok(page.includes(tint), `missing dark variant for ${tint}`);
  }
  assert.match(page, /from '@\/lib\/attendance\/status'/);
  assert.doesNotMatch(page, /new Date\(record\.date\)/);
});

test('a failed mark rolls back only its own row, not marks saved meanwhile', () => {
  // Restoring a whole-list snapshot erased other rows' saved records from the
  // cache, and the next tap on them created a duplicate Attendance record.
  assert.doesNotMatch(page, /setQueryData\(key, context\.previous\)/);
  assert.match(page, /context\?\.previousRecord/);
});

test('bulk "todos presentes" counts only rejected writes as failures and caches the new ids', () => {
  assert.match(page, /r\.status === 'rejected'/);
  assert.doesNotMatch(page, /results\.length - created\.length/);
  assert.match(page, /for \(const record of created\) upsertCachedRecord/);
});

test('a single mark without a record id refetches instead of leaving an id-less row', () => {
  assert.match(page, /if \(record\?\.id\) upsertCachedRecord\(key, student\.id, record\);\s*else queryClient\.invalidateQueries\(\{ queryKey: key \}\)/);
});
