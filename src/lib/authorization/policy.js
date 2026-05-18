const ROLES = {
  ADMIN: 'ADMIN',
  TEACHER: 'TEACHER',
  PARENT: 'PARENT',
};

export const DENIAL_REASON_CODES = {
  MISSING_CONTEXT: 'missing_context',
  EXPLICIT_DENY: 'explicit_deny',
  DEFAULT_DENY: 'default_deny',
  FORBIDDEN_ACTION: 'forbidden_action',
  CROSS_TENANT_DENIED: 'cross_tenant_denied',
  CROSS_CLASSROOM_DENIED: 'cross_classroom_denied',
  UNRELATED_STUDENT_DENIED: 'unrelated_student_denied',
  OWNER_IDENTITY_CONFLICT: 'owner_identity_conflict',
  OWNER_NOT_CONFIGURED: 'owner_not_configured',
  OWNER_PROFILE_MISSING: 'missing_user_profile',
  OWNER_PROFILE_DUPLICATE: 'duplicate_owner_profile',
  OWNER_PROFILE_CONFLICT: 'conflicting_owner_profile',
  INVALID_ROLE: 'invalid_role',
  INACTIVE_PROFILE: 'inactive_profile',
  SUPER_ADMIN_REQUIRED: 'super_admin_required',
  OVERRIDE_DENY: 'override_deny',
  SECOND_ADMIN_REQUIRED: 'second_admin_required',
  SELF_APPROVAL_DENIED: 'self_approval_denied',
  REASON_REQUIRED: 'reason_required',
  ADMIN_ONLY: 'admin_only',
  SELF_PERMISSION_CHANGE_DENIED: 'self_permission_change_denied',
};

function deny(reason_code, extra = {}) {
  return { allowed: false, reason: reason_code, reason_code, ...extra };
}

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
    return deny(DENIAL_REASON_CODES.MISSING_CONTEXT, { precedence: 'default_deny' });
  }

  if (permissions.includes(`!${role}`)) {
    return deny(DENIAL_REASON_CODES.EXPLICIT_DENY, { precedence: 'explicit_deny' });
  }

  if (permissions.includes(role)) {
    return { allowed: true, reason: 'explicit_allow', precedence: 'explicit_allow' };
  }

  return deny(DENIAL_REASON_CODES.DEFAULT_DENY, { precedence: 'default_deny' });
}

function normalizeIdentity(value) {
  return String(value || '').trim().toLowerCase();
}

export function resolveOwnerIdentity({ currentUser, ownerEmail, ownerUserId }) {
  const configuredUserId = normalizeIdentity(ownerUserId);
  const configuredEmail = normalizeIdentity(ownerEmail);
  const currentUserId = normalizeIdentity(currentUser?.id);
  const currentEmail = normalizeIdentity(currentUser?.email);

  if (configuredUserId) {
    if (currentUserId !== configuredUserId) return { isOwner: false, source: 'user_id' };
    if (configuredEmail && currentEmail && currentEmail !== configuredEmail) {
      return { isOwner: false, source: 'user_id', reason: DENIAL_REASON_CODES.OWNER_IDENTITY_CONFLICT, reason_code: DENIAL_REASON_CODES.OWNER_IDENTITY_CONFLICT };
    }
    return { isOwner: true, source: 'user_id' };
  }

  if (!configuredEmail || !currentEmail) return { isOwner: false, source: 'email' };
  return { isOwner: currentEmail === configuredEmail, source: 'email' };
}

export function isOwnerUser({ currentUser, ownerEmail, ownerUserId }) {
  return resolveOwnerIdentity({ currentUser, ownerEmail, ownerUserId }).isOwner;
}

