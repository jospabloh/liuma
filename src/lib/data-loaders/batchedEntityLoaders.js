import { base44 } from '@/api/base44Client';

const normalizeIds = (ids = []) => [...new Set(ids.filter(Boolean))].sort();

export const normalizedIdQueryKey = (scope, ids = []) => [scope, normalizeIds(ids)];

const loadIndexedEntitiesById = async (entityName, ids = []) => {
  const normalizedIds = normalizeIds(ids);
  if (normalizedIds.length === 0) {
    return { items: [], byId: {} };
  }

  const rows = await base44.entities[entityName].filter({ id: { $in: normalizedIds } });
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

export const loadHomeworkByClassroomIds = async (classroomIds = [], limit) => {
  const normalizedClassroomIds = normalizeIds(classroomIds);
  if (normalizedClassroomIds.length === 0) {
    return { items: [], byClassroomId: {} };
  }

  const homework = await base44.entities.Homework.filter({ classroom_id: { $in: normalizedClassroomIds } }, '-created_date', limit);
  const byClassroomId = homework.reduce((acc, row) => {
    if (!acc[row.classroom_id]) acc[row.classroom_id] = [];
    acc[row.classroom_id].push(row);
    return acc;
  }, {});

  return { items: homework, byClassroomId };
};
