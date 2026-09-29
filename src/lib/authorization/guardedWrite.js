import { base44 } from '@/api/base44Client';
import { invokeFunction } from '@/lib/functionResponse';

/**
 * Thin client wrapper around the guardedEntityWrite Safe function — the
 * sanctioned write path for the 7 entities whose access can be overridden
 * per-user via PermissionOverride (Notice, Attendance, Homework, DiaryEntry,
 * ChargeItem, PaymentConcept, PaymentRecord). See
 * base44/functions/guardedEntityWrite/entry.ts for why this exists and what
 * it enforces (role policy + PermissionOverride + billing read-only gate).
 *
 * Call sites that used to write these entities directly via
 * base44.entities.X.create/update/delete(...) go through here instead — same
 * calling shape (data in, record out) so migrating a call site is a
 * near-mechanical swap. On denial the invoke call throws with
 * `error.data.error`/`error.data.code`, same convention as governRoleChange
 * and provisionOnboardingProfile. Goes through invokeFunction
 * (src/lib/functionResponse.js), which unwraps the axios response.
 */
export async function guardedCreate(entity, data) {
  const body = await invokeFunction(base44, 'guardedEntityWrite', { entity, operation: 'create', data });
  return body?.record;
}

export async function guardedUpdate(entity, id, data) {
  const body = await invokeFunction(base44, 'guardedEntityWrite', { entity, operation: 'update', id, data });
  return body?.record;
}

export async function guardedDelete(entity, id) {
  await invokeFunction(base44, 'guardedEntityWrite', { entity, operation: 'delete', id });
}
