import { base44 } from '@/api/base44Client';
import { loadStudentsByIds } from '@/lib/data-loaders/batchedEntityLoaders';
import { partitionLinkedStudents } from '@/lib/relations/partitionLinkedStudents';

export async function getLinkedStudents(user) {
  if (!user?.id) {
    return { students: [], studentIds: [], orphanedLinkIds: [] };
  }

  const parentLinks = await base44.entities.ParentStudent.filter({
    parent_id: user.id,
    status: 'ACTIVE',
  });

  // Parent→student linkage is the ParentStudent table. (There used to be a
  // `user.data.linked_student_ids` fallback here, but base44.auth.me() returns
  // the user flat on the client — `user.data` is always undefined — so it was
  // dead code. `linked_student_ids` only exists as a server-side RLS token and
  // has no client-accessible source, so the fallback is removed rather than
  // wired to a non-existent field.)
  const studentIds = [...new Set(parentLinks.map((l) => l.student_id).filter(Boolean))];
  if (studentIds.length === 0) {
    return { students: [], studentIds: [], orphanedLinkIds: [] };
  }

  // One `id: { $in }` query for every child instead of one per child.
  const { items } = await loadStudentsByIds(studentIds);
  return partitionLinkedStudents(studentIds, items);
}

export async function getLinkedStudentIds(user) {
  const { studentIds } = await getLinkedStudents(user);
  return studentIds;
}
