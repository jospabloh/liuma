import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../../src/pages/Asistencia.jsx', import.meta.url), 'utf8');

test("teacher classroom lookup filters on `id` — Base44 silently ignores `_id`", () => {
  // With `_id` the query returned no classroom, so every teacher saw an empty
  // salón selector and could not take attendance at all.
  assert.doesNotMatch(page, /[{\s]_id: \{ \$in/);
  assert.match(page, /Classroom\.filter\(\{ id: \{ \$in: classroomIds \}/);
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
  assert.match(page, /pendingStudentIds\.has\(student\.id\)/);
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
