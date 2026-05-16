import { base44 } from '@/api/base44Client';

const ENTITY = 'PermissionOverride';

function buildOverridePayload(input) {
  return {
    school_id: input.school_id,
    user_profile_id: input.user_profile_id,
    resource: input.resource,
    action: input.action,
    effect: input.effect,
    reason: input.reason,
  };
}

export async function listPermissionOverrides({ schoolId }) {
  if (!schoolId) return [];
  return base44.entities[ENTITY].filter({ school_id: schoolId });
}

export async function createPermissionOverride(input) {
  return base44.entities[ENTITY].create(buildOverridePayload(input));
}

export async function updatePermissionOverride(id, input) {
  return base44.entities[ENTITY].update(id, buildOverridePayload(input));
}

export async function deletePermissionOverride(id) {
  return base44.entities[ENTITY].delete(id);
}
