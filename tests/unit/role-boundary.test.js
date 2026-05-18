import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertRoleAccess,
  assertTenantScope,
  assertTeacherClassroomScope,
  assertParentStudentScope,
} from '../../src/lib/authorization/policy.js';

test('forbidden action denial', () => {
  const result = assertRoleAccess({ role: 'PARENT', entity: 'PaymentRecord', action: 'read' });
  assert.equal(result.allowed, false);
  assert.equal(result.reason_code, 'forbidden_action');
});

test('cross-tenant denial', () => {
  const result = assertTenantScope({ actorSchoolId: 'tenant-1', targetSchoolId: 'tenant-2' });
  assert.equal(result.allowed, false);
  assert.equal(result.reason_code, 'cross_tenant_denied');
});

test('cross-classroom denial for teacher', () => {
  const result = assertTeacherClassroomScope({ role: 'TEACHER', classroomIds: ['c-1'], targetClassroomId: 'c-2' });
  assert.equal(result.allowed, false);
  assert.equal(result.reason_code, 'cross_classroom_denied');
});

test('unrelated-student denial for parent', () => {
  const result = assertParentStudentScope({ role: 'PARENT', studentIds: ['s-1'], targetStudentId: 's-9' });
  assert.equal(result.allowed, false);
  assert.equal(result.reason_code, 'unrelated_student_denied');
});
