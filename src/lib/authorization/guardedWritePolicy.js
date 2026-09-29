/**
 * Which role may run which write through guardedEntityWrite — the client's
 * copy of the server table (base44/functions/guardedEntityWrite/_policy.ts,
 * `guardedWriteTable()`), for UI gating only: hide a button a role would be
 * refused, never decide access. The server re-derives the caller's school and
 * role and decides every write itself.
 *
 * tests/unit/write-path-p10b.test.js fails if this drifts from the server.
 *
 * Two server rules this table cannot express, on purpose:
 *   - the 7 overridable entities (Notice … PaymentRecord) also honor a
 *     per-user PermissionOverride, and a teacher may only update what they
 *     authored (Attendance: their classroom's); a PARENT may create one
 *     ChargeItem (paying for an event) — see guardedEntityWrite/entry.ts;
 *   - NoticeDelivery.update is the recipient's own copy only.
 */
const ADMIN = ['ADMIN'];
const STAFF = ['ADMIN', 'TEACHER'];
const EVERYONE = ['ADMIN', 'TEACHER', 'PARENT'];

const overridable = (roles) => ({ create: roles, update: roles, delete: roles.filter((r) => r === 'ADMIN') });

export const GUARDED_WRITE_ROLES = {
  Notice: overridable(STAFF),
  Attendance: overridable(STAFF),
  Homework: overridable(STAFF),
  DiaryEntry: overridable(STAFF),
  ChargeItem: overridable(ADMIN),
  PaymentConcept: overridable(ADMIN),
  PaymentRecord: overridable(ADMIN),
  // P10b — entities whose RLS is platform-owner only.
  Classroom: { create: ADMIN, update: ADMIN },
  Student: { create: ADMIN, update: ADMIN },
  TeacherClassroom: { create: ADMIN, update: ADMIN },
  ParentStudent: { create: ADMIN, update: ADMIN },
  Event: { create: ADMIN, update: ADMIN, delete: ADMIN },
  Discount: { create: ADMIN, update: ADMIN, delete: ADMIN },
  OfficialDocument: { create: ADMIN, update: ADMIN, delete: ADMIN },
  SchoolSetupGuide: { create: ADMIN, update: ADMIN, delete: ADMIN },
  PermissionOverride: { create: ADMIN, update: ADMIN, delete: ADMIN },
  PendingChange: { create: ADMIN },
  AbsenceNotification: { update: ADMIN },
  UniformOrder: { update: ADMIN },
  NoticeDelivery: { create: STAFF, update: EVERYONE },
  SupportTicket: { create: EVERYONE, update: ADMIN },
};

export function isGuardedWrite(entity, operation) {
  return Object.prototype.hasOwnProperty.call(GUARDED_WRITE_ROLES, entity)
    && Array.isArray(GUARDED_WRITE_ROLES[entity][operation]);
}

/** May `role` attempt this write at all? (The server may still refuse it.) */
export function canGuardedWrite(role, entity, operation) {
  return isGuardedWrite(entity, operation) && GUARDED_WRITE_ROLES[entity][operation].includes(role);
}
