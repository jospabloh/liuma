const ROLES = {
  ADMIN: 'ADMIN',
  TEACHER: 'TEACHER',
  PARENT: 'PARENT',
};

const POLICY = {
  Notice: {
    read: [ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT],
    write: [ROLES.ADMIN, ROLES.TEACHER],
    scope: ['school_id', 'classroom_id', 'student_id'],
  },
  Attendance: {
    read: [ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT],
    write: [ROLES.ADMIN, ROLES.TEACHER],
    scope: ['school_id', 'classroom_id', 'student_id'],
  },
  Homework: {
    read: [ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT],
    write: [ROLES.ADMIN, ROLES.TEACHER],
    scope: ['school_id', 'classroom_id'],
  },
  DiaryEntry: {
    read: [ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT],
    write: [ROLES.ADMIN, ROLES.TEACHER],
    scope: ['school_id', 'classroom_id', 'student_id'],
  },
  ChargeItem: {
    read: [ROLES.ADMIN, ROLES.PARENT],
    write: [ROLES.ADMIN],
    scope: ['school_id', 'student_id'],
  },
  PaymentConcept: {
    read: [ROLES.ADMIN],
    write: [ROLES.ADMIN],
    scope: ['school_id'],
  },
  PaymentRecord: {
    read: [ROLES.ADMIN],
    write: [ROLES.ADMIN],
    scope: ['school_id', 'student_id'],
  },
};

export function canReadEntity(role, entity) {
  return Boolean(POLICY[entity]?.read?.includes(role));
}

export function canWriteEntity(role, entity) {
  return Boolean(POLICY[entity]?.write?.includes(role));
}

export function buildScopedFilter({ role, entity, schoolId, classroomIds = [], studentIds = [] }) {
  if (!canReadEntity(role, entity)) return null;

  const base = {};
  if (schoolId) base.school_id = schoolId;

  if (role === ROLES.TEACHER) {
    if (classroomIds.length > 0) base.classroom_id = { $in: classroomIds };
    return base;
  }

  if (role === ROLES.PARENT) {
    if (studentIds.length > 0) base.student_id = { $in: studentIds };
    if (classroomIds.length > 0 && !base.classroom_id) base.classroom_id = { $in: classroomIds };
    return base;
  }

  return base;
}

export function filterByRowLevel({ role, entity, rows = [], classroomIds = [], studentIds = [] }) {
  if (!canReadEntity(role, entity)) return [];
  if (role === ROLES.ADMIN) return rows;

  return rows.filter((row) => {
    if (role === ROLES.TEACHER) {
      return !row.classroom_id || classroomIds.includes(row.classroom_id);
    }

    if (role === ROLES.PARENT) {
      if (row.scope === 'SCHOOL') return true;
      if (row.scope === 'CLASSROOM') return classroomIds.includes(row.classroom_id);
      if (row.scope === 'STUDENT') return studentIds.includes(row.student_id);
      return studentIds.includes(row.student_id) || classroomIds.includes(row.classroom_id);
    }

    return false;
  });
}

export { ROLES, POLICY };
