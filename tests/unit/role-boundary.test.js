import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertRoleAccess,
  assertTenantScope,
  assertTeacherClassroomScope,
  assertParentStudentScope,
} from '../../src/lib/authorization/policy.js';

test('forbidden action denial', () => {
  assert.deepEqual(assertRoleAccess({ role: 'PARENT', entity: 'PaymentRecord', action: 'read' }), { allowed: false, reason: 'forbidden_action' });
});

test('cross-tenant denial', () => {
  assert.deepEqual(assertTenantScope({ actorSchoolId: 'tenant-1', targetSchoolId: 'tenant-2' }), { allowed: false, reason: 'cross_tenant_denied' });
});

test('cross-classroom denial for teacher', () => {
  assert.deepEqual(assertTeacherClassroomScope({ role: 'TEACHER', classroomIds: ['c-1'], targetClassroomId: 'c-2' }), { allowed: false, reason: 'cross_classroom_denied' });
});

test('unrelated-student denial for parent', () => {
  assert.deepEqual(assertParentStudentScope({ role: 'PARENT', studentIds: ['s-1'], targetStudentId: 's-9' }), { allowed: false, reason: 'unrelated_student_denied' });
});
