import { schoolReadContext } from '@/lib/data/schoolRead';

// A teacher's classrooms, from their active TeacherClassroom assignments —
// resolved server-side by schoolRead's `context` in the same request that
// loads the Classroom rows (P10; it used to be two client reads, and
// Classroom.read under RLS is platform-owner only).
export async function getLinkedClassrooms(user) {
  if (!user?.id) {
    return { classrooms: [], classroomIds: [] };
  }
  const { classroomIds, classrooms } = await schoolReadContext();
  if (classroomIds.length === 0) {
    return { classrooms: [], classroomIds: [] };
  }
  const byId = new Map(classrooms.map((c) => [c.id, c]));
  return { classrooms: classroomIds.map((id) => byId.get(id)).filter(Boolean), classroomIds };
}

export async function getLinkedClassroomIds(user) {
  const { classroomIds } = await getLinkedClassrooms(user);
  return classroomIds;
}
