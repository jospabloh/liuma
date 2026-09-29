import { base44 } from '@/api/base44Client';
import { invokeFunction } from '@/lib/functionResponse';

/**
 * Thin client wrapper around the guardedFamilyWrite function — the only
 * write path for the records a family writes about a child
 * (EmergencyContact, AbsenceNotification, EventResponse, UniformOrder).
 * Their create/update RLS is service-role only since P7 (2026-09-29): the
 * function checks the caller is linked to the child (or is an ADMIN of the
 * child's school) and fills school_id / parent_id / status itself. See
 * base44/functions/guardedFamilyWrite/entry.ts.
 *
 * Same calling shape as guardedWrite.js (data in, record out). On denial the
 * invoke call throws with `error.data.code` / `error.data.error`.
 */
export async function familyCreate(entity, data) {
  const body = await invokeFunction(base44, 'guardedFamilyWrite', { entity, operation: 'create', data });
  return body?.record;
}

/** Returns `{ record, pickupRevoked }` — see EmergencyContact in the function. */
export async function familyUpdate(entity, id, data) {
  const body = await invokeFunction(base44, 'guardedFamilyWrite', { entity, operation: 'update', id, data });
  return { record: body?.record, pickupRevoked: body?.pickupRevoked === true };
}

export async function familyDelete(entity, id) {
  await invokeFunction(base44, 'guardedFamilyWrite', { entity, operation: 'delete', id });
}
