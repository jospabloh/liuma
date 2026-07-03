import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isHighRiskRoleChange,
  initialRequestStatus,
  hasOtherActiveAdmin,
  validateRoleChangeRequest,
  validateRoleChangeDecision,
  ROLE_CHANGE_STATUS,
} from '../../src/lib/authorization/roleGovernance.js';

const admin = { id: 'p-admin', user_id: 'u-admin', school_id: 's1', app_role: 'ADMIN', status: 'ACTIVE' };
const admin2 = { id: 'p-admin2', user_id: 'u-admin2', school_id: 's1', app_role: 'ADMIN', status: 'ACTIVE' };
const parent = { id: 'p-parent', user_id: 'u-parent', school_id: 's1', app_role: 'PARENT', status: 'ACTIVE' };
const teacher = { id: 'p-teacher', user_id: 'u-teacher', school_id: 's1', app_role: 'TEACHER', status: 'ACTIVE' };
const otherSchoolParent = { id: 'p-x', user_id: 'u-x', school_id: 's2', app_role: 'PARENT', status: 'ACTIVE' };

test('high-risk detection covers any ADMIN grant or revoke', () => {
  assert.equal(isHighRiskRoleChange('PARENT', 'ADMIN'), true);
  assert.equal(isHighRiskRoleChange('ADMIN', 'TEACHER'), true);
  assert.equal(isHighRiskRoleChange('PARENT', 'TEACHER'), false);
});

test('high-risk requests require a second admin approval; normal ones need one', () => {
  assert.equal(initialRequestStatus('PARENT', 'ADMIN'), ROLE_CHANGE_STATUS.PENDING_SECOND_ADMIN_APPROVAL);
  assert.equal(initialRequestStatus('PARENT', 'TEACHER'), ROLE_CHANGE_STATUS.PENDING_ADMIN_APPROVAL);
});

test('hasOtherActiveAdmin ignores the actor, the target, and inactive admins', () => {
  assert.equal(hasOtherActiveAdmin({ profiles: [admin, admin2], actorProfileId: 'p-admin', targetProfileId: 'p-x' }), true);
  assert.equal(hasOtherActiveAdmin({ profiles: [admin], actorProfileId: 'p-admin', targetProfileId: 'p-x' }), false);
  const suspended = { ...admin2, status: 'SUSPENDED' };
  assert.equal(hasOtherActiveAdmin({ profiles: [admin, suspended], actorProfileId: 'p-admin', targetProfileId: 'p-x' }), false);
});

test('request: only admins may request role changes', () => {
  const res = validateRoleChangeRequest({ requesterProfile: parent, targetProfile: teacher, toRole: 'ADMIN', profiles: [parent, teacher] });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'NOT_ADMIN');
});

test('request: cannot elevate a user from another school (tenant isolation)', () => {
  const res = validateRoleChangeRequest({ requesterProfile: admin, targetProfile: otherSchoolParent, toRole: 'ADMIN', profiles: [admin, otherSchoolParent] });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'CROSS_TENANT');
});

test('request: rejects invalid role and no-op change', () => {
  assert.equal(validateRoleChangeRequest({ requesterProfile: admin, targetProfile: parent, toRole: 'SUPERUSER', profiles: [admin, parent] }).code, 'INVALID_ROLE');
  assert.equal(validateRoleChangeRequest({ requesterProfile: admin, targetProfile: parent, toRole: 'PARENT', profiles: [admin, parent] }).code, 'NO_CHANGE');
});

test('request: blocks demoting the last active admin', () => {
  const res = validateRoleChangeRequest({ requesterProfile: admin, targetProfile: admin, toRole: 'TEACHER', profiles: [admin, parent] });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'LAST_ADMIN');
});

test('request: allows admin demotion when another admin (besides actor and target) remains', () => {
  // The last-admin guard excludes both the actor and the target, so a third
  // active admin must exist for a demotion to pass.
  const admin3 = { id: 'p-admin3', user_id: 'u-admin3', school_id: 's1', app_role: 'ADMIN', status: 'ACTIVE' };
  const res = validateRoleChangeRequest({ requesterProfile: admin, targetProfile: admin2, toRole: 'TEACHER', profiles: [admin, admin2, admin3] });
  assert.equal(res.ok, true);
});

