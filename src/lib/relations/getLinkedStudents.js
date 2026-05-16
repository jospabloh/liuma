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

  const parentStudentIds = [...new Set(parentLinks.map((l) => l.student_id).filter(Boolean))];
  const fallbackIds = Array.isArray(user?.data?.linked_student_ids)
    ? user.data.linked_student_ids.filter(Boolean)
    : [];

  const studentIds = parentStudentIds.length > 0 ? parentStudentIds : [...new Set(fallbackIds)];
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
