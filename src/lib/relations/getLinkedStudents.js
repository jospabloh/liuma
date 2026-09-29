import { schoolReadContext } from '@/lib/data/schoolRead';
import { partitionLinkedStudents } from '@/lib/relations/partitionLinkedStudents';

// A parent's children. One request: schoolRead's `context` re-derives the
// ParentStudent links and loads the linked Student rows server-side (P10).
// Before, this read ParentStudent and then Student from the client — and
// Student.read under RLS is creator-or-platform-owner, so a real parent got
// every child back as "orphaned".
export async function getLinkedStudents(user) {
  if (!user?.id) {
    return { students: [], studentIds: [], orphanedLinkIds: [], classrooms: [] };
  }

  const { linkStudentIds, students, classrooms } = await schoolReadContext();
  // Parent→student linkage is the ParentStudent table, resolved on the server
  // for the caller only (there is no client-side `user.data.linked_student_ids`:
  // auth.me() returns the user flat, so it was always undefined).
  if (linkStudentIds.length === 0) {
    return { students: [], studentIds: [], orphanedLinkIds: [], classrooms: [] };
  }
  // The children's classrooms come in the same response, so a page that
  // shows the classroom name needs no second request.
  return { ...partitionLinkedStudents(linkStudentIds, students), classrooms };
}

export async function getLinkedStudentIds(user) {
  const { studentIds } = await getLinkedStudents(user);
  return studentIds;
}
