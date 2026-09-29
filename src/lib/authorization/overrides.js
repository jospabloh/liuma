import { schoolRead } from '@/lib/data/schoolRead';
import { DENIAL_REASON_CODES } from '@/lib/authorization/policy';
import { guardedCreate, guardedUpdate, guardedDelete } from '@/lib/authorization/guardedWrite';

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
  // Through schoolRead (P10): PermissionOverride.read is platform-owner only
  // under RLS, so a director listed nothing.
  return schoolRead(ENTITY, { school_id: schoolId });
}

// Writes go through guardedEntityWrite (P10b): PermissionOverride is
// platform-owner only under RLS, so a director could list overrides (P10) but
// not create one. The server checks the caller is an ADMIN of the target
// profile's school and that resource/action/effect are ones it enforces.
export async function createPermissionOverride(input) {
  assertOverrideSafety(input);
  return guardedCreate(ENTITY, buildOverridePayload(input));
}

export async function updatePermissionOverride(id, input) {
  assertOverrideSafety(input);
  return guardedUpdate(ENTITY, id, buildOverridePayload(input));
}

export async function deletePermissionOverride(id) {
  return guardedDelete(ENTITY, id);
}
