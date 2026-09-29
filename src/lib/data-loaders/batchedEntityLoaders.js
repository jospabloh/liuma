import { schoolRead } from '@/lib/data/schoolRead';

// Reads go through schoolRead (P10): the server scopes every list to the
// caller's school and role, so these loaders return only what the caller may
// see (a parent's own children, a teacher's own classrooms).

const normalizeIds = (ids = []) => [...new Set(ids.filter(Boolean))].sort();

export const normalizedIdQueryKey = (scope, ids = []) => [scope, normalizeIds(ids)];

const loadIndexedEntitiesById = async (entityName, ids = []) => {
  const normalizedIds = normalizeIds(ids);
  if (normalizedIds.length === 0) {
    return { items: [], byId: {} };
  }

  // The server caps an $in list at 500 values; chunk rather than truncate.
  const rows = [];
  for (let i = 0; i < normalizedIds.length; i += 500) {
    const chunk = normalizedIds.slice(i, i + 500);
    rows.push(...await schoolRead(entityName, { id: { $in: chunk } }, undefined, chunk.length));
  }
  const byId = rows.reduce((acc, row) => {
    acc[row.id] = row;
    return acc;
  }, {});

  return {
    items: normalizedIds.map((id) => byId[id]).filter(Boolean),
    byId,
  };
};

export const loadStudentsByIds = (ids = []) => loadIndexedEntitiesById('Student', ids);

export const loadClassroomsByIds = (ids = []) => loadIndexedEntitiesById('Classroom', ids);

// One $in query instead of one round-trip per classroom. The explicit limit
// matters: several classrooms together can exceed the server's default page.
export const ACTIVE_STUDENTS_LIMIT = 5000;
export const loadActiveStudentsByClassroomIds = async (classroomIds = []) => {
  const normalizedClassroomIds = normalizeIds(classroomIds);
  if (normalizedClassroomIds.length === 0) return [];
  return schoolRead(
    'Student',
    { classroom_id: { $in: normalizedClassroomIds }, is_active: true },
    undefined,
    ACTIVE_STUDENTS_LIMIT,
  );
};

export const loadHomeworkByClassroomIds = async (classroomIds = [], limit) => {
  const normalizedClassroomIds = normalizeIds(classroomIds);
  if (normalizedClassroomIds.length === 0) {
    return { items: [], byClassroomId: {} };
  }

  const homework = await schoolRead('Homework', { classroom_id: { $in: normalizedClassroomIds } }, '-created_date', limit);
  const byClassroomId = homework.reduce((acc, row) => {
    if (!acc[row.classroom_id]) acc[row.classroom_id] = [];
    acc[row.classroom_id].push(row);
    return acc;
  }, {});

  return { items: homework, byClassroomId };
};
