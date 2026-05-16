import { base44 } from '@/api/base44Client';
import { loadClassroomsByIds } from '@/lib/data-loaders/batchedEntityLoaders';

export async function getLinkedClassrooms(user) {
  if (!user?.id) {
    return { classrooms: [], classroomIds: [] };
  }

  const assignments = await base44.entities.TeacherClassroom.filter({
    teacher_id: user.id,
    is_active: true,
  });

  const classroomIds = [...new Set(assignments.map((assignment) => assignment.classroom_id).filter(Boolean))];
  if (classroomIds.length === 0) {
    return { classrooms: [], classroomIds: [] };
  }

  const { items } = await loadClassroomsByIds(classroomIds);
  return { classrooms: items, classroomIds };
}

export async function getLinkedClassroomIds(user) {
  const { classroomIds } = await getLinkedClassrooms(user);
  return classroomIds;
}
