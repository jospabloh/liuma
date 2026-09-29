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
// Import-free apart from the sibling ./_policy.ts and duck-typed on
// `sr.entities[Name]`, so tests/unit/write-path-p10b.test.js runs the real
// thing against an in-memory database with two schools.
import {
  buildSchoolWrite,
  decideSchoolRecord,
  effectiveLicenseIsReadOnly,
  licenseExempt,
  planNoticeDeliveries,
  profileProblem,
  referencesToCheck,
  schoolWriteRule,
  selectCurrentProfile,
  userReferencesToCheck,
} from './_policy.ts';
import type { CallerProfile, Op } from './_policy.ts';

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

export async function licenseIsReadOnly(sr: Db, schoolId: string, now: Date): Promise<boolean> {
  const subs: Array<{ subscription_status?: string; license_tier?: string; trial_end_date?: string }> =
    await sr.entities.SchoolSubscription.filter({ school_id: schoolId }, '-created_date', 1);
  return effectiveLicenseIsReadOnly((subs || [])[0] || null, now);
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
  // A teacher publishes their own notices only (guardedEntityWrite already
  // held that notice to their classrooms when it was created).
  if (!isPlatformOwner && profile?.app_role !== 'ADMIN' && String(notice.author_id || '') !== String(user.id)) {
    return fail(403, 'NOT_AUTHOR', 'Only the notice\'s author or a school ADMIN may publish it');
  }

  const scope = String(notice.scope || 'SCHOOL');
  let students: Array<Record<string, unknown>> = [];
  if (scope === 'STUDENT') {
    const one = notice.student_id ? await sr.entities.Student.get(String(notice.student_id)).catch(() => null) : null;
    students = one ? [one] : [];
  } else if (scope === 'CLASSROOM') {
    students = notice.classroom_id
      ? await sr.entities.Student.filter({ school_id: schoolId, classroom_id: String(notice.classroom_id) }, '-created_date', 5000)
      : [];
  } else {
    students = await sr.entities.Student.filter({ school_id: schoolId }, '-created_date', 5000);
  }
  const links = await sr.entities.ParentStudent.filter({ school_id: schoolId, status: 'ACTIVE' }, '-created_date', 5000);
  const existing = await sr.entities.NoticeDelivery.filter({ notice_id: noticeId }, '-created_date', 5000);
  const rows = planNoticeDeliveries({ notice, students: students || [], links: links || [], existing: existing || [], schoolId, now });
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
  if (!isPlatformOwner && problem) return fail(403, problem, 'No active profile');
  const usableProfile = problem ? null : profile;

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
    if (!licenseExempt(entity, operation) && await licenseIsReadOnly(sr, schoolId, now)) {
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
    userName: String(user.full_name || ''),
    userEmail: String(user.email || ''),
    profileId: String(usableProfile?.id || ''),
    role: appRole,
    schoolId,
    now,
    existing,
  });
  if (!built.ok) return fail(400, built.code, built.message);
  const data = built.data;

  // Every id the record carries must be of this school.
  if (typeof data.student_id === 'string' && data.student_id) {
    const student: { school_id?: string } | null = await sr.entities.Student.get(data.student_id).catch(() => null);
    if (!student || String(student.school_id || '') !== schoolId) {
      return fail(400, 'STUDENT_NOT_IN_SCHOOL', 'student_id does not belong to this school');
    }
  }
  const badRef = await firstForeignReference(sr, data, schoolId);
  if (badRef) return fail(400, 'REFERENCE_NOT_IN_SCHOOL', `${badRef} does not belong to this school`);
  const badUser = await firstForeignUser(sr, entity, data, schoolId);
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
  }

  if (operation === 'create') {
    const record = await sr.entities[entity].create(data);
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
  await writeAudit(sr, {
    ...auditBase,
    action: 'RECORD_UPDATED',
    target_id: recordId,
    details: { fields: Object.keys(data), authorized_as: authorizedAs },
  }, now);
  return { status: 200, body: { ok: true, record } };
}
