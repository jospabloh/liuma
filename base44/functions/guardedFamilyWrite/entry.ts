// guardedFamilyWrite — the only write path for the records a family writes
// about a child: EmergencyContact (who may pick them up), AbsenceNotification,
// EventResponse and UniformOrder.
//
// WHY THIS EXISTS (P7, 2026-09-29 — Base44 scan fingerprint 3e73cac8)
// Each of these entities' create RLS checked only "parent_id is you" (or
// "you created it") and never that the child was yours. Anyone signed in
// could add themselves to any child's emergency contacts with
// is_authorized_pickup:true, or file absences / event answers / uniform
// orders for children who aren't theirs. Their create/update RLS is now
// service-role only, and this function decides instead:
//
//   - the school comes from the STUDENT record, never from the request;
//   - the caller needs an ACTIVE UserProfile in that school, and either the
//     ADMIN role or an ACTIVE ParentStudent link to that student;
//   - parent_id / parent_name come from the authenticated user;
//   - status / review fields are fixed server-side, and only an ADMIN may
//     set EmergencyContact.is_authorized_pickup (a parent editing who an
//     authorized contact IS drops the authorization until the school
//     confirms it again);
//   - every write leaves a server-side AuditLog row.
//
// No billing read-only gate here, on purpose: an emergency contact is child
// safety information and must stay editable whatever the subscription says.
//
// An AbsenceNotification is for today or a later day, one live request per
// child per day (checkAbsenceRequest in ./_policy.ts).
//
// A new AbsenceNotification also emails the school's ADMINs and the child's
// teachers (./_statusNotify.ts), from here, after the write — never from a
// separate client call.
//
// The pure rules live in ./_policy.ts (tested by node --test).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';
import { FAMILY_OPERATIONS, absenceRaceLoser, profileConsentIsCurrent, callerDisplayName, buildFamilyPayload, decideFamilyAccess, isCalendarDate, mexicoToday } from './_policy.ts';
import { NOTIFICATION_TEMPLATES } from './_templates.ts';
import { notifyStatusChange, statusEventFor } from './_statusNotify.ts';

type Profile = { id: string; user_id?: string; school_id?: string; app_role?: string; status?: string; consent_notice_version?: string; consent_terms_version?: string };

function bad(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, code, error: message }, { status });
}

// deno-lint-ignore no-explicit-any
async function writeAudit(sr: any, row: Record<string, unknown>): Promise<void> {
  try {
    await sr.entities.AuditLog.create({ ...row, timestamp: new Date().toISOString() });
  } catch (e) {
    console.error('guardedFamilyWrite audit write failed', (e as Error).message);
  }
}

