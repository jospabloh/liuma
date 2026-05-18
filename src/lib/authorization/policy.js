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

function resolvePolicyDecision({ role, entity, action }) {
  const permissions = POLICY[entity]?.[action] || [];

  if (!role || !entity || !action) {
    return { allowed: false, reason: 'missing_context', precedence: 'default_deny' };
  }

  if (permissions.includes(`!${role}`)) {
    return { allowed: false, reason: 'explicit_deny', precedence: 'explicit_deny' };
  }

  if (permissions.includes(role)) {
    return { allowed: true, reason: 'explicit_allow', precedence: 'explicit_allow' };
  }

  return { allowed: false, reason: 'default_deny', precedence: 'default_deny' };
}

export function isOwnerUser({ currentUser, ownerEmail }) {
  if (!currentUser?.email || !ownerEmail) return false;
  return currentUser.email.toLowerCase() === ownerEmail.toLowerCase();
}

export function getOwnerScopedAccess({ currentUser, ownerEmail, actorSchoolId, targetSchoolId }) {
  const isOwner = isOwnerUser({ currentUser, ownerEmail });
  if (!isOwner) return { allowed: false };
  if (!targetSchoolId || actorSchoolId !== targetSchoolId) {
    return { allowed: false, reason: 'cross_tenant_denied' };
  }
  return { allowed: true, reason: 'owner_override', precedence: 'owner_override' };
}


function findOverrides({ overrides = [], userProfileId, entity, action }) {
  if (!userProfileId) return null;
  return overrides.filter((override) => (
    override.user_profile_id === userProfileId &&
    override.resource === entity &&
    override.action === action
  ));
}

export function getEffectivePolicyDecision({ role, entity, action, userProfileId, overrides = [] }) {
  const baseDecision = resolvePolicyDecision({ role, entity, action });
  const matchingOverrides = findOverrides({ overrides, userProfileId, entity, action }) || [];
  if (matchingOverrides.length === 0) return baseDecision;
  if (matchingOverrides.some((override) => override.effect === 'deny')) {
    return { allowed: false, reason: 'override_deny', precedence: 'override_deny' };
  }

  if (matchingOverrides.some((override) => override.effect === 'allow')) {
    if (baseDecision.reason === 'explicit_deny') {
      return baseDecision;
    }
    return { allowed: true, reason: 'override_allow', precedence: 'override_allow' };
  }

  return baseDecision;
}

export function canReadEntity(role, entity) {
  return resolvePolicyDecision({ role, entity, action: 'read' }).allowed;
}

export function canWriteEntity(role, entity) {
  return resolvePolicyDecision({ role, entity, action: 'write' }).allowed;
}

export function getPolicyDecision({ role, entity, action }) {
  return resolvePolicyDecision({ role, entity, action });
}

export function buildTenantScopeGuard({ schoolId, classroomIds = [], studentIds = [] }) {
  const guard = { school_id: schoolId || null };

  if (classroomIds.length > 0) guard.classroom_id = { $in: classroomIds };
  if (studentIds.length > 0) guard.student_id = { $in: studentIds };

  return guard;
}

export function applyTenantScopeToQuery(filter = {}, guard = {}) {
  const query = { ...filter };

  Object.entries(guard).forEach(([key, value]) => {
    if (value == null) return;
    query[key] = value;
  });

  return query;
}

export function assertSameTenant({ sourceSchoolId, targetSchoolId }) {
  return Boolean(sourceSchoolId && targetSchoolId && sourceSchoolId === targetSchoolId);
}

export function rejectsCrossTenantReference({ sourceSchoolId, targetSchoolId }) {
  return !assertSameTenant({ sourceSchoolId, targetSchoolId });
}

export function buildScopedFilter({ role, entity, schoolId, classroomIds = [], studentIds = [] }) {
  if (!canReadEntity(role, entity)) return null;

  const base = buildTenantScopeGuard({ schoolId });

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

export function assertRoleAccess({ role, entity, action }) {
  const decision = resolvePolicyDecision({ role, entity, action });
  if (!decision.allowed) {
    return { allowed: false, reason: 'forbidden_action' };
  }
  return { allowed: true };
}

export function assertTenantScope({ actorSchoolId, targetSchoolId }) {
  if (!assertSameTenant({ sourceSchoolId: actorSchoolId, targetSchoolId })) {
    return { allowed: false, reason: 'cross_tenant_denied' };
  }
  return { allowed: true };
}

export function assertTeacherClassroomScope({ role, classroomIds = [], targetClassroomId }) {
  if (role !== ROLES.TEACHER) return { allowed: true };
  if (!targetClassroomId || !classroomIds.includes(targetClassroomId)) {
    return { allowed: false, reason: 'cross_classroom_denied' };
  }
  return { allowed: true };
}

export function assertParentStudentScope({ role, studentIds = [], targetStudentId }) {
  if (role !== ROLES.PARENT) return { allowed: true };
  if (!targetStudentId || !studentIds.includes(targetStudentId)) {
    return { allowed: false, reason: 'unrelated_student_denied' };
  }
  return { allowed: true };
}
