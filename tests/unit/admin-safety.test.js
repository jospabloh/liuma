import test from 'node:test';
import assert from 'node:assert/strict';
import { hasOtherActiveAdminWithManagePermissions } from '../../src/lib/authorization/adminSafety.js';

test('returns false when target admin is the only other active admin', () => {
  const result = hasOtherActiveAdminWithManagePermissions({
    profiles: [
      { id: 'admin-1', app_role: 'ADMIN', status: 'ACTIVE' },
      { id: 'admin-2', app_role: 'ADMIN', status: 'ACTIVE' },
    ],
    actorProfileId: 'admin-1',
    targetProfileId: 'admin-2',
  });

  assert.equal(result, false);
});

test('returns true when a third active admin exists', () => {
  const result = hasOtherActiveAdminWithManagePermissions({
    profiles: [
      { id: 'admin-1', app_role: 'ADMIN', status: 'ACTIVE' },
      { id: 'admin-2', app_role: 'ADMIN', status: 'ACTIVE' },
      { id: 'admin-3', app_role: 'ADMIN', status: 'ACTIVE' },
    ],
    actorProfileId: 'admin-1',
    targetProfileId: 'admin-2',
  });

  assert.equal(result, true);
});