const AUDIT_ACTION: Record<string, string> = {
  create: 'RECORD_CREATED',
  update: 'RECORD_UPDATED',
  delete: 'RECORD_DELETED',
};

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
    // A deletion of this account started or finished (deleteMyAccount): no
    // access here, whatever consent stamp a race may have left behind.
    // auth.me() returns the User's custom fields, so this costs no read.
    if (accountDeletionBlocked(user)) return Response.json({ ok: false, code: 'ACCOUNT_DELETION_IN_PROGRESS', error: 'ACCOUNT_DELETION_IN_PROGRESS' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const entity = String(body?.entity || '');
    const operation = String(body?.operation || '');
    const input: Record<string, unknown> = body?.data && typeof body.data === 'object' ? body.data : {};
    if (!FAMILY_OPERATIONS[entity]) return bad(400, 'UNKNOWN_ENTITY', 'Unsupported entity');
    if (!FAMILY_OPERATIONS[entity].includes(operation)) return bad(400, 'BAD_OPERATION', 'Unsupported operation');

    const sr = base44.asServiceRole;

    // The student decides the school. On update/delete it comes from the
    // STORED record, so a client can't re-point an existing record.
    let existing: Record<string, unknown> | null = null;
    let studentId: string;
    if (operation === 'create') {
      studentId = String(input.student_id || '');
      if (!studentId) return bad(400, 'MISSING_STUDENT', 'data.student_id is required');
    } else {
      const id = String(body?.id || '');
      if (!id) return bad(400, 'MISSING_ID', 'id is required');
      existing = await sr.entities[entity].get(id).catch(() => null);
      if (!existing) return bad(404, 'NOT_FOUND', 'Record not found');
      studentId = String(existing.student_id || '');
    }

    const student: { id?: string; school_id?: string } | null = await sr.entities.Student.get(studentId).catch(() => null);
    if (!student) return bad(404, 'STUDENT_NOT_FOUND', 'Student not found');
    const schoolId = String(student.school_id || '');
    if (!schoolId) return bad(409, 'STUDENT_WITHOUT_SCHOOL', 'Student has no school');
    if (existing && String(existing.school_id || '') !== schoolId) {
      return bad(409, 'SCHOOL_MISMATCH', 'Record and student belong to different schools');
    }

    const isPlatformOwner = user.role === 'admin';
    let isAdmin = isPlatformOwner;
    let isLinkedParent = false;
    if (!isPlatformOwner) {
      const profiles: Profile[] = await sr.entities.UserProfile.filter({ user_id: user.id, school_id: schoolId });
      const profile = profiles.find((p) => p.status === 'ACTIVE') || null;
      if (!profile) return bad(403, 'NO_PROFILE', 'No active profile in this school');
      if (!profileConsentIsCurrent(profile)) return bad(403, 'CONSENT_REQUIRED', 'Accept the current privacy notice first');
      isAdmin = profile.app_role === 'ADMIN';
      if (!isAdmin) {
        const links: Array<{ school_id?: string }> = await sr.entities.ParentStudent.filter({
          parent_id: user.id,
          student_id: studentId,
          status: 'ACTIVE',
        });
        isLinkedParent = links.some((l) => !l.school_id || String(l.school_id) === schoolId);
      }
    }

    const access = decideFamilyAccess({ entity, operation, isAdmin, isLinkedParent, userId: String(user.id), existing });
    if (!access.ok) return bad(403, access.code, access.message);

    // Cross-record references, checked against the same school.
    let event: { school_id?: string; has_cost?: boolean } | null = null;
    if (entity === 'EventResponse' && operation === 'create') {
      event = await sr.entities.Event.get(String(input.event_id || '')).catch(() => null);
      if (!event || String(event.school_id || '') !== schoolId) {
        return bad(400, 'EVENT_NOT_IN_SCHOOL', 'event_id does not belong to this school');
      }
    }
    let chargeId: string | null = null;
    if (entity === 'EventResponse' && operation === 'update' && typeof input.charge_id === 'string' && input.charge_id) {
      const charge: Record<string, unknown> | null = await sr.entities.ChargeItem.get(input.charge_id).catch(() => null);
      const matches =
        charge &&
        String(charge.school_id || '') === schoolId &&
        String(charge.student_id || '') === studentId &&
        String(charge.event_id || '') === String(existing?.event_id || '');
      if (!matches) return bad(400, 'CHARGE_MISMATCH', 'charge_id is not this response\'s event charge');
      chargeId = String(input.charge_id);
    }

    const auditBase = {
      school_id: schoolId,
      user_id: user.id,
      user_email: user.email,
      action: AUDIT_ACTION[operation],
      target_type: entity,
    };

    if (operation === 'delete') {
      const recordId = String(existing!.id);
      await sr.entities[entity].delete(recordId);
      await writeAudit(sr, {
        ...auditBase,
        target_id: recordId,
        details: {
          student_id: studentId,
          as: isAdmin ? 'admin' : 'linked_parent',
          was_authorized_pickup: existing!.is_authorized_pickup === true,
        },
      });
      return Response.json({ ok: true });
    }

    // One live absence request per child per day (checkAbsenceRequest): read
    // what is already stored for that student and day. The read is not
    // atomic, so two requests in the same instant can both pass it; each one
    // re-checks after its create (absenceRaceLoser) and the loser removes
    // its own row.
    // Only for a day that can pass the date rules: a malformed or past day is
    // refused below without spending a read on it.
    const today = mexicoToday();
    let sameDayAbsences: Array<Record<string, unknown>> | null = null;
    if (entity === 'AbsenceNotification' && operation === 'create') {
      const day = typeof input.absence_date === 'string' ? input.absence_date.trim().slice(0, 10) : '';
      sameDayAbsences = isCalendarDate(day) && day >= today
        ? await sr.entities.AbsenceNotification.filter({ student_id: studentId, absence_date: day }, '-created_date', 20)
        : [];
    }

    const built = buildFamilyPayload(entity, operation, input, {
      isAdmin,
      userId: String(user.id),
      // Past the checks above a non-admin writes as the child's linked parent.
      userName: callerDisplayName(user, isAdmin ? 'ADMIN' : 'PARENT'),
      schoolId,
      studentId,
      existing,
      event,
      chargeId,
      today,
      sameDayAbsences,
    });
    if (!built.ok) return bad(built.code === 'ABSENCE_DUPLICATE' ? 409 : 400, built.code, built.message);

    const record = operation === 'create'
      ? await sr.entities[entity].create(built.data)
      : await sr.entities[entity].update(String(existing!.id), built.data);

    if (entity === 'AbsenceNotification' && operation === 'create' && record?.id) {
      const after = await sr.entities.AbsenceNotification.filter(
        { student_id: studentId, absence_date: String(record.absence_date || built.data.absence_date || '').slice(0, 10) },
        'created_date',
        20,
      );
      if (absenceRaceLoser(after, { ...built.data, ...record })) {
        // The undo is retried, and falls back to REJECTED — a rejected
        // request is not "live" (checkAbsenceRequest), so the day keeps one
        // live request even if the duplicate cannot be removed. Only if both
        // fail is the conflict reported as unresolved.
        const id = String(record.id);
        const tryTwice = async (fn: () => Promise<unknown>): Promise<boolean> => {
          for (let i = 0; i < 2; i += 1) {
            try { await fn(); return true; } catch (e) {
              console.error('guardedFamilyWrite: duplicate absence undo failed', id, (e as Error)?.message);
            }
          }
          return false;
        };
        const removed = await tryTwice(() => sr.entities.AbsenceNotification.delete(id));
        if (!removed && !await tryTwice(() => sr.entities.AbsenceNotification.update(id, { status: 'REJECTED', admin_notes: 'Duplicada: ya había una solicitud para ese día.' }))) {
          return bad(500, 'ABSENCE_CONFLICT_UNRESOLVED', `absence ${id} duplicates another request and could not be removed`);
        }
        return bad(409, 'ABSENCE_DUPLICATE', 'there is already a request for that day');
      }
    }

    await writeAudit(sr, {
      ...auditBase,
      target_id: String(record?.id || existing?.id || ''),
      details: {
        student_id: studentId,
        as: isAdmin ? 'admin' : 'linked_parent',
        fields: Object.keys(built.data),
        ...(entity === 'EmergencyContact'
          ? { is_authorized_pickup: built.data.is_authorized_pickup ?? existing?.is_authorized_pickup ?? false, pickup_revoked: built.pickupRevoked === true }
          : {}),
      },
    });
    // Best-effort and after the write: notifyStatusChange never throws. The
    // stored record decides (the payload the server built, then whatever the
    // SDK echoed back), never the request body.
    const stored = { ...built.data, ...(record || {}) };
    const statusEvent = statusEventFor(entity, operation, existing, stored);
    const notified = statusEvent
      ? await notifyStatusChange({ sr, templates: NOTIFICATION_TEMPLATES, event: statusEvent, schoolId, record: stored, actorId: String(user.id) })
      : undefined;
    return Response.json({ ok: true, record, pickupRevoked: built.pickupRevoked === true, ...(notified ? { notified } : {}) });
  } catch (e) {
    // Base44's rate limit is a 429, not a 500 (v1.8.3). A write is NOT
    // retried by the client: the person sees "Hay mucha actividad…" and
    // decides; a read is retried with backoff (src/lib/functionRetry.js).
    if (isRateLimitError(e)) {
      console.warn('guardedFamilyWrite rate limited');
      return Response.json(
        { ok: false, code: 'RATE_LIMITED', error: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': '3' } },
      );
    }
    return Response.json({ ok: false, code: 'INTERNAL', error: (e as Error).message }, { status: 500 });
  }
});

// MIRRORS myConsent/_consent.ts#accountDeletionStartedAt/accountDeletedAt.
// Identical in every consent-gated function; tests/unit/account-deletion.test.js
// checks the copies and where each one is called.
function accountDeletionBlocked(user: unknown): boolean {
  const u = (user ?? {}) as {
    account_deletion_started_at?: unknown;
    account_deleted_at?: unknown;
    data?: { account_deletion_started_at?: unknown; account_deleted_at?: unknown } | null;
  };
  const started = u.account_deletion_started_at ?? u.data?.account_deletion_started_at;
  const deleted = u.account_deleted_at ?? u.data?.account_deleted_at;
  return (typeof started === 'string' && started !== '') || (typeof deleted === 'string' && deleted !== '');
}
