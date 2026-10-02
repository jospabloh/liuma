// _schoolWrite.ts — the P10b tenant write path of guardedEntityWrite, for the
// entities in SCHOOL_WRITES (./_policy.ts): Classroom, Student,
// TeacherClassroom, ParentStudent, Event, Discount, OfficialDocument,
// SchoolSetupGuide, PermissionOverride, PendingChange, the school's review of
// AbsenceNotification/UniformOrder, NoticeDelivery and SupportTicket.
//
// Their deployed RLS is platform-owner only (or, for NoticeDelivery and
// SupportTicket since P10b, service-role only on create), and it stays that
// way — owner decision. A school user writes them through here, with the
// service role, and this file decides:
//
//   1. WHO: the caller's CURRENT UserProfile (selectCurrentProfile — the same
//      rule schoolRead uses), which must be ACTIVE. Nothing in the body names
//      the school or the role.
//   2. WHERE: create → the profile's school (a school_id in the body must be
//      that one, or it is 403 SCHOOL_MISMATCH); update/delete → the STORED
//      record's school, which must be the caller's.
//   3. WHAT: SCHOOL_WRITES' role table per operation, the license read-only
//      gate (fails closed, same as the other entities), and record-level
//      rules (decideSchoolRecord).
//   4. WITH WHICH DATA: only the entity's allowlisted fields, typed
//      (buildSchoolWrite); server-stamped attribution; every referenced id —
//      student, classroom, notice, profile, teacher, parent — must belong to
//      the same school.
//
// The school's review of a family request (AbsenceNotification approved or
// rejected, a UniformOrder moving on) emails the parent who filed it, after
// the write (./_statusNotify.ts, best-effort, never throws).
//
// Import-free apart from its siblings (./_policy.ts, ./_money.ts,
// ./_statusNotify.ts, ./_templates.ts) and duck-typed on `sr.entities[Name]`,
// so tests/unit/write-path-p10b.test.js runs the real thing against an
// in-memory database with two schools.
import {
  buildSchoolWrite,
  callerDisplayName,
  decideCreateTargets,
  decideSchoolRecord,
  effectiveLicenseIsReadOnly,
  consentExempt,
  licenseExempt,
  licenseExemptPatch,
  planNoticeDeliveries,
  reactivatesGrant,
  profileProblem,
  referencesToCheck,
  schoolWriteRule,
  selectCurrentProfile,
  addsActiveStudent,
  studentHardLimit,
  studentPlanLimit,
  studentQuotaRefusal,
  userReferencesToCheck,
} from './_policy.ts';
import type { CallerProfile, Op } from './_policy.ts';
import { validateDiscount } from './_money.ts';
import { notifyStatusChange, statusEventFor } from './_statusNotify.ts';
import { NOTIFICATION_TEMPLATES } from './_templates.ts';

const DISCOUNT_TERMS = ['discount_type', 'discount_value', 'valid_from', 'valid_until', 'applicable_to_concepts'];

// deno-lint-ignore no-explicit-any
export type Db = any;
export type Caller = { id: string; role?: string | null; full_name?: string | null; email?: string | null };
export type WriteResult = { status: number; body: Record<string, unknown> };

const OPERATIONS: Op[] = ['create', 'update', 'delete'];
const MAX_FANOUT = 2000;
const BULK_CHUNK = 100;

function fail(status: number, code: string, message: string): WriteResult {
  return { status, body: { ok: false, code, error: message } };
}

/** The caller's current profile (or why there is no usable one). */
export async function resolveCallerProfile(sr: Db, user: Caller): Promise<{ profile: CallerProfile | null; problem: string | null }> {
  const rows: CallerProfile[] = await sr.entities.UserProfile.filter({ user_id: user.id }, '-created_date', 50);
  const mine = (rows || []).filter((p) => String(p.user_id || '') === String(user.id));
  const profile = selectCurrentProfile(mine);
  return { profile, problem: profileProblem(profile) };
}

type SubscriptionRow = { subscription_status?: string; license_tier?: string; trial_end_date?: string };

/** The school's newest SchoolSubscription row, or null. */
export async function readSubscription(sr: Db, schoolId: string): Promise<SubscriptionRow | null> {
  const subs: SubscriptionRow[] = await sr.entities.SchoolSubscription.filter({ school_id: schoolId }, '-created_date', 1);
  return (subs || [])[0] || null;
}

export async function licenseIsReadOnly(sr: Db, schoolId: string, now: Date): Promise<boolean> {
  return effectiveLicenseIsReadOnly(await readSubscription(sr, schoolId), now);
}

