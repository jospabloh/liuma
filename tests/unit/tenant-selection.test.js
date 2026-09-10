import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCurrentUserProfile, sortProfilesForTenantSelection } from '../../src/lib/tenantSelection.js';

test('first-login tenant creation selects the newly completed active profile after refetch', () => {
  const selected = selectCurrentUserProfile([
    { id: 'old-profile', school_id: 'old-school', status: 'ACTIVE', app_role: 'ADMIN', created_date: '2026-05-17T10:00:00.000Z' },
    { id: 'new-profile', school_id: 'new-school', status: 'ACTIVE', app_role: 'ADMIN', onboarding_completed: true, created_date: '2026-05-18T10:00:00.000Z' },
  ]);

  assert.equal(selected.id, 'new-profile');
  assert.equal(selected.school_id, 'new-school');
});

test('profile selection is deterministic regardless of the order the API returns', () => {
  // Base44's filter() does not guarantee order, and two readers of this same
  // function picking different profiles is exactly the module-14 finding this
  // helper exists to close. Same set, reversed input, same answer.
  const profiles = [
    { id: 'old-profile', school_id: 'old-school', status: 'ACTIVE', app_role: 'ADMIN', onboarding_completed: true, created_date: '2026-05-17T10:00:00.000Z' },
    { id: 'new-profile', school_id: 'new-school', status: 'ACTIVE', app_role: 'ADMIN', onboarding_completed: true, created_date: '2026-05-18T10:00:00.000Z' },
  ];

  assert.equal(selectCurrentUserProfile(profiles).id, 'new-profile');
  assert.equal(selectCurrentUserProfile([...profiles].reverse()).id, 'new-profile');
  assert.deepEqual(
    sortProfilesForTenantSelection(profiles).map((p) => p.id),
    ['new-profile', 'old-profile'],
  );
});
