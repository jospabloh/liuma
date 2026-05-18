import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canReadEntity,
  canWriteEntity,
  buildScopedFilter,
  filterByRowLevel,
  getEffectivePolicyDecision,
  getOwnerScopedAccess,
  resolveOwnerIdentity,
  validateOwnerProfiles,
  verifyCreatorProvisioning,
} from '../../src/lib/authorization/policy.js';
import { actors, rows } from '../fixtures/authorization-fixtures.js';

test('denies unknown entities by default', () => {
  assert.equal(canReadEntity('ADMIN', 'UnknownEntity'), false);
  assert.equal(canWriteEntity('ADMIN', 'UnknownEntity'), false);
});

test('keeps parent scoped to linked student data only', () => {
  const visible = filterByRowLevel({
    role: actors.parentStudentA1.role,
    entity: 'Attendance',
    rows: rows.attendance,
    classroomIds: actors.parentStudentA1.classroomIds,
    studentIds: actors.parentStudentA1.studentIds,
  });

  assert.deepEqual(visible.map((item) => item.id), ['att-1']);
});

test('keeps teacher scoped to assigned classroom rows only', () => {
  const visible = filterByRowLevel({
    role: actors.teacherClassA1.role,
    entity: 'DiaryEntry',
    rows: rows.diaryEntries,
    classroomIds: actors.teacherClassA1.classroomIds,
  });

  assert.deepEqual(visible.map((item) => item.id), ['dia-1']);
});

test('allows admin to see all rows', () => {
  const visible = filterByRowLevel({
    role: actors.adminSchoolA.role,
    entity: 'Notice',
    rows: rows.notices,
  });

  assert.deepEqual(visible.map((item) => item.id), ['not-1', 'not-2', 'not-3']);
});

test('builds teacher scoped filters with classroom restriction', () => {
  const filter = buildScopedFilter({
    role: actors.teacherClassA1.role,
    entity: 'Attendance',
    schoolId: actors.teacherClassA1.schoolId,
    classroomIds: actors.teacherClassA1.classroomIds,
  });

  assert.deepEqual(filter, {
    school_id: 'school-a',
    classroom_id: { $in: ['class-a1'] },
  });
});