async function countActiveStudents(sr: Db, schoolId: string, upTo: number): Promise<number> {
  const rows: Array<{ school_id?: string; is_active?: boolean }> =
    await sr.entities.Student.filter({ school_id: schoolId, is_active: true }, '-created_date', upTo);
  return (rows || []).filter((s) => String(s.school_id || '') === schoolId && s.is_active === true).length;
}

/**
 * The plan's student cap, before the write (see studentHardLimit in
 * ./_policy.ts). Returns the refusal, or the hard limit to re-check after the
 * write (null = nothing to re-check).
 */
type QuotaCheck = { refusal: WriteResult | null; hardLimit: number | null; limit: number | null };

async function checkStudentQuota(sr: Db, schoolId: string): Promise<QuotaCheck> {
  const sub = await readSubscription(sr, schoolId);
  const limit = studentPlanLimit(sub);
  const hardLimit = studentHardLimit(sub);
  if (hardLimit == null) return { refusal: null, hardLimit: null, limit };
  const used = await countActiveStudents(sr, schoolId, hardLimit);
  if (used >= hardLimit) return { refusal: studentQuotaRefusal(limit, hardLimit, used), hardLimit, limit };
  return { refusal: null, hardLimit, limit };
}

// Returns the first client-supplied reference (see REFERENCE_ENTITIES) whose
// record is missing or lives in another school, or null if all check out.
export async function firstForeignReference(sr: Db, data: Record<string, unknown>, schoolId: string): Promise<string | null> {
  for (const [field, entityName, id] of referencesToCheck(data)) {
    const ref: { school_id?: string } | null = await sr.entities[entityName].get(id).catch(() => null);
    if (!ref || String(ref.school_id || '') !== schoolId) return field;
  }
  return null;
}

// Audit rows are written server-side (AuditLog create is service-role only).
// Best-effort: the write it describes already happened, and failing the
// request now would invite a duplicate retry.
export async function writeAudit(sr: Db, row: Record<string, unknown>, now = new Date()): Promise<void> {
  try {
    await sr.entities.AuditLog.create({ ...row, timestamp: now.toISOString() });
  } catch (e) {
    console.error('guardedEntityWrite audit write failed', (e as Error).message);
  }
}

/**
 * The classrooms `userId` is ACTIVELY assigned to in `schoolId` — what a
 * non-ADMIN's targets are held to (decideCreateTargets). Shared with entry.ts.
 */
export async function assignedClassroomIdsFor(sr: Db, schoolId: string, userId: string): Promise<string[]> {
  const rows: Array<{ school_id?: string; teacher_id?: string; classroom_id?: string; is_active?: boolean }> =
    await sr.entities.TeacherClassroom.filter({ school_id: schoolId, teacher_id: userId });
  return (rows || [])
    .filter((a) => String(a.school_id || '') === schoolId && String(a.teacher_id || '') === String(userId) && a.is_active !== false)
    .map((a) => String(a.classroom_id || ''))
    .filter(Boolean);
}

async function firstForeignUser(sr: Db, entity: string, data: Record<string, unknown>, schoolId: string): Promise<string | null> {
  for (const [field, roles, userId] of userReferencesToCheck(entity, data)) {
    const profiles: CallerProfile[] = await sr.entities.UserProfile.filter({ user_id: userId, school_id: schoolId });
    const ok = (profiles || []).some((p) =>
      String(p.user_id || '') === userId && String(p.school_id || '') === schoolId
      && p.status === 'ACTIVE' && roles.includes(String(p.app_role)));
    if (!ok) return field;
  }
  return null;
}

