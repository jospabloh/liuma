import { base44 } from '@/api/base44Client';
import { invokeFunction } from '@/lib/functionResponse';
import { isGuardedWrite } from '@/lib/authorization/guardedWritePolicy';

/**
 * Thin client wrapper around the guardedEntityWrite function — the only write
 * path for every school entity a school user writes whose RLS does not let
 * them write it directly:
 *
 *  - the 7 entities whose access can be overridden per-user via
 *    PermissionOverride (Notice, Attendance, Homework, DiaryEntry,
 *    ChargeItem, PaymentConcept, PaymentRecord) — role policy + override +
 *    billing read-only gate + authorship;
 *  - since P10b, the ones whose deployed RLS is platform-owner only
 *    (Classroom, Student, TeacherClassroom, ParentStudent, Event, Discount,
 *    OfficialDocument, SchoolSetupGuide, PermissionOverride, PendingChange,
 *    the school's review of AbsenceNotification/UniformOrder, NoticeDelivery,
 *    SupportTicket) — allowlisted fields, same-school references.
 *
 * The server takes the school and the role from the caller's own current
 * UserProfile. A `school_id` sent here is at most a confirmation: another
 * school's id is refused (403 SCHOOL_MISMATCH), never honored.
 *
 * Same calling shape as the entity SDK it replaced (data in, record out). On
 * denial it throws with `error.data.error`/`error.data.code`, via
 * invokeFunction (src/lib/functionResponse.js), which unwraps the axios
 * response. See base44/functions/guardedEntityWrite/entry.ts.
 */
function assertGuarded(entity, operation) {
  if (!isGuardedWrite(entity, operation)) {
    throw new Error(`guardedEntityWrite does not ${operation} ${entity}`);
  }
}

export async function guardedCreate(entity, data) {
  assertGuarded(entity, 'create');
  const body = await invokeFunction(base44, 'guardedEntityWrite', { entity, operation: 'create', data });
  return body?.record;
}

export async function guardedUpdate(entity, id, data) {
  assertGuarded(entity, 'update');
  const body = await invokeFunction(base44, 'guardedEntityWrite', { entity, operation: 'update', id, data });
  return body?.record;
}

export async function guardedDelete(entity, id) {
  assertGuarded(entity, 'delete');
  await invokeFunction(base44, 'guardedEntityWrite', { entity, operation: 'delete', id });
}

/**
 * Deliver a published notice to its audience. The server reads the stored
 * notice, picks the recipients (the ACTIVE parents of its school's students in
 * the notice's scope) and skips copies that already exist, so a retry never
 * double-sends. Resolves to how many copies were created.
 */
export async function publishNoticeDeliveries(noticeId) {
  const body = await invokeFunction(base44, 'guardedEntityWrite', {
    entity: 'NoticeDelivery',
    operation: 'create',
    data: { notice_id: noticeId },
  });
  return Number(body?.created || 0);
}