export function validateOwnerProfiles({ currentUser, ownerProfiles = [], targetSchoolId }) {
  if (!targetSchoolId) return { valid: false, reason: DENIAL_REASON_CODES.CROSS_TENANT_DENIED, reason_code: DENIAL_REASON_CODES.CROSS_TENANT_DENIED };
  if (!Array.isArray(ownerProfiles)) return { valid: true };

  const matchingProfiles = ownerProfiles.filter((profile) => (
    profile?.school_id === targetSchoolId &&
    (!currentUser?.id || profile.user_id === currentUser.id)
  ));

  if (matchingProfiles.length === 0) {
    return { valid: false, reason: DENIAL_REASON_CODES.OWNER_PROFILE_MISSING, reason_code: DENIAL_REASON_CODES.OWNER_PROFILE_MISSING };
  }

  const activeAdminProfiles = matchingProfiles.filter((profile) => verifyCreatorProvisioning(profile).valid);
  if (activeAdminProfiles.length === 0) {
    return verifyCreatorProvisioning(matchingProfiles[0]);
  }

  if (activeAdminProfiles.length > 1) {
    return { valid: false, reason: DENIAL_REASON_CODES.OWNER_PROFILE_DUPLICATE, reason_code: DENIAL_REASON_CODES.OWNER_PROFILE_DUPLICATE };
  }

  if (matchingProfiles.length > 1) {
    return { valid: false, reason: DENIAL_REASON_CODES.OWNER_PROFILE_CONFLICT, reason_code: DENIAL_REASON_CODES.OWNER_PROFILE_CONFLICT };
  }

  return { valid: true, profile: activeAdminProfiles[0] };
}

export function getOwnerScopedAccess({ currentUser, ownerEmail, ownerUserId, actorSchoolId, targetSchoolId, ownerProfiles }) {
  const ownerIdentity = resolveOwnerIdentity({ currentUser, ownerEmail, ownerUserId });
  if (!ownerIdentity.isOwner) return deny(ownerIdentity.reason_code || ownerIdentity.reason || DENIAL_REASON_CODES.OWNER_NOT_CONFIGURED);
  if (!targetSchoolId || actorSchoolId !== targetSchoolId) {
    return deny(DENIAL_REASON_CODES.CROSS_TENANT_DENIED);
  }

  if (ownerProfiles) {
    const profileValidation = validateOwnerProfiles({ currentUser, ownerProfiles, targetSchoolId });
    if (!profileValidation.valid) {
      return deny(profileValidation.reason_code || profileValidation.reason);
    }
  }

  return { allowed: true, reason: 'owner_override', precedence: 'owner_override', identity_source: ownerIdentity.source };
}

export function verifyCreatorProvisioning(profile) {
  if (!profile) {
    return { valid: false, reason: DENIAL_REASON_CODES.OWNER_PROFILE_MISSING, reason_code: DENIAL_REASON_CODES.OWNER_PROFILE_MISSING };
  }
  if (profile.app_role !== ROLES.ADMIN) {
    return { valid: false, reason: DENIAL_REASON_CODES.INVALID_ROLE, reason_code: DENIAL_REASON_CODES.INVALID_ROLE };
  }
  if (profile.status !== 'ACTIVE') {
    return { valid: false, reason: DENIAL_REASON_CODES.INACTIVE_PROFILE, reason_code: DENIAL_REASON_CODES.INACTIVE_PROFILE };
  }
  if (Object.prototype.hasOwnProperty.call(profile, 'is_super_admin') && profile.is_super_admin !== true) {
    return { valid: false, reason: DENIAL_REASON_CODES.SUPER_ADMIN_REQUIRED, reason_code: DENIAL_REASON_CODES.SUPER_ADMIN_REQUIRED };
  }
  return { valid: true };
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
    return deny(DENIAL_REASON_CODES.OVERRIDE_DENY, { precedence: 'override_deny' });
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
    return deny(DENIAL_REASON_CODES.FORBIDDEN_ACTION);
  }
  return { allowed: true };
}

export function assertTenantScope({ actorSchoolId, targetSchoolId }) {
  if (!assertSameTenant({ sourceSchoolId: actorSchoolId, targetSchoolId })) {
    return deny(DENIAL_REASON_CODES.CROSS_TENANT_DENIED);
  }
  return { allowed: true };
}

export function assertTeacherClassroomScope({ role, classroomIds = [], targetClassroomId }) {
  if (role !== ROLES.TEACHER) return { allowed: true };
  if (!targetClassroomId || !classroomIds.includes(targetClassroomId)) {
    return deny(DENIAL_REASON_CODES.CROSS_CLASSROOM_DENIED);
  }
  return { allowed: true };
}

export function assertParentStudentScope({ role, studentIds = [], targetStudentId }) {
  if (role !== ROLES.PARENT) return { allowed: true };
  if (!targetStudentId || !studentIds.includes(targetStudentId)) {
    return deny(DENIAL_REASON_CODES.UNRELATED_STUDENT_DENIED);
  }
  return { allowed: true };
}
