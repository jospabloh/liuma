import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTenantSelectionContext, selectCurrentUserProfile } from '../../src/lib/tenantSelection.js';

test('first-login tenant creation selects the newly completed active profile after refetch', () => {
  const selected = selectCurrentUserProfile([
    { id: 'old-profile', school_id: 'old-school', status: 'ACTIVE', app_role: 'ADMIN', created_date: '2026-05-17T10:00:00.000Z' },
    { id: 'new-profile', school_id: 'new-school', status: 'ACTIVE', app_role: 'ADMIN', onboarding_completed: true, created_date: '2026-05-18T10:00:00.000Z' },
  ]);

  assert.equal(selected.id, 'new-profile');
  assert.equal(selected.school_id, 'new-school');
});

test('admin tenant selection context includes a newly created tenant as the current option', () => {
  const context = buildTenantSelectionContext({
    currentSchoolId: 'new-school',
    profiles: [
      { id: 'old-profile', school_id: 'old-school', status: 'ACTIVE', app_role: 'ADMIN', created_date: '2026-05-17T10:00:00.000Z' },
      { id: 'new-profile', school_id: 'new-school', status: 'ACTIVE', app_role: 'ADMIN', created_date: '2026-05-18T10:00:00.000Z' },
      { id: 'pending-profile', school_id: 'pending-school', status: 'PENDING', app_role: 'TEACHER', created_date: '2026-05-18T11:00:00.000Z' },
    ],
    schools: [
      { id: 'old-school', name: 'Colegio Anterior' },
      { id: 'new-school', name: 'Colegio Nuevo' },
    ],
  });

  assert.deepEqual(context, {
    current_school_id: 'new-school',
    options: [
      { profile_id: 'new-profile', school_id: 'new-school', school_name: 'Colegio Nuevo', app_role: 'ADMIN', is_current: true },
      { profile_id: 'old-profile', school_id: 'old-school', school_name: 'Colegio Anterior', app_role: 'ADMIN', is_current: false },
    ],
  });
});
