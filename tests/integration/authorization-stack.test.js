import test from 'node:test';
import assert from 'node:assert/strict';
import { getRouteAccessDecision } from '../../src/lib/authorization/routeAccess.js';
import {
  applyTenantScopeToQuery,
  assertTenantScope,
  buildScopedFilter,
  filterByRowLevel,
  getEffectivePolicyDecision,
} from '../../src/lib/authorization/policy.js';

const paymentRecords = [
  { id: 'pay-a1', school_id: 'school-a', student_id: 'student-a1', scope: 'STUDENT' },
  { id: 'pay-a2', school_id: 'school-a', student_id: 'student-a2', scope: 'STUDENT' },
  { id: 'pay-b1', school_id: 'school-b', student_id: 'student-b1', scope: 'STUDENT' },
];

function rowMatchesFilter(row, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (expected && Array.isArray(expected.$in)) return expected.$in.includes(row[key]);
    return row[key] === expected;
  });
}

function readGuardedPaymentRecords({ actor, targetSchoolId, routeName = 'PagosAdmin', ownerAccess }) {
  const routeDecision = getRouteAccessDecision({ role: actor.role, routeName, ownerAccess });
  if (!routeDecision.allowed) return { stage: 'route', decision: routeDecision, rows: [] };

  const policyDecision = getEffectivePolicyDecision({
    role: actor.role,
    entity: 'PaymentRecord',
    action: 'read',
    userProfileId: actor.profileId,
    overrides: actor.overrides || [],
  });
  if (!policyDecision.allowed) return { stage: 'policy', decision: policyDecision, rows: [] };

  const tenantDecision = assertTenantScope({ actorSchoolId: actor.schoolId, targetSchoolId });
  if (!tenantDecision.allowed) return { stage: 'tenant', decision: tenantDecision, rows: [] };

  const scopedFilter = applyTenantScopeToQuery(
    {},
    buildScopedFilter({
      role: actor.role,
      entity: 'PaymentRecord',
      schoolId: targetSchoolId,
      classroomIds: actor.classroomIds || [],
      studentIds: actor.studentIds || [],
    }) || {}
  );
  const tenantRows = paymentRecords.filter((row) => rowMatchesFilter(row, scopedFilter));

  return {
    stage: 'data',
    decision: { allowed: true },
    filter: scopedFilter,
    rows: filterByRowLevel({
      role: actor.role,
      entity: 'PaymentRecord',
      rows: tenantRows,
      classroomIds: actor.classroomIds || [],
      studentIds: actor.studentIds || [],
    }),
  };
}

test('route guard, policy, and data scope combine to return only same-tenant payment records', () => {
  const result = readGuardedPaymentRecords({
    actor: { profileId: 'admin-a', role: 'ADMIN', schoolId: 'school-a' },
    targetSchoolId: 'school-a',
  });

  assert.equal(result.stage, 'data');
  assert.deepEqual(result.filter, { school_id: 'school-a' });
  assert.deepEqual(result.rows.map((row) => row.id), ['pay-a1', 'pay-a2']);
});

test('route guard, policy, and data scope fail closed before cross-tenant rows can leak', () => {
  const result = readGuardedPaymentRecords({
    actor: { profileId: 'admin-a', role: 'ADMIN', schoolId: 'school-a' },
    targetSchoolId: 'school-b',
  });

  assert.equal(result.stage, 'tenant');
  assert.equal(result.decision.allowed, false);
  assert.equal(result.decision.reason_code, 'cross_tenant_denied');
  assert.deepEqual(result.rows, []);
});

test('route guard and policy both deny non-admin payment-record access before data loading', () => {
  const routeBlocked = readGuardedPaymentRecords({
    actor: { profileId: 'teacher-a', role: 'TEACHER', schoolId: 'school-a' },
    targetSchoolId: 'school-a',
  });
  const policyBlocked = readGuardedPaymentRecords({
    actor: { profileId: 'parent-a', role: 'PARENT', schoolId: 'school-a', studentIds: ['student-a1'] },
    targetSchoolId: 'school-a',
    routeName: 'Pagos',
  });

  assert.equal(routeBlocked.stage, 'route');
  assert.equal(routeBlocked.decision.reason_code, 'forbidden_action');
  assert.equal(policyBlocked.stage, 'policy');
  assert.equal(policyBlocked.decision.allowed, false);
  assert.equal(policyBlocked.decision.reason_code, 'default_deny');
});
