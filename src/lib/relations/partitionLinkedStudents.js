// Pure half of getLinkedStudents, import-free so `node --test` loads it.
//
// getLinkedStudents now fetches every linked student in ONE `id: { $in }`
// query instead of one round-trip per child. A single query can't say "this id
// had no row", so orphan detection moves here: a link whose student is absent
// from the batch result is orphaned (deleted, or outside what RLS returns),
// and a present-but-inactive student is dropped without being called orphaned.
// Order follows the ParentStudent links, not the server's row order.

export const isActiveStudent = (student) => {
  if (!student) return false;
  if (student.is_active === false) return false;
  if (student.status && student.status !== 'ACTIVE') return false;
  if (student.enrollment_status && student.enrollment_status !== 'ACTIVE') return false;
  return true;
};

export function partitionLinkedStudents(studentIds = [], rows = []) {
  const byId = new Map((rows || []).filter((row) => row?.id).map((row) => [row.id, row]));
  const students = [];
  const orphanedLinkIds = [];
  for (const id of studentIds) {
    const student = byId.get(id);
    if (!student) {
      orphanedLinkIds.push(id);
      continue;
    }
    if (!isActiveStudent(student)) continue;
    students.push(student);
  }
  return {
    students,
    studentIds: students.map((student) => student.id),
    orphanedLinkIds,
  };
}