async function fanOutNoticeDeliveries(args: {
  sr: Db;
  user: Caller;
  profile: CallerProfile | null;
  isPlatformOwner: boolean;
  schoolId: string;
  input: Record<string, unknown>;
  now: Date;
}): Promise<WriteResult> {
  const { sr, user, profile, isPlatformOwner, schoolId, input, now } = args;
  const noticeId = typeof input.notice_id === 'string' ? input.notice_id : '';
  if (!noticeId) return fail(400, 'MISSING_FIELDS', 'notice_id is required');
  const notice: Record<string, unknown> | null = await sr.entities.Notice.get(noticeId).catch(() => null);
  if (!notice || String(notice.school_id || '') !== schoolId) {
    return fail(400, 'REFERENCE_NOT_IN_SCHOOL', 'notice_id does not belong to this school');
  }
  const isStaffAdmin = isPlatformOwner || profile?.app_role === 'ADMIN';
  // A teacher publishes their own notices only…
  if (!isStaffAdmin && String(notice.author_id || '') !== String(user.id)) {
    return fail(403, 'NOT_AUTHOR', 'Only the notice\'s author or a school ADMIN may publish it');
  }

  const scope = String(notice.scope || 'SCHOOL');
  let students: Array<Record<string, unknown>> = [];
  let studentClassroomId: string | null = null;
  if (scope === 'STUDENT') {
    const one = notice.student_id ? await sr.entities.Student.get(String(notice.student_id)).catch(() => null) : null;
    students = one ? [one] : [];
    studentClassroomId = one && String(one.school_id || '') === schoolId ? String(one.classroom_id || '') || null : null;
  }
  // …and only to the classrooms they teach TODAY. Checked here, at publish
  // time, against the stored notice — not trusted from the create-time check:
  // the notice may have been re-targeted since, or the assignment revoked.
  if (!isStaffAdmin) {
    const target = decideCreateTargets({
      entity: 'Notice',
      appRole: String(profile?.app_role || ''),
      data: notice,
      assignedClassroomIds: await assignedClassroomIdsFor(sr, schoolId, String(user.id)),
      studentClassroomId,
    });
    if (!target.ok) return fail(403, target.code, target.message);
  }
  if (scope === 'CLASSROOM') {
    students = notice.classroom_id
      ? await sr.entities.Student.filter({ school_id: schoolId, classroom_id: String(notice.classroom_id) }, '-created_date', 5000)
      : [];
  } else if (scope !== 'STUDENT') {
    students = await sr.entities.Student.filter({ school_id: schoolId }, '-created_date', 5000);
  }
  const links = await sr.entities.ParentStudent.filter({ school_id: schoolId, status: 'ACTIVE' }, '-created_date', 5000);
  // A parent who left the school (profile no longer ACTIVE) keeps no link that
  // matters, even if nobody revoked it.
  const parents: CallerProfile[] = await sr.entities.UserProfile.filter(
    { school_id: schoolId, app_role: 'PARENT', status: 'ACTIVE' }, '-created_date', 5000);
  const activeParentIds = (parents || [])
    .filter((p) => String(p.school_id || '') === schoolId && p.app_role === 'PARENT' && p.status === 'ACTIVE')
    .map((p) => String(p.user_id || ''))
    .filter(Boolean);
  const existing = await sr.entities.NoticeDelivery.filter({ notice_id: noticeId }, '-created_date', 5000);
  const rows = planNoticeDeliveries({
    notice, students: students || [], links: links || [], existing: existing || [], schoolId, now, activeParentIds,
  });
  if (rows.length > MAX_FANOUT) return fail(400, 'TOO_MANY_RECIPIENTS', 'Too many recipients for one notice');

  const handler = sr.entities.NoticeDelivery;
  for (let i = 0; i < rows.length; i += BULK_CHUNK) {
    const chunk = rows.slice(i, i + BULK_CHUNK);
    if (typeof handler.bulkCreate === 'function') await handler.bulkCreate(chunk);
    else for (const row of chunk) await handler.create(row);
  }
  await writeAudit(sr, {
    school_id: schoolId,
    user_id: user.id,
    user_email: user.email,
    action: 'RECORD_CREATED',
    target_type: 'NoticeDelivery',
    target_id: noticeId,
    details: { notice_id: noticeId, created: rows.length, scope },
  }, now);
  return { status: 200, body: { ok: true, created: rows.length } };
}

/**
 * One write of a SCHOOL_WRITES entity: `{ entity, operation, id?, data }`,
 * the same body the other guarded entities take.
 */
