// What the student header says about the student's classroom. Import-free so
// `node --test` loads it.
//
// "Sin salón" is a fact about the STUDENT (no classroom_id) — never what a
// failed or unfinished read of the classroom looks like. Live QA of v1.8.2: a
// teacher opened a student who has a classroom and read "Sin salón"; the read
// path itself allows it (Classroom is school-wide for a TEACHER), so the
// classroom read had failed (the platform rate limit) and the empty result was
// rendered as "no classroom".
export function studentClassroomLabel({ classroomId, classroom, isLoading = false, isError = false } = {}) {
  if (!classroomId) return { text: 'Sin salón', state: 'none' };
  if (classroom?.name) return { text: classroom.name, state: 'ok' };
  if (isError) return { text: 'No se pudo cargar el salón', state: 'error' };
  if (isLoading) return { text: 'Cargando salón…', state: 'loading' };
  // Read fine, nothing came back: the classroom was deleted or is not
  // readable. Still not "Sin salón" — the student does point at one.
  return { text: 'Salón no disponible', state: 'missing' };
}
