// Import-free on purpose: `node --test` loads it directly.
//
// Coverage is counted in STUDENTS, never in diary entries. A teacher can write
// two bitácoras for the same child in one day (a morning note and an
// incident), and live QA (2026-09-29) caught TeacherHome saying
// "Completo · 2 de 2 alumnos" when one child had two entries and the other had
// none — it was dividing entries by students.

/**
 * @param {Array<{id: string}>} students  the students that should have a diary
 * @param {Array<{student_id: string}>} diaries  today's entries (any scope)
 */
export function diaryCoverage(students = [], diaries = []) {
  const withDiary = new Set(diaries.map((d) => d.student_id));
  const missing = students.filter((s) => !withDiary.has(s.id));
  const total = students.length;
  // Only students on the list count: an entry for a child who left the
  // classroom must not fill someone else's slot.
  const covered = total - missing.length;
  const percent = total > 0 ? Math.round((covered / total) * 100) : 0;
  return { covered, total, missing, percent, complete: total > 0 && covered === total };
}

/**
 * Which screen CrearBitacora's step 1 should show. "Todas completas" is only
 * true once a classroom is chosen, its students AND diaries have loaded, it
 * has students, and every one of them has a diary — QA found the page claiming
 * it for a URL with no ?classroomId at all.
 */
export function crearBitacoraStep1View({
  classroomId,
  classroomsLoading = false,
  classroomsError = false,
  classroomCount = 0,
  loading = false,
  error = false,
  studentCount = 0,
  missingCount = 0,
}) {
  if (!classroomId) {
    if (classroomsLoading) return 'loading';
    // A failed load must not read as "you have no classrooms".
    if (classroomsError) return 'classrooms-error';
    return classroomCount === 0 ? 'no-classrooms' : 'pick-classroom';
  }
  if (loading) return 'loading';
  if (error) return 'error';
  if (studentCount === 0) return 'no-students';
  if (missingCount === 0) return 'all-complete';
  return 'list';
}
