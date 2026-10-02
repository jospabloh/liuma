// guardedEntityWrite — server-authoritative write gate for the 7 entities whose
// write access can be modified per-user via PermissionOverride
// (Notice, Attendance, Homework, DiaryEntry, ChargeItem, PaymentConcept,
// PaymentRecord — see src/lib/authorization/policy.js's POLICY and
// PermisosRoles.jsx's override form).
//
// WHY THIS EXISTS (module 3 of the portfolio standard — see CLAUDE.md)
// RLS on these 7 entities grants write access by ROLE only. PermissionOverride
// rows let an admin explicitly allow/deny write access for a *specific* user
// beyond their role default (e.g. deny Homework write for one TEACHER whose
// grading privileges were revoked) — but nothing server-side ever read a
// PermissionOverride before RLS let a write through: a user an admin
// explicitly denied could still call e.g. base44.entities.Homework.create()
// directly and RLS would allow it (TEACHER has role-level write access,
// with no concept of a per-user override). This function is now the
// sanctioned write path for these 7 entities: it re-derives the caller's role
// from their own school-scoped UserProfile (never from the request), re-checks
// the base role policy AND any matching PermissionOverride — mirroring
// src/lib/authorization/policy.js's getEffectivePolicyDecision(), scoped to
// action:'write' since that's the only override action PermisosRoles.jsx's
// form actually lets an admin set for these entities (POLICY_ACTIONS) — and
// also closes the SchoolSubscription.subscription_status gap: a school in
// view_only/suspended/inactive/canceled (the same statuses
// src/lib/license/licenseModel.js's isReadOnlyStatus already treats as
// read-only client-side) cannot write here either. Keep this file's POLICY_WRITE
// and READ_ONLY_STATUSES in sync with those two client copies by hand — Deno
// functions can't import across directories (same constraint documented on
// governRoleChange/entry.ts), so there's no shared module to import instead.
//
// P7 (2026-09-29): Notice/Homework/Attendance/DiaryEntry create/update are now
// service-role only in their entity RLS, so this function is the ONLY write
// path for them — its checks are no longer advisory. The pure rules
// (POLICY_WRITE, attribution, server-only fields, who may modify an existing
// record) live in ./_policy.ts so node --test can exercise them.
//
// P10b (2026-09-29): it is also the write path for every other school entity
// whose deployed RLS is platform-owner only (SCHOOL_WRITES in ./_policy.ts —
// Classroom, Student, TeacherClassroom, ParentStudent, Event, Discount,
// OfficialDocument, SchoolSetupGuide, PermissionOverride, PendingChange, the
// school's review of AbsenceNotification/UniformOrder, NoticeDelivery and
// SupportTicket). Those go to runSchoolWrite (./_schoolWrite.ts, tested
// against an in-memory database). For both paths the school and role come
// from the caller's CURRENT UserProfile (resolveCallerProfile, the same rule
// schoolRead uses) — never from the request body.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';
import {
  ATTRIBUTION_FIELDS,
  CLASSROOM_BOUND_ENTITIES,
  callerDisplayName,
  POLICY_WRITE,
  decideCreateTargets,
  decideModifyExisting,
  effectiveLicenseIsReadOnly,
  retargetsRecord,
  schoolWriteRule,
  stripServerOnlyFields,
} from './_policy.ts';
import {
  assignedClassroomIdsFor,
  firstForeignReference,
  resolveCallerProfile,
  runSchoolWrite,
  writeAudit,
} from './_schoolWrite.ts';
import {
  PAYMENT_ENTITIES,
  chargeDeleteProblem,
  prepareChargeCreate,
  prepareChargeUpdate,
  prepareConceptWrite,
  preparePaymentCreate,
  preparePaymentUpdate,
  resolvePaymentRace,
  settleCharge,
} from './_payments.ts';