test('applies deny override precedence for effective permissions', () => {
  const decision = getEffectivePolicyDecision({
    role: 'TEACHER',
    entity: 'Notice',
    action: 'read',
    userProfileId: 'profile-1',
    overrides: [
      { user_profile_id: 'profile-1', resource: 'Notice', action: 'read', effect: 'deny' },
      { user_profile_id: 'profile-1', resource: 'Notice', action: 'read', effect: 'allow' },
    ],
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.precedence, 'override_deny');
});

test('owner override allows admin access only when scoped to the same tenant', () => {
  const decision = getOwnerScopedAccess({
    currentUser: { email: 'owner@example.com' },
    ownerEmail: 'owner@example.com',
    actorSchoolId: 'school-a',
    targetSchoolId: 'school-a',
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'owner_override');
});

test('non-owner users remain deny-by-default when they have no role permission', () => {
  const ownerDecision = getOwnerScopedAccess({
    currentUser: { email: 'user@example.com' },
    ownerEmail: 'owner@example.com',
    actorSchoolId: 'school-a',
    targetSchoolId: 'school-a',
  });

  assert.equal(ownerDecision.allowed, false);
  assert.equal(canWriteEntity('PARENT', 'PaymentRecord'), false);
});

test('owner override blocks cross-tenant access to preserve tenant isolation', () => {
  const decision = getOwnerScopedAccess({
    currentUser: { email: 'owner@example.com' },
    ownerEmail: 'owner@example.com',
    actorSchoolId: 'school-a',
    targetSchoolId: 'school-b',
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'cross_tenant_denied');
});

test('creator provisioning is valid only for active admin profile', () => {
  const result = verifyCreatorProvisioning({
    id: 'creator-1',
    app_role: 'ADMIN',
    status: 'ACTIVE',
    is_super_admin: true,
  });

  assert.equal(result.valid, true);
});

test('creator provisioning fails when profile is missing admin flags', () => {
  assert.equal(verifyCreatorProvisioning(null).valid, false);
  assert.equal(verifyCreatorProvisioning({ app_role: 'TEACHER', status: 'ACTIVE' }).reason, 'invalid_role');
  assert.equal(verifyCreatorProvisioning({ app_role: 'ADMIN', status: 'PENDING' }).reason, 'inactive_profile');
  assert.equal(verifyCreatorProvisioning({ app_role: 'ADMIN', status: 'ACTIVE', is_super_admin: false }).reason, 'super_admin_required');
});


test('owner identity prefers configured user_id and rejects email conflicts', () => {
  assert.deepEqual(resolveOwnerIdentity({
    currentUser: { id: 'owner-user-1', email: 'owner@example.com' },
    ownerEmail: 'other@example.com',
    ownerUserId: 'owner-user-1',
  }), {
    isOwner: false,
    source: 'user_id',
    reason: 'owner_identity_conflict',
  });

  assert.equal(resolveOwnerIdentity({
    currentUser: { id: 'owner-user-1', email: 'owner@example.com' },
    ownerEmail: 'owner@example.com',
    ownerUserId: 'owner-user-1',
  }).isOwner, true);
});

test('owner override requires one active admin UserProfile in the target tenant', () => {
  const decision = getOwnerScopedAccess({
    currentUser: { id: 'owner-user-1', email: 'owner@example.com' },
    ownerEmail: 'owner@example.com',
    actorSchoolId: 'school-a',
    targetSchoolId: 'school-a',
    ownerProfiles: [
      { id: 'owner-profile-1', user_id: 'owner-user-1', school_id: 'school-a', app_role: 'ADMIN', status: 'ACTIVE', is_super_admin: true },
    ],
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.identity_source, 'email');
});

test('owner profile validation rejects missing, inactive, and non-admin target-tenant profiles', () => {
  assert.equal(validateOwnerProfiles({
    currentUser: { id: 'owner-user-1' },
    ownerProfiles: [{ id: 'other-tenant', user_id: 'owner-user-1', school_id: 'school-b', app_role: 'ADMIN', status: 'ACTIVE' }],
    targetSchoolId: 'school-a',
  }).reason, 'missing_user_profile');

  assert.equal(validateOwnerProfiles({
    currentUser: { id: 'owner-user-1' },
    ownerProfiles: [{ id: 'inactive', user_id: 'owner-user-1', school_id: 'school-a', app_role: 'ADMIN', status: 'SUSPENDED' }],
    targetSchoolId: 'school-a',
  }).reason, 'inactive_profile');

  assert.equal(validateOwnerProfiles({
    currentUser: { id: 'owner-user-1' },
    ownerProfiles: [{ id: 'teacher', user_id: 'owner-user-1', school_id: 'school-a', app_role: 'TEACHER', status: 'ACTIVE' }],
    targetSchoolId: 'school-a',
  }).reason, 'invalid_role');
});

test('owner profile validation detects duplicate and conflicting target-tenant profiles', () => {
  assert.equal(validateOwnerProfiles({
    currentUser: { id: 'owner-user-1' },
    ownerProfiles: [
      { id: 'owner-profile-1', user_id: 'owner-user-1', school_id: 'school-a', app_role: 'ADMIN', status: 'ACTIVE', is_super_admin: true },
      { id: 'owner-profile-2', user_id: 'owner-user-1', school_id: 'school-a', app_role: 'ADMIN', status: 'ACTIVE', is_super_admin: true },
    ],
    targetSchoolId: 'school-a',
  }).reason, 'duplicate_owner_profile');

  assert.equal(validateOwnerProfiles({
    currentUser: { id: 'owner-user-1' },
    ownerProfiles: [
      { id: 'owner-profile-1', user_id: 'owner-user-1', school_id: 'school-a', app_role: 'ADMIN', status: 'ACTIVE', is_super_admin: true },
      { id: 'owner-profile-2', user_id: 'owner-user-1', school_id: 'school-a', app_role: 'PARENT', status: 'ACTIVE' },
    ],
    targetSchoolId: 'school-a',
  }).reason, 'conflicting_owner_profile');
});