test('request: a valid promotion passes', () => {
  const res = validateRoleChangeRequest({ requesterProfile: admin, targetProfile: parent, toRole: 'TEACHER', profiles: [admin, parent] });
  assert.equal(res.ok, true);
});

const openChange = {
  id: 'c1',
  school_id: 's1',
  status: ROLE_CHANGE_STATUS.PENDING_SECOND_ADMIN_APPROVAL,
  requester_profile_id: 'p-admin',
  requester_user_id: 'u-admin',
  target_profile_id: 'p-parent',
  payload: { from_role: 'PARENT', to_role: 'ADMIN' },
};

test('decision: C2 — requester cannot approve their own change (by profile id)', () => {
  const res = validateRoleChangeDecision({ change: openChange, approverProfile: admin, targetProfile: parent, profiles: [admin, admin2, parent], decision: 'approve' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'SELF_APPROVAL');
});

test('decision: C2 — requester cannot approve even if a different profile shares their user id', () => {
  const impostorProfile = { ...admin2, user_id: 'u-admin' }; // same human, different profile row
  const res = validateRoleChangeDecision({ change: openChange, approverProfile: impostorProfile, targetProfile: parent, profiles: [admin, impostorProfile, parent], decision: 'approve' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'SELF_APPROVAL');
});

test('decision: a different admin can approve', () => {
  const res = validateRoleChangeDecision({ change: openChange, approverProfile: admin2, targetProfile: parent, profiles: [admin, admin2, parent], decision: 'approve' });
  assert.equal(res.ok, true);
});

test('decision: already-resolved changes cannot be re-decided', () => {
  const resolved = { ...openChange, status: ROLE_CHANGE_STATUS.APPROVED };
  const res = validateRoleChangeDecision({ change: resolved, approverProfile: admin2, targetProfile: parent, profiles: [admin, admin2, parent], decision: 'approve' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'NOT_OPEN');
});

test('decision: non-admin cannot resolve', () => {
  const res = validateRoleChangeDecision({ change: openChange, approverProfile: teacher, targetProfile: parent, profiles: [admin, teacher, parent], decision: 'approve' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'NOT_ADMIN');
});

test('decision: cannot resolve a change from another school', () => {
  const foreign = { ...openChange, school_id: 's2' };
  const res = validateRoleChangeDecision({ change: foreign, approverProfile: admin2, targetProfile: parent, profiles: [admin, admin2, parent], decision: 'approve' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'CROSS_TENANT');
});

test('decision: approving an admin-demotion is blocked when it would remove the last admin', () => {
  // admin requests demoting itself; admin2 approves. The last-admin guard
  // excludes the actor and the target, so with only these two admins the
  // demotion leaves nobody eligible -> blocked.
  const selfDemotion = {
    ...openChange,
    requester_profile_id: 'p-admin',
    requester_user_id: 'u-admin',
    target_profile_id: 'p-admin',
    payload: { from_role: 'ADMIN', to_role: 'TEACHER' },
  };
  const blocked = validateRoleChangeDecision({ change: selfDemotion, approverProfile: admin2, targetProfile: admin, profiles: [admin, admin2], decision: 'approve' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'LAST_ADMIN');

  // With a third admin present, the same demotion is allowed.
  const admin3 = { id: 'p-admin3', user_id: 'u-admin3', school_id: 's1', app_role: 'ADMIN', status: 'ACTIVE' };
  const allowed = validateRoleChangeDecision({ change: selfDemotion, approverProfile: admin2, targetProfile: admin, profiles: [admin, admin2, admin3], decision: 'approve' });
  assert.equal(allowed.ok, true);
});

test('decision: reject does not require last-admin check and can be done by any other admin', () => {
  const res = validateRoleChangeDecision({ change: openChange, approverProfile: admin2, targetProfile: parent, profiles: [admin, admin2, parent], decision: 'reject' });
  assert.equal(res.ok, true);
});