const ENTITIES = Object.keys(POLICY_WRITE);
// effectiveLicenseIsReadOnly (fail closed: no row or an expired trial is
// read-only) lives in ./_policy.ts since P10b, shared with runSchoolWrite.
const OPERATIONS = ['create', 'update', 'delete'];
type Override = { user_profile_id?: string; resource?: string; action?: string; effect?: string };

// ChargeItem has one narrow carve-out beyond the table above, and it already
// lives in the DEPLOYED RLS (base44/entities/ChargeItem.jsonc's `create` rule)
// even though src/lib/authorization/policy.js's simplified POLICY table (and
// the mirror above) don't encode it: a PARENT may create a ChargeItem for
// their OWN linked student when accepting a paid event
// (EventosParaPadres.jsx), scoped to concept_type:'EVENTO'. RLS checks this
// via {{user.data.linked_student_ids}}, which — per
// src/lib/relations/getLinkedStudents.js's own comment — has no
// client-accessible source (base44.auth.me() never populates user.data on the
// client), so this function re-derives the same linkage the RLS token can't
// be read from, via the ParentStudent table directly (asServiceRole).
async function parentCanCreateEventCharge(
  // deno-lint-ignore no-explicit-any
  sr: any,
  userId: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  if (data?.concept_type !== 'EVENTO') return false;
  const studentId = String(data?.student_id || '');
  if (!studentId) return false;
  const links: Array<{ parent_id?: string; student_id?: string; status?: string }> = await sr.entities.ParentStudent.filter({
    parent_id: userId,
    student_id: studentId,
    status: 'ACTIVE',
  });
  return links.length > 0;
}

// The PARENT/EVENTO carve-out's financial fields (amount, status, ...) must
// never come from the client — see the module-level comment on
// parentCanCreateEventCharge. Re-derives them from the referenced Event
// record itself, the only server-side source of what the fee actually is.
// Returns null if the event doesn't check out (wrong school, no cost, or
// doesn't exist), which the caller treats as "carve-out does not apply."
async function buildEventChargeData(
  // deno-lint-ignore no-explicit-any
  sr: any,
  schoolId: string,
  studentId: string,
  eventId: string,
): Promise<Record<string, unknown> | null> {
  if (!eventId) return null;
  const event = await sr.entities.Event.get(eventId).catch(() => null);
  if (!event) return null;
  if (String(event.school_id || '') !== schoolId) return null;
  if (!event.has_cost) return null;
  return {
    school_id: schoolId,
    student_id: studentId,
    concept_type: 'EVENTO',
    concept_name: String(event.cost_concept || event.title || 'Evento'),
    original_amount: event.cost_amount,
    amount: event.cost_amount,
    discount_amount: 0,
    status: 'PENDING',
    due_date: event.confirmation_deadline || event.date,
    event_id: eventId,
  };
}

// firstForeignReference (every client-supplied reference must be a record of
// the same school) and writeAudit (server-side AuditLog rows, best-effort)
// live in ./_schoolWrite.ts, shared by both write paths.

// After a payment is recorded or deleted, its charge's amount_paid/status are
// re-derived (./_payments.ts). The payment itself is already written by then,
// so a failure here must NOT turn into an error the director retries — that
// would record the same money twice. The next payment, charge edit or the
// Pagos overdue refresh re-derives it again.
async function settleAfterPayment(
  // deno-lint-ignore no-explicit-any
  sr: any, chargeId: unknown, schoolId: string, now: Date, opts: { keptOnly?: boolean } = {},
): Promise<Record<string, unknown> | null> {
  try {
    return await settleCharge(sr, chargeId, schoolId, now, opts);
  } catch (e) {
    console.error('guardedEntityWrite settleCharge failed', (e as Error).message);
    return null;
  }
}

function bad(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, code, error: message }, { status });
}

