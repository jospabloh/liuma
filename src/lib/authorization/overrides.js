import { base44 } from '@/api/base44Client';
import { DENIAL_REASON_CODES } from '@/lib/authorization/policy';

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

function assertOverrideSafety(input) {
  if (input.action !== 'manage_permissions') return;
  if (input.actor_profile_id && input.user_profile_id && input.actor_profile_id === input.user_profile_id) {
    const error = new Error('SELF_MANAGE_PERMISSIONS_CHANGE_BLOCKED');
    error.reason_code = DENIAL_REASON_CODES.SELF_PERMISSION_CHANGE_DENIED;
    throw error;
  }
}

export async function listPermissionOverrides({ schoolId }) {
  if (!schoolId) return [];
  return base44.entities[ENTITY].filter({ school_id: schoolId });
}

export async function createPermissionOverride(input) {
  assertOverrideSafety(input);
  return base44.entities[ENTITY].create(buildOverridePayload(input));
}

export async function updatePermissionOverride(id, input) {
  assertOverrideSafety(input);
  return base44.entities[ENTITY].update(id, buildOverridePayload(input));
}

export async function deletePermissionOverride(id) {
  return base44.entities[ENTITY].delete(id);
}
