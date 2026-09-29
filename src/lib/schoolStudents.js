// Query key + filter for "the students of a school", shared by every admin
// screen that lists them (see src/hooks/useSchoolStudents.js).
//
// Why this exists: AdminHome/AvisosAdmin/PagosAdmin fetched ACTIVE students and
// GestionEscuela/GestionPedidosAdmin fetched ALL students (inactive included),
// all under the same React Query key ['allStudents', school_id]. Navigating
// between them showed the other page's cached list first — inactive students
// popping in and out, counts flickering — until the refetch landed. The filter
// is now part of the key, so two different lists can never share a cache slot.
//
// Import-free so `node --test` loads it.

export const SCHOOL_STUDENTS_QUERY_ROOT = 'schoolStudents';

export function schoolStudentsScope({ activeOnly = true } = {}) {
  return activeOnly ? 'active' : 'all';
}

export function schoolStudentsQueryKey(schoolId, options = {}) {
  return [SCHOOL_STUDENTS_QUERY_ROOT, schoolId ?? null, schoolStudentsScope(options)];
}

export function schoolStudentsFilter(schoolId, { activeOnly = true } = {}) {
  return activeOnly ? { school_id: schoolId, is_active: true } : { school_id: schoolId };
}

/**
 * Share (0-100) of `students` that have at least one row in `rows` pointing at
 * them via `student_id`. Rows for students outside the list (inactive or
 * deleted students, since contacts and links are now fetched per school, not
 * per student) are ignored, so the result can never pass 100%.
 */
export function percentOfStudentsCovered(students = [], rows = []) {
  const ids = new Set((students || []).map((s) => s?.id).filter(Boolean));
  if (ids.size === 0) return 0;
  const covered = new Set();
  for (const row of rows || []) {
    if (row && ids.has(row.student_id)) covered.add(row.student_id);
  }
  return Math.round((covered.size / ids.size) * 100);
}