// Same test as schoolRead/_answer.ts#isRateLimitError (functions cannot
// import across directories; tests/unit/rate-limit-resilience.test.js keeps
// the copies in step).
function isRateLimitError(e: unknown): boolean {
  const err = e as { status?: unknown; message?: unknown } | null;
  return err?.status === 429 || /rate limit/i.test(String(err?.message ?? ''));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return bad(401, 'UNAUTHENTICATED', 'Unauthorized');

    const body = await req.json().catch(() => ({}));
    const now = new Date();
    const entity = String(body?.entity || '');
    const operation = String(body?.operation || '');

    // P10b: the school entities whose RLS is platform-owner only.
    if (schoolWriteRule(entity)) {
      const result = await runSchoolWrite({ sr: base44.asServiceRole, user, body: body || {} });
      return Response.json(result.body, { status: result.status });
    }

    if (!ENTITIES.includes(entity)) return bad(400, 'UNKNOWN_ENTITY', 'Unsupported entity');
    if (!OPERATIONS.includes(operation)) return bad(400, 'BAD_OPERATION', 'operation must be create/update/delete');

    const sr = base44.asServiceRole;
    const isPlatformOwner = user.role === 'admin';

    // WHO: the caller's current profile (P10b — the rule schoolRead uses).
    // Before P10b create took the school from body.data and only checked the
    // caller had SOME active profile there; now the body can only confirm it.
    let profile: { id: string; user_id?: string; school_id?: string; app_role?: string; status?: string } | null = null;
    if (!isPlatformOwner) {
      const caller = await resolveCallerProfile(sr, user);
      if (caller.problem) return bad(403, caller.problem, 'No active profile');
      profile = { ...caller.profile, id: String(caller.profile?.id || '') };
    }

    // WHERE. For create, the caller's own school (a school_id in the body must
    // be that one). For update/delete, from the EXISTING record, never from
    // client input (a client could otherwise submit a foreign school_id to
    // sidestep its own school's block) — and it must be the caller's school.
    let schoolId: string;
    let existing: Record<string, unknown> | null = null;
    if (operation === 'create') {
      const claimed = String(body?.data?.school_id || '');
      schoolId = profile ? String(profile.school_id || '') : claimed;
      if (!schoolId) return bad(400, 'MISSING_SCHOOL', 'data.school_id is required');
      if (claimed && claimed !== schoolId) return bad(403, 'SCHOOL_MISMATCH', 'school_id is not your school');
    } else {
      const id = String(body?.id || '');
      if (!id) return bad(400, 'MISSING_ID', 'id is required');
      existing = await sr.entities[entity].get(id).catch(() => null);
      if (!existing) return bad(404, 'NOT_FOUND', 'Record not found');
      schoolId = String((existing as { school_id?: string }).school_id || '');
      if (profile && String(profile.school_id || '') !== schoolId) {
        return bad(403, 'SCHOOL_MISMATCH', 'This record belongs to another school');
      }
    }

    // Populated only when the ChargeItem/PARENT/EVENTO carve-out grants
    // access below — the create handler uses this, server-derived, instead
    // of body.data, so a parent can't submit their own amount/status.
    let eventChargeData: Record<string, unknown> | null = null;
    // How an update/delete was authorized — recorded in the audit row.
    let modifyReason = 'platform_owner';
    if (profile) {
      // Base role policy + PermissionOverride, mirroring getEffectivePolicyDecision:
      // an explicit deny override wins outright; an allow override grants access
      // even if the role default doesn't; otherwise fall back to the role default.
      const roleAllowed = (POLICY_WRITE[entity] || []).includes(String(profile.app_role));
      const overrides: Override[] = await sr.entities.PermissionOverride.filter({
        school_id: schoolId,
        user_profile_id: profile.id,
        resource: entity,
        action: 'write',
      });
      const hasDeny = overrides.some((o) => o.effect === 'deny');
      const hasAllow = overrides.some((o) => o.effect === 'allow');
      let allowed = hasDeny ? false : hasAllow ? true : roleAllowed;

      // The ChargeItem/PARENT/EVENTO carve-out (see parentCanCreateEventCharge's
      // own comment) is independent of PermissionOverride — it's a narrow RLS
      // grant already live in production, not a role default an admin can
      // override — so it applies even when the base policy/override check above
      // denied. A deny override still wins over it, same precedence as above.
      if (!hasDeny && !allowed && entity === 'ChargeItem' && operation === 'create' && profile.app_role === 'PARENT') {
        const canCreate = await parentCanCreateEventCharge(sr, user.id, body.data || {});
        if (canCreate) {
          eventChargeData = await buildEventChargeData(
            sr,
            schoolId,
            String(body?.data?.student_id || ''),
            String(body?.data?.event_id || ''),
          );
          allowed = eventChargeData !== null;
        }
      }
      if (!allowed) return bad(403, 'FORBIDDEN', 'Not permitted to write this resource');

      // Billing write-gate — same statuses the client already treats as read-only.
      // One exception: an ADMIN's emergency alert (AlertaEmergencia →
      // notificationService.sendHighPriorityAlert). Before P7 that Notice was a
      // direct create the billing gate never saw, and the alert aborts before
      // any email goes out if this write fails — child safety is not gated on
      // the subscription (same reasoning as guardedFamilyWrite).
      // Everything else fails closed (P6): no row or an expired trial is
      // read-only — see effectiveLicenseIsReadOnly above.
      const isEmergencyAlert = entity === 'Notice' && operation === 'create'
        && profile.app_role === 'ADMIN' && body?.data?.is_emergency === true;
      const subs: Array<{ subscription_status?: string; license_tier?: string; trial_end_date?: string }> =
        await sr.entities.SchoolSubscription.filter({ school_id: schoolId }, '-created_date', 1);
      const sub = subs[0] || null;
      if (!isEmergencyAlert && effectiveLicenseIsReadOnly(sub, new Date())) {
        return bad(403, 'WRITE_BLOCKED', 'This school\'s subscription is read-only');
      }

      // Record-level rule for update/delete (P7, 2026-09-29): the role policy
      // above only says "a TEACHER may write Notices", not "this teacher may
      // rewrite THAT teacher's diary entry". See decideModifyExisting.
      if (operation !== 'create') {
        let assignedClassroomIds: string[] = [];
        const existingClassroom = String((existing as { classroom_id?: string }).classroom_id || '');
        if (entity === 'Attendance' && operation === 'update' && profile.app_role !== 'ADMIN' && existingClassroom) {
          const assignments: Array<{ classroom_id?: string; is_active?: boolean }> = await sr.entities.TeacherClassroom.filter({
            school_id: schoolId,
            teacher_id: user.id,
            classroom_id: existingClassroom,
          });
          assignedClassroomIds = assignments.filter((a) => a.is_active !== false).map((a) => String(a.classroom_id || ''));
        }
        const decision = decideModifyExisting({
          entity,
          operation,
          appRole: String(profile.app_role || ''),
          userId: String(user.id),
          existing: existing as Record<string, unknown>,
          assignedClassroomIds,
        });
        if (!decision.ok) return bad(403, decision.code, decision.message);
        modifyReason = decision.reason;
      }
    }

    if (operation === 'create') {
      // eventChargeData, when set, is entirely server-derived (see
      // buildEventChargeData) and replaces body.data outright — the parent's
      // submitted amount/status/etc. never reach the write. Server-only
      // notification fields are stripped on create too, not just on update.
      const data: Record<string, unknown> = eventChargeData ?? stripServerOnlyFields(entity, body.data || {});
      // Money (loose-ends pass, 2026-09-30): a charge's price and status, a
      // payment's amount and student, a concept's price are rebuilt by the
      // server from stored records — see ./_payments.ts. What comes back
      // REPLACES the client's data.
      if (PAYMENT_ENTITIES.includes(entity)) {
        const prepared = entity === 'ChargeItem'
          ? await prepareChargeCreate(sr, data, schoolId, now)
          : entity === 'PaymentRecord'
            ? await preparePaymentCreate(sr, data, schoolId, now)
            : prepareConceptWrite('create', data);
        if (!prepared.ok) return bad(prepared.status, prepared.code, prepared.message);
        for (const key of Object.keys(data)) delete data[key];
        Object.assign(data, prepared.data);
      }
      data.school_id = schoolId;

      const attribution = ATTRIBUTION_FIELDS[entity];
      if (attribution) {
        data[attribution.id] = user.id;
        if (attribution.name) data[attribution.name] = callerDisplayName(user);
      }

      // Base44 security scan, 2026-09-28 (confirmed, found via notifyParents
      // but rooted here): school_id is tied to the caller's own profile
      // above, but student_id was taken from the client as-is — a caller
      // could create a record (Attendance, DiaryEntry, ...) in their OWN
      // school that points at a student who belongs to a DIFFERENT school,
      // and anything downstream that trusts "record.school_id says who can
      // see this" (e.g. notifyParents) would act on it. Fail closed if the
      // two disagree.
      const studentId = data.student_id;
      let studentClassroomId: string | null = null;
      if (typeof studentId === 'string' && studentId) {
        const student: { school_id?: string; classroom_id?: string } | null = await sr.entities.Student.get(studentId).catch(() => null);
        if (!student || String(student.school_id || '') !== schoolId) {
          return bad(400, 'STUDENT_NOT_IN_SCHOOL', 'student_id does not belong to this school');
        }
        studentClassroomId = String(student.classroom_id || '') || null;
      }
      const foreignRef = await firstForeignReference(sr, data, schoolId);
      if (foreignRef) return bad(400, 'REFERENCE_NOT_IN_SCHOOL', `${foreignRef} does not belong to this school`);

      // P10 review (2026-09-29): schoolRead shows a classroom's records to its
      // teachers and a child's to their parents, so a non-ADMIN may only file
      // them against their OWN classrooms and the children actually in them.
      if (profile && profile.app_role !== 'ADMIN' && (CLASSROOM_BOUND_ENTITIES.includes(entity) || entity === 'Notice')) {
        const target = decideCreateTargets({
          entity,
          appRole: String(profile.app_role || ''),
          data,
          assignedClassroomIds: await assignedClassroomIdsFor(sr, schoolId, String(user.id)),
          studentClassroomId,
        });
        if (!target.ok) return bad(403, target.code, target.message);
      }

      const created = await sr.entities[entity].create(data);
      if (entity === 'PaymentRecord') {
        // Two payments at once can both pass the balance check above (no
        // transactions in Base44): re-read, keep the earlier, delete ours if
        // it overflows — and only then settle, from the kept ones. See
        // resolvePaymentRace in ./_payments.ts.
        const race = await resolvePaymentRace(sr, created, schoolId);
        if (!race.ok) return bad(race.status, race.code, race.message);
        const charge = await settleAfterPayment(sr, data.charge_id, schoolId, now, { keptOnly: true });
        return Response.json({ ok: true, record: created, charge });
      }
      return Response.json({ ok: true, record: created });
    }

    const recordId = String((existing as { id: string }).id);

    if (operation === 'update') {
      // A client-submitted school_id on update could otherwise reassign the
      // record to a different tenant — always drop it, the record keeps its
      // existing school_id. Same for student_id (2026-09-28 scan finding,
      // same reasoning as the create-side check above — reassigning an
      // existing record to a different student is never a legitimate edit,
      // and no real call site ever sends one) and the entity's attribution
      // field(s): who authored a record doesn't change on edit, and no real
      // call site ever sends one on update (only on create).
      const patch = stripServerOnlyFields(entity, body.data || {});
      delete (patch as { school_id?: unknown }).school_id;
      delete (patch as { student_id?: unknown }).student_id;
      const attribution = ATTRIBUTION_FIELDS[entity];
      if (attribution) {
        delete (patch as Record<string, unknown>)[attribution.id];
        if (attribution.name) delete (patch as Record<string, unknown>)[attribution.name];
      }
      if (PAYMENT_ENTITIES.includes(entity)) {
        const prepared = entity === 'ChargeItem'
          ? await prepareChargeUpdate(sr, existing as Record<string, unknown>, patch, schoolId, now)
          : entity === 'PaymentRecord'
            ? preparePaymentUpdate(existing as Record<string, unknown>, patch)
            : prepareConceptWrite('update', patch);
        if (!prepared.ok) return bad(prepared.status, prepared.code, prepared.message);
        for (const key of Object.keys(patch)) delete (patch as Record<string, unknown>)[key];
        Object.assign(patch, prepared.data);
      }
      const foreignRef = await firstForeignReference(sr, patch, schoolId);
      if (foreignRef) return bad(400, 'REFERENCE_NOT_IN_SCHOOL', `${foreignRef} does not belong to this school`);

      // P10b review: the create-time target rule held on update too. Without
      // it an author could move a diary entry or homework to a classroom they
      // don't teach (schoolRead then shows it to that classroom's teachers),
      // or a CLASSROOM notice to another classroom / the whole school and
      // then publish it. Only an update that CHANGES the target is checked,
      // over the stored record merged with the patch, so an ordinary edit of
      // an old record keeps working.
      if (profile && profile.app_role !== 'ADMIN' && (CLASSROOM_BOUND_ENTITIES.includes(entity) || entity === 'Notice')
        && retargetsRecord(existing as Record<string, unknown>, patch)) {
        const merged = { ...(existing as Record<string, unknown>), ...patch };
        const storedStudentId = String((existing as { student_id?: string }).student_id || '');
        let studentClassroomId: string | null = null;
        if (storedStudentId) {
          const student: { school_id?: string; classroom_id?: string } | null =
            await sr.entities.Student.get(storedStudentId).catch(() => null);
          studentClassroomId = student && String(student.school_id || '') === schoolId ? String(student.classroom_id || '') || null : null;
        }
        const target = decideCreateTargets({
          entity,
          appRole: String(profile.app_role || ''),
          data: merged,
          assignedClassroomIds: await assignedClassroomIdsFor(sr, schoolId, String(user.id)),
          studentClassroomId,
        });
        if (!target.ok) return bad(403, target.code, target.message);
      }

      const updated = await sr.entities[entity].update(recordId, patch);
      await writeAudit(sr, {
        school_id: schoolId,
        user_id: user.id,
        user_email: user.email,
        action: 'RECORD_UPDATED',
        target_type: entity,
        target_id: recordId,
        details: { fields: Object.keys(patch), authorized_as: modifyReason },
      });
      return Response.json({ ok: true, record: updated });
    }

    // operation === 'delete'
    if (entity === 'ChargeItem') {
      const problem = await chargeDeleteProblem(sr, existing as Record<string, unknown>, schoolId);
      if (problem && !problem.ok) return bad(problem.status, problem.code, problem.message);
    }
    await sr.entities[entity].delete(recordId);
    if (entity === 'PaymentRecord') {
      await settleAfterPayment(sr, (existing as { charge_id?: string }).charge_id, schoolId, now);
    }
    const attribution = ATTRIBUTION_FIELDS[entity];
    await writeAudit(sr, {
      school_id: schoolId,
      user_id: user.id,
      user_email: user.email,
      action: 'RECORD_DELETED',
      target_type: entity,
      target_id: recordId,
      details: {
        authorized_as: modifyReason,
        original_author: attribution ? String((existing as Record<string, unknown>)[attribution.id] || '') : null,
        student_id: String((existing as { student_id?: string }).student_id || '') || null,
      },
    });
    return Response.json({ ok: true });
  } catch (e) {
    // Base44's rate limit is a 429, not a 500 (v1.8.3). A write is NOT
    // retried by the client: the person sees "Hay mucha actividad…" and
    // decides; a read is retried with backoff (src/lib/functionRetry.js).
    if (isRateLimitError(e)) {
      console.warn('guardedEntityWrite rate limited');
      return Response.json(
        { ok: false, code: 'RATE_LIMITED', error: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': '3' } },
      );
    }
    return Response.json({ ok: false, code: 'INTERNAL', error: (e as Error).message }, { status: 500 });
  }
});
