import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveOnboardingProvision,
  buildOnboardingUpsert,
} from '../../src/lib/authorization/onboardingProvision.js';

const founder = { id: 'u-founder' };
const joiner = { id: 'u-joiner' };
const newSchool = { id: 's1', created_by_user_id: 'u-founder' };

test('founder of a brand-new school is provisioned as ACTIVE ADMIN', () => {
  const res = resolveOnboardingProvision({ user: founder, school: newSchool, role: 'ADMIN', schoolAdmins: [] });
  assert.deepEqual(res, { ok: true, code: null, message: null, appRole: 'ADMIN', status: 'ACTIVE' });
});

test('a non-founder cannot self-assign ADMIN', () => {
  const res = resolveOnboardingProvision({ user: joiner, school: newSchool, role: 'ADMIN', schoolAdmins: [] });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'ADMIN_NOT_ALLOWED');
});

test('even the founder cannot self-assign ADMIN once another active admin exists', () => {
  const admins = [{ id: 'p-other', user_id: 'u-other', app_role: 'ADMIN', status: 'ACTIVE' }];
  const res = resolveOnboardingProvision({ user: founder, school: newSchool, role: 'ADMIN', schoolAdmins: admins });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'ADMIN_NOT_ALLOWED');
});

test('the founder re-provisioning (their own admin profile present) is still allowed', () => {
  const admins = [{ id: 'p-self', user_id: 'u-founder', app_role: 'ADMIN', status: 'ACTIVE' }];
  const res = resolveOnboardingProvision({ user: founder, school: newSchool, role: 'ADMIN', schoolAdmins: admins });
  assert.equal(res.ok, true);
  assert.equal(res.appRole, 'ADMIN');
});

test('a joiner is provisioned as PENDING with the requested non-admin role', () => {
  const teacher = resolveOnboardingProvision({ user: joiner, school: newSchool, role: 'TEACHER', schoolAdmins: [] });
  assert.deepEqual(teacher, { ok: true, code: null, message: null, appRole: 'TEACHER', status: 'PENDING' });
  const parent = resolveOnboardingProvision({ user: joiner, school: newSchool, role: 'PARENT', schoolAdmins: [] });
  assert.equal(parent.status, 'PENDING');
});

test('invalid role and missing school are rejected', () => {
  assert.equal(resolveOnboardingProvision({ user: founder, school: newSchool, role: 'SUPERUSER' }).code, 'INVALID_ROLE');
  assert.equal(resolveOnboardingProvision({ user: founder, school: null, role: 'ADMIN' }).code, 'SCHOOL_NOT_FOUND');
});

test('upsert creates a full profile for a new user and never sets is_super_admin', () => {
  const upsert = buildOnboardingUpsert({ user: founder, schoolId: 's1', phone: '555', appRole: 'ADMIN', status: 'ACTIVE', existingProfile: null });
  assert.equal(upsert.action, 'create');
  assert.deepEqual(upsert.payload, {
    user_id: 'u-founder',
    school_id: 's1',
    app_role: 'ADMIN',
    status: 'ACTIVE',
    phone: '555',
    onboarding_completed: true,
  });
  assert.equal('is_super_admin' in upsert.payload, false);
});

test('upsert on an existing profile never rewrites app_role or status', () => {
  const upsert = buildOnboardingUpsert({
    user: joiner,
    schoolId: 's1',
    phone: '',
    appRole: 'PARENT',
    status: 'PENDING',
    existingProfile: { id: 'p-existing', app_role: 'ADMIN', status: 'ACTIVE' },
  });
  assert.equal(upsert.action, 'update');
  assert.equal(upsert.id, 'p-existing');
  assert.deepEqual(upsert.payload, { phone: '', onboarding_completed: true });
  assert.equal('app_role' in upsert.payload, false);
  assert.equal('status' in upsert.payload, false);
});
