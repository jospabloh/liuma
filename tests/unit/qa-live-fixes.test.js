// Findings from the live QA pass of 2026-09-29/30 (see CLAUDE.md, "QA en
// vivo 2026-09-29/30"). Each test says what was seen in production.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { diaryCoverage, crearBitacoraStep1View } from '../../src/lib/diaryCoverage.js';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('diary coverage counts students, not entries: 2 entries for one child ≠ 2 children covered', () => {
  // Seen live: "Completo · 2 de 2 alumnos" with Ana holding two bitácoras
  // (morning note + incident) and Beto holding none.
  const students = [{ id: 'ana' }, { id: 'beto' }];
  const diaries = [{ student_id: 'ana' }, { student_id: 'ana' }];
  const c = diaryCoverage(students, diaries);
  assert.equal(c.covered, 1);
  assert.equal(c.total, 2);
  assert.equal(c.percent, 50);
  assert.equal(c.complete, false);
  assert.deepEqual(c.missing.map((s) => s.id), ['beto']);
});

test('an entry for a child not on the list never fills another child\'s slot', () => {
  const c = diaryCoverage([{ id: 'ana' }], [{ student_id: 'transferido' }]);
  assert.equal(c.covered, 0);
  assert.equal(c.complete, false);
  assert.equal(diaryCoverage([], []).complete, false, 'an empty class is not "Completo"');
  assert.equal(diaryCoverage([{ id: 'a' }], [{ student_id: 'a' }]).complete, true);
});

test('TeacherHome derives "Completo" and "N de M" from student coverage, not entry count', () => {
  const src = read('src/components/home/TeacherHome.jsx');
  assert.match(src, /diaryCoverage\(students, todayDiaries\)/);
  assert.doesNotMatch(src, /todayDiaries\.length/, 'entry count must not drive progress');
  assert.doesNotMatch(src, /classDiaries\.length/, 'per-classroom card had the same bug');
  assert.match(src, /\{diaryStats\.covered\} de \{diaryStats\.total\} alumnos/);
});

test('CrearBitacora only claims "todas completas" for a loaded classroom whose every student has a diary', () => {
  // Seen live: /CrearBitacora with no ?classroomId said "¡Todas las bitácoras
  // completas!" because the student list was simply empty.
  const v = crearBitacoraStep1View;
  assert.equal(v({ classroomId: null, classroomsLoading: true }), 'loading');
  assert.equal(v({ classroomId: null, classroomCount: 0 }), 'no-classrooms');
  assert.equal(v({ classroomId: null, classroomCount: 2 }), 'pick-classroom');
  assert.equal(v({ classroomId: 'c1', loading: true }), 'loading');
  assert.equal(v({ classroomId: 'c1', error: true }), 'error');
  assert.equal(v({ classroomId: 'c1', studentCount: 0 }), 'no-students');
  assert.equal(v({ classroomId: 'c1', studentCount: 3, missingCount: 1 }), 'list');
  assert.equal(v({ classroomId: 'c1', studentCount: 3, missingCount: 0 }), 'all-complete');

  const src = read('src/pages/CrearBitacora.jsx');
  assert.match(src, /step1View === 'all-complete' && \(/);
  assert.doesNotMatch(src, /studentsWithoutDiary\.length === 0 &&/);
  // Without the URL param the teacher picks here; a single classroom is chosen for her.
  assert.match(src, /teacherClassrooms\.length === 1/);
});

test('the trial welcome only opens on an effective trial, with one close button and a DialogTitle', () => {
  const home = read('src/pages/Home.jsx');
  assert.match(home, /effectiveStatus === 'trial' && userProfile\.app_role === 'ADMIN'/);

  const modal = read('src/components/subscription/WelcomeTrialModal.jsx');
  assert.match(modal, /<DialogTitle[^>]*>¡Bienvenido a LIUMA!<\/DialogTitle>/);
  assert.match(modal, /<DialogDescription/);
  // DialogContent already renders a close X; a second hand-made one doubled it.
  assert.doesNotMatch(modal, /<X /);
});