export async function runSchoolWrite(args: { sr: Db; user: Caller; body: Record<string, unknown>; now?: Date }): Promise<WriteResult> {
  const { sr, user } = args;
  const now = args.now || new Date();
  const body = args.body || {};
  const entity = String(body.entity || '');
  const operation = String(body.operation || '') as Op;
  const rule = schoolWriteRule(entity);
  if (!rule) return fail(400, 'UNKNOWN_ENTITY', 'Unsupported entity');
  if (!OPERATIONS.includes(operation) || !rule.roles[operation]) {
    return fail(400, 'BAD_OPERATION', `${operation} is not supported for ${entity}`);
  }
  const input: Record<string, unknown> = body.data && typeof body.data === 'object' && !Array.isArray(body.data)
    ? body.data as Record<string, unknown>
    : {};

  const isPlatformOwner = user.role === 'admin';
  const { profile, problem } = await resolveCallerProfile(sr, user);
  // A ticket is the one write that does not wait for the current consent
  // (consentExempt): every other check below still applies to it.
  const consentWaived = problem === 'CONSENT_REQUIRED' && consentExempt(entity, operation);
  if (!isPlatformOwner && problem && !consentWaived) return fail(403, problem, 'No active profile');
  const usableProfile = problem && !consentWaived ? null : profile;

  // WHERE — never from the body for a school user.
  let schoolId = '';
  let existing: Record<string, unknown> | null = null;
  if (operation === 'create') {
    const claimed = typeof input.school_id === 'string' ? input.school_id : '';
    schoolId = isPlatformOwner ? claimed || String(usableProfile?.school_id || '') : String(usableProfile?.school_id || '');
    if (!schoolId) return fail(400, 'MISSING_SCHOOL', 'No school to write into');
    if (claimed && claimed !== schoolId) return fail(403, 'SCHOOL_MISMATCH', 'school_id is not your school');
  } else {
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return fail(400, 'MISSING_ID', 'id is required');
    existing = await sr.entities[entity].get(id).catch(() => null);
    if (!existing) return fail(404, 'NOT_FOUND', 'Record not found');
    schoolId = String(existing.school_id || '');
    if (!schoolId) return fail(409, 'RECORD_WITHOUT_SCHOOL', 'Record has no school');
    if (!isPlatformOwner && String(usableProfile?.school_id || '') !== schoolId) {
      return fail(403, 'SCHOOL_MISMATCH', 'This record belongs to another school');
    }
  }

  // WHAT — role, license, record.
  const appRole = isPlatformOwner ? String(usableProfile?.app_role || 'ADMIN') : String(usableProfile?.app_role || '');
  let authorizedAs = 'platform_owner';
  if (!isPlatformOwner) {
    if (!(rule.roles[operation] || []).includes(appRole)) return fail(403, 'FORBIDDEN', 'Not permitted to write this resource');
    if (!licenseExempt(entity, operation) && !licenseExemptPatch(entity, operation, input)
      && await licenseIsReadOnly(sr, schoolId, now)) {
      return fail(403, 'WRITE_BLOCKED', 'This school\'s subscription is read-only');
    }
    if (existing) {
      const decision = decideSchoolRecord({ entity, operation, appRole, userId: String(user.id), existing });
      if (!decision.ok) return fail(403, decision.code, decision.message);
      authorizedAs = decision.reason;
    } else {
      authorizedAs = appRole === 'ADMIN' ? 'admin' : 'role';
    }
  }

  if (entity === 'NoticeDelivery' && operation === 'create') {
    return fanOutNoticeDeliveries({ sr, user, profile: usableProfile, isPlatformOwner, schoolId, input, now });
  }

  const auditBase = { school_id: schoolId, user_id: user.id, user_email: user.email, target_type: entity };

  if (operation === 'delete') {
    const recordId = String(existing!.id);
    await sr.entities[entity].delete(recordId);
    await writeAudit(sr, { ...auditBase, action: 'RECORD_DELETED', target_id: recordId, details: { authorized_as: authorizedAs } }, now);
    return { status: 200, body: { ok: true } };
  }

  const built = buildSchoolWrite(entity, operation, input, {
    userId: String(user.id),
    userName: callerDisplayName(user, appRole),
    userEmail: String(user.email || ''),
    profileId: String(usableProfile?.id || ''),
    role: appRole,
    schoolId,
    now,
    existing,
  });
  if (!built.ok) return fail(400, built.code, built.message);
  const data = built.data;

  // A discount of 150 %, -10 % or "valid until" before "valid from" used to
  // be saved as typed (loose-ends pass, 2026-09-30). Checked over the stored
  // record merged with the patch, but only when the patch touches the
  // discount's terms — so switching off an old, malformed discount still works.
  if (entity === 'Discount' && DISCOUNT_TERMS.some((field) => field in data)) {
    const check = validateDiscount(operation === 'update' && existing ? { ...existing, ...data } : data);
    if (!check.ok) return fail(400, check.code, `${check.field} is not valid`);
  }

  // Every id the record carries must be of this school.
  if (typeof data.student_id === 'string' && data.student_id) {
    const student: { school_id?: string } | null = await sr.entities.Student.get(data.student_id).catch(() => null);
    if (!student || String(student.school_id || '') !== schoolId) {
      return fail(400, 'STUDENT_NOT_IN_SCHOOL', 'student_id does not belong to this school');
    }
  }
  const badRef = await firstForeignReference(sr, data, schoolId);
  if (badRef) return fail(400, 'REFERENCE_NOT_IN_SCHOOL', `${badRef} does not belong to this school`);
  // On create the patch names the person; re-activating a grant re-checks the
  // stored one (teacher_id/parent_id cannot be changed by an update).
  const userData = operation === 'update' && existing && reactivatesGrant(entity, data) ? { ...existing, ...data } : data;
  const badUser = await firstForeignUser(sr, entity, userData, schoolId);
  if (badUser) return fail(400, 'USER_NOT_IN_SCHOOL', `${badUser} is not an active member of this school with that role`);
  if (entity === 'PendingChange') {
    // The rollback must name an override of this school, aimed at the same person.
    const payload = (data.payload || {}) as Record<string, unknown>;
    const override: Record<string, unknown> | null = typeof payload.override_id === 'string' && payload.override_id
      ? await sr.entities.PermissionOverride.get(payload.override_id).catch(() => null)
      : null;
    if (!override || String(override.school_id || '') !== schoolId || override.user_profile_id !== data.target_profile_id) {
      return fail(400, 'REFERENCE_NOT_IN_SCHOOL', 'payload.override_id is not an override of this school for that profile');
    }
    // The payload is what a second ADMIN will be asked to approve, so it is
    // rebuilt from the STORED override — never what the requester wrote
    // (governRoleChange, for one, reads payload.to_role).
    data.payload = {
      override_id: String(override.id),
      module: override.resource ?? null,
      action: override.action ?? null,
      effect: override.effect ?? null,
      risk_level: 'HIGH',
    };
  }

  // The plan's student cap (v1.9.0): only a write that ADDS an active student
  // is held to it, and only for a school user — the platform owner bypasses,
  // as in the client.
  const quotaCheck: QuotaCheck = entity === 'Student' && !isPlatformOwner && addsActiveStudent(operation, data, existing)
    ? await checkStudentQuota(sr, schoolId)
    : { refusal: null, hardLimit: null, limit: null };
  if (quotaCheck.refusal) return quotaCheck.refusal;
  // Two creates racing at the last free seat both pass the check above. After
  // the write, whoever sees the school OVER the cap undoes their own write and
  // is refused; at worst both undo and one retry succeeds. The count never
  // stays past the cap.
  const overCapAfterWrite = async (): Promise<boolean> => quotaCheck.hardLimit != null
    && await countActiveStudents(sr, schoolId, quotaCheck.hardLimit + 1) > quotaCheck.hardLimit;

  if (operation === 'create') {
    const record = await sr.entities[entity].create(data);
    if (record?.id && await overCapAfterWrite()) {
      await sr.entities[entity].delete(String(record.id));
      return studentQuotaRefusal(quotaCheck.limit, quotaCheck.hardLimit!, quotaCheck.hardLimit!);
    }
    await writeAudit(sr, {
      ...auditBase,
      action: 'RECORD_CREATED',
      target_id: String(record?.id || ''),
      details: { fields: Object.keys(data), authorized_as: authorizedAs },
    }, now);
    return { status: 200, body: { ok: true, record } };
  }

  const recordId = String(existing!.id);
  const record = await sr.entities[entity].update(recordId, data);
  if (await overCapAfterWrite()) {
    // Put back every field this patch touched, not only is_active: the
    // refusal says nothing was saved.
    const undo = Object.fromEntries(Object.keys(data).map((field) => [field, existing![field] ?? null]));
    undo.is_active = existing!.is_active === true;
    await sr.entities[entity].update(recordId, undo);
    return studentQuotaRefusal(quotaCheck.limit, quotaCheck.hardLimit!, quotaCheck.hardLimit!);
  }
  await writeAudit(sr, {
    ...auditBase,
    action: 'RECORD_UPDATED',
    target_id: recordId,
    details: { fields: Object.keys(data), authorized_as: authorizedAs },
  }, now);
  // The stored transition decides (existing → record), not the request.
  const event = statusEventFor(entity, operation, existing, { ...existing, ...(record || data) });
  if (event) {
    const notified = await notifyStatusChange({
      sr, templates: NOTIFICATION_TEMPLATES, event, schoolId, record: { ...existing, ...(record || data) }, actorId: String(user.id),
    });
    return { status: 200, body: { ok: true, record, notified } };
  }
  return { status: 200, body: { ok: true, record } };
}
