import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DANGER_ZONE_OPERATIONS,
  evaluateDangerZoneRequest,
  getRollbackPolicy,
  isHighRiskOperation,
} from '../../src/lib/authorization/tenantDangerZone.js';

const admin = { id: 'admin-1', app_role: 'ADMIN', school_id: 'tenant-1' };

test('all danger-zone operations are marked high-risk for maker-checker enforcement', () => {
  Object.values(DANGER_ZONE_OPERATIONS).forEach((operation) => {
    assert.equal(isHighRiskOperation(operation), true);
  });
});

test('allows admin with second admin approval in same tenant to perform high-risk operation', () => {
  const result = evaluateDangerZoneRequest({
    operation: DANGER_ZONE_OPERATIONS.SUSPEND_TENANT,
    actorProfile: admin,
    requesterProfileId: 'admin-1',
    approverProfileId: 'admin-2',
    hasSecondAdminApproval: true,
    targetTenantId: 'tenant-1',
    actorTenantId: 'tenant-1',
    reason: 'Incidente de seguridad',
    approvalReason: 'Validado por segundo admin',
    appOwnerProfileId: 'owner-1',
  });

  assert.deepEqual(result, { allowed: true, reason: 'approved' });
});

test('denies when actor is not admin to keep danger-zone admin-only', () => {
  const result = evaluateDangerZoneRequest({
    operation: DANGER_ZONE_OPERATIONS.DELETE_TENANT,
    actorProfile: { ...admin, app_role: 'TEACHER' },
    requesterProfileId: 'teacher-1',
    approverProfileId: 'admin-2',
    hasSecondAdminApproval: true,
    targetTenantId: 'tenant-1',
    actorTenantId: 'tenant-1',
    reason: 'Cleanup',
    approvalReason: 'Approved',
  });

  assert.deepEqual(result, { allowed: false, reason: 'admin_only', reason_code: 'admin_only' });
});

test('denies self-approval to preserve maker-checker separation of duties', () => {
  const result = evaluateDangerZoneRequest({
    operation: DANGER_ZONE_OPERATIONS.RESET_TENANT_DATA,
    actorProfile: admin,
    requesterProfileId: 'admin-1',
    approverProfileId: 'admin-1',
    hasSecondAdminApproval: true,
    targetTenantId: 'tenant-1',
    actorTenantId: 'tenant-1',
    reason: 'Prueba controlada',
    approvalReason: 'auto',
    appOwnerProfileId: 'owner-1',
  });

  assert.deepEqual(result, { allowed: false, reason: 'self_approval_denied', reason_code: 'self_approval_denied' });
});

test('denies requests without mandatory request and approval reasons', () => {
  const result = evaluateDangerZoneRequest({
    operation: DANGER_ZONE_OPERATIONS.TRANSFER_TENANT_OWNERSHIP,
    actorProfile: admin,
    requesterProfileId: 'admin-1',
    approverProfileId: 'admin-2',
    hasSecondAdminApproval: true,
    targetTenantId: 'tenant-1',
    actorTenantId: 'tenant-1',
    reason: ' ',
    approvalReason: ' ',
  });

  assert.deepEqual(result, { allowed: false, reason: 'reason_required', reason_code: 'reason_required' });
});

test('denies cross-tenant requests to enforce tenant scope verification', () => {
  const result = evaluateDangerZoneRequest({
    operation: DANGER_ZONE_OPERATIONS.SUSPEND_TENANT,
    actorProfile: admin,
    requesterProfileId: 'admin-1',
    approverProfileId: 'admin-2',
    hasSecondAdminApproval: true,
    targetTenantId: 'tenant-2',
    actorTenantId: 'tenant-1',
    reason: 'Incidente',
    approvalReason: 'Validado',
  });

  assert.deepEqual(result, { allowed: false, reason: 'cross_tenant_denied', reason_code: 'cross_tenant_denied' });
});

test('preserves app owner exemption from second admin approval requirement', () => {
  const result = evaluateDangerZoneRequest({
    operation: DANGER_ZONE_OPERATIONS.DELETE_TENANT,
    actorProfile: admin,
    requesterProfileId: 'owner-1',
    approverProfileId: null,
    hasSecondAdminApproval: false,
    targetTenantId: 'tenant-1',
    actorTenantId: 'tenant-1',
    reason: 'Cierre legal',
    approvalReason: 'No aplica para owner',
    appOwnerProfileId: 'owner-1',
  });

  assert.deepEqual(result, { allowed: true, reason: 'approved' });
});

test('rollback policy documents which operations can be compensated', () => {
  assert.equal(getRollbackPolicy(DANGER_ZONE_OPERATIONS.SUSPEND_TENANT), 'SUSPEND_UNSUSPEND');
  assert.equal(getRollbackPolicy(DANGER_ZONE_OPERATIONS.TRANSFER_TENANT_OWNERSHIP), 'TRANSFER_REVERSAL_FLOW');
  assert.equal(getRollbackPolicy(DANGER_ZONE_OPERATIONS.RESET_TENANT_DATA), 'NO_ROLLBACK_UNLESS_SNAPSHOT');
  assert.equal(getRollbackPolicy(DANGER_ZONE_OPERATIONS.DELETE_TENANT), 'NO_ROLLBACK_UNLESS_SNAPSHOT');
});
