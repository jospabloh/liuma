import { base44 } from '@/api/base44Client';

const isActiveStudent = (student) => {
  if (!student) return false;
  if (student.is_active === false) return false;
  if (student.status && student.status !== 'ACTIVE') return false;
  if (student.enrollment_status && student.enrollment_status !== 'ACTIVE') return false;
  return true;
};

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

  const students = [];
  const orphanedLinkIds = [];

  for (const id of studentIds) {
    const matches = await base44.entities.Student.filter({ id });
    const student = matches[0];
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

export async function getLinkedStudentIds(user) {
  const { studentIds } = await getLinkedStudents(user);
  return studentIds;
}
