// _statusNotify.ts — the emails that tell the other side of a family request
// that something happened to it:
//
//   absence_request_submitted  a parent filed an absence → the school's
//                              ACTIVE ADMINs (who review it) and the ACTIVE
//                              teachers of the child's classroom;
//   absence_request_reviewed   the school approved/rejected it → the parent
//                              who filed it;
//   uniform_order_status       the school moved a uniform order to
//                              PROCESSING / READY / DELIVERED / CANCELLED →
//                              the parent who ordered it.
//
// WHY (loose-ends audit, 2026-09-30). None of these told anyone: a director
// only learned of an absence by opening "Ausencias", and a parent only saw a
// review or a "listo para recoger" by reopening the page.
//
// WHY FROM THE WRITE, not from a client call. The email goes out from the
// function that performs the write (guardedFamilyWrite for the request,
// guardedEntityWrite's runSchoolWrite for the review), after the write
// succeeded, so:
//   - the only way to trigger one is to really file or review the record — a
//     browser can't replay it at will (no endpoint takes an "email this"
//     request), and a cached old client can't skip it;
//   - the event is the stored transition (existing.status → new status), so
//     re-saving without a change sends nothing; no idempotency flag needed;
//   - recipients come from stored rows only (the record's own parent_id, the
//     school's profiles, TeacherClassroom), filtered to the record's school.
//
// In-app: email only, deliberately. The one in-app model is Notice (+
// NoticeDelivery), a broadcast with a school/classroom/student audience — a
// status notice about one family's request would show up in the director's
// Avisos list and in the "avisos enviados" KPI of Reportes as if the school
// had sent a communiqué. The parent already sees the new status on
// "Solicitar ausencia" / "Uniformes"; the email is what was missing.
//
// Best-effort: the write already happened, so nothing here throws; a failed
// send leaves one NOTIFICATION_DELIVERY_FAILED audit row.
//
// Import-free and duck-typed on `sr` so `node --test` runs the real code
// (tests/unit/request-status-notify.test.js). Byte-identical copies in
// guardedFamilyWrite/ and guardedEntityWrite/ (Deno functions can't import
// across directories); the test fails if they differ. The templates live in
// the shared _templates.ts and are passed in.

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type Ctx = Record<string, string>;
type Template = { subject: (ctx: Ctx) => string; emailBody: (ctx: Ctx) => string };

export type StatusEvent = 'absence_request_submitted' | 'absence_request_reviewed' | 'uniform_order_status';
export type Recipient = { userId: string; role: string; prefs?: Row };
export type NotifySummary = { event: string; total: number; emailed: number; failed: number; skipped: number; error?: string };

const MAX_RECIPIENTS = 50;
const SEND_ATTEMPTS = 2;
const MAX_TEXT = 2000;

export const ABSENCE_REVIEW_LABELS_ES: Record<string, string> = {
  APPROVED: 'aprobada',
  REJECTED: 'rechazada',
};

export const UNIFORM_STATUS_ES: Record<string, { label: string; detail: string }> = {
  PROCESSING: { label: 'En proceso', detail: 'La escuela ya está preparando tu pedido.' },
  READY: { label: 'Listo para recoger', detail: 'Tu pedido está listo. Puedes pasar a recogerlo a la escuela.' },
  DELIVERED: { label: 'Entregado', detail: 'La escuela registró tu pedido como entregado.' },
  CANCELLED: { label: 'Cancelado', detail: 'La escuela canceló tu pedido. Si tienes dudas, comunícate con la dirección.' },
};

const STAFF_HINTS: Record<string, string> = {
  ADMIN: 'Ingresa a LIUMA > Día a día > Ausencias para aprobarla o rechazarla.',
  TEACHER: 'Te avisamos porque es alumno(a) de tu grupo. La dirección revisará la solicitud.',
};

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** 'YYYY-MM-DD' → "5 de marzo, 2027" with string ops only (no UTC shift). */
export function spanishDateLabel(value: unknown): string {
  const [y, m, d] = String(value || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return '';
  return `${d} de ${MONTHS_ES[m - 1]}, ${y}`;
}

/**
 * Which email, if any, a stored write calls for. Only real transitions count:
 * an update that leaves `status` where it was (a note edited, a re-save) or
 * moves it back to PENDING sends nothing.
 */
export function statusEventFor(entity: string, operation: string, existing: Row | null, record: Row | null): StatusEvent | null {
  if (!record) return null;
  if (entity === 'AbsenceNotification' && operation === 'create') return 'absence_request_submitted';
  if (operation !== 'update' || !existing) return null;
  const before = String(existing.status || '');
  const after = String(record.status || '');
  if (!after || after === before) return null;
  if (entity === 'AbsenceNotification' && ABSENCE_REVIEW_LABELS_ES[after]) return 'absence_request_reviewed';
  if (entity === 'UniformOrder' && UNIFORM_STATUS_ES[after]) return 'uniform_order_status';
  return null;
}

/**
 * Who gets it, from stored rows only, all of `schoolId`:
 *  - submitted → ACTIVE ADMINs, plus ACTIVE TEACHERs with an active
 *    assignment to the child's classroom;
 *  - reviewed / uniform → the record's own parent_id, if they still have an
 *    ACTIVE profile in the school and — as a PARENT — still an ACTIVE link to
 *    the child (a parent whose link was revoked since is not told about the
 *    child any more).
 * Never the person who made the write (a director filing an absence for a
 * family is not told about it), never twice.
 */
export function selectRecipients(input: {
  event: StatusEvent;
  schoolId: string;
  record: Row;
  profiles: Row[];
  teacherLinks?: Row[];
  classroomId?: string | null;
  parentLinks?: Row[];
  actorId: string;
}): Recipient[] {
  const { event, schoolId, record, actorId } = input;
  if (!schoolId || String(record?.school_id || '') !== schoolId) return [];
  const active = (input.profiles || []).filter((p) =>
    p && String(p.school_id || '') === schoolId && p.status === 'ACTIVE' && p.user_id);
  const out: Recipient[] = [];
  const seen = new Set<string>([String(actorId || '')]);
  const add = (p: Row) => {
    const id = String(p.user_id);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ userId: id, role: String(p.app_role || ''), prefs: p.notification_preferences });
  };
  if (event === 'absence_request_submitted') {
    for (const p of active) if (p.app_role === 'ADMIN') add(p);
    const classroomId = String(input.classroomId || '');
    const teachers = new Set(
      classroomId
        ? (input.teacherLinks || [])
          .filter((l) => l && String(l.school_id || '') === schoolId && String(l.classroom_id || '') === classroomId && l.is_active !== false)
          .map((l) => String(l.teacher_id || ''))
        : [],
    );
    for (const p of active) if (p.app_role === 'TEACHER' && teachers.has(String(p.user_id))) add(p);
  } else {
    const parentId = String(record.parent_id || '');
    const own = active.find((p) => String(p.user_id) === parentId);
    const linked = (input.parentLinks || []).some((l) =>
      l && String(l.parent_id || '') === parentId && String(l.student_id || '') === String(record.student_id || '')
      && l.status === 'ACTIVE' && (!l.school_id || String(l.school_id) === schoolId));
    if (own && (own.app_role !== 'PARENT' || linked)) add(own);
  }
  return out.slice(0, MAX_RECIPIENTS);
}

/** The template context — every value from the stored record and student. */
export function buildContext(event: StatusEvent, record: Row, student: Row | null, role: string): Ctx {
  const studentName = student ? `${student.first_name || ''} ${student.last_name || ''}`.trim() : '';
  const base: Ctx = { studentName: studentName || 'su hijo(a)' };
  const notes = String(record.admin_notes || '').slice(0, MAX_TEXT);
  if (event === 'absence_request_submitted') {
    return {
      ...base,
      parentName: String(record.parent_name || '').slice(0, 200) || 'Un padre de familia',
      absenceDateLabel: spanishDateLabel(record.absence_date),
      reason: String(record.reason || '').slice(0, MAX_TEXT),
      actionHint: STAFF_HINTS[role] || STAFF_HINTS.TEACHER,
    };
  }
  if (event === 'absence_request_reviewed') {
    return {
      ...base,
      absenceDateLabel: spanishDateLabel(record.absence_date),
      statusLabel: ABSENCE_REVIEW_LABELS_ES[String(record.status)] || '',
      adminNotes: notes,
    };
  }
  const status = UNIFORM_STATUS_ES[String(record.status)] || { label: '', detail: '' };
  return {
    ...base,
    statusLabel: status.label,
    statusDetail: status.detail,
    estimatedDeliveryLabel: String(record.status) === 'CANCELLED' ? '' : spanishDateLabel(record.estimated_delivery),
    adminNotes: notes,
  };
}

/** Same rule as sendBulkNotification/_fanout.ts#isChannelEnabled (tested equal). */
export function emailEnabled(schoolPrefs: Row | null | undefined, userPrefs: Row | null | undefined, role: string): boolean {
  const roleKey = role ? `role_${String(role).toLowerCase()}` : null;
  const on = (prefs: Row) => prefs.email !== false && (roleKey ? prefs[roleKey] !== false : true);
  return on(schoolPrefs || {}) && on(userPrefs || {});
}

async function rows(handler: Db, query: Row, limit = 500): Promise<Row[]> {
  if (!handler || typeof handler.filter !== 'function') return [];
  const out = await handler.filter(query, '-created_date', limit).catch(() => []);
  return Array.isArray(out) ? out : [];
}

async function one(handler: Db, id: string): Promise<Row | null> {
  if (!id || !handler || typeof handler.get !== 'function') return null;
  return await handler.get(id).catch(() => null);
}

/**
 * Sends the email for one stored transition. `record` is the record as
 * stored after the write; `schoolId` is the school the write path already
 * derived and authorized (never the request's). Never throws.
 */
export async function notifyStatusChange(args: {
  sr: Db;
  templates: Record<string, Template>;
  event: StatusEvent;
  schoolId: string;
  record: Row;
  actorId: string;
}): Promise<NotifySummary> {
  const { sr, templates, event, schoolId, record, actorId } = args;
  const summary: NotifySummary = { event, total: 0, emailed: 0, failed: 0, skipped: 0 };
  try {
    const template = templates?.[event];
    if (!template) return { ...summary, error: 'no_template' };
    const fetched = await one(sr.entities.Student, String(record.student_id || ''));
    const student = fetched && String(fetched.school_id || '') === schoolId ? fetched : null;
    const submitted = event === 'absence_request_submitted';
    const profiles = submitted
      ? await rows(sr.entities.UserProfile, { school_id: schoolId, status: 'ACTIVE', app_role: { $in: ['ADMIN', 'TEACHER'] } })
      : await rows(sr.entities.UserProfile, { school_id: schoolId, user_id: String(record.parent_id || '') });
    const classroomId = student ? String(student.classroom_id || '') : '';
    const teacherLinks = submitted && classroomId
      ? await rows(sr.entities.TeacherClassroom, { school_id: schoolId, classroom_id: classroomId, is_active: true })
      : [];
    const parentLinks = submitted
      ? []
      : await rows(sr.entities.ParentStudent, {
        parent_id: String(record.parent_id || ''), student_id: String(record.student_id || ''), status: 'ACTIVE',
      });
    const recipients = selectRecipients({ event, schoolId, record, profiles, teacherLinks, classroomId, parentLinks, actorId });
    summary.total = recipients.length;
    if (recipients.length === 0) return summary;

    const send = sr.integrations?.Core?.SendEmail;
    if (typeof send !== 'function') return { ...summary, skipped: recipients.length };
    const school = await one(sr.entities.School, schoolId);
    const users = await rows(sr.entities.User, { id: { $in: recipients.map((r) => r.userId) } }, MAX_RECIPIENTS);
    const emailOf = new Map(users.map((u) => [String(u.id), String(u.email || '')]));

    const failures: Array<{ user_id: string; error: string }> = [];
    await Promise.all(recipients.map(async (r) => {
      const to = emailOf.get(r.userId) || '';
      if (!to || !emailEnabled(school?.notification_preferences, r.prefs, r.role)) {
        summary.skipped += 1;
        return;
      }
      const ctx = buildContext(event, record, student, r.role);
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt += 1) {
        try {
          await send({ to, subject: template.subject(ctx), body: template.emailBody(ctx) });
          summary.emailed += 1;
          return;
        } catch (error) {
          lastError = error;
        }
      }
      summary.failed += 1;
      failures.push({ user_id: r.userId, error: String((lastError as Error)?.message || lastError).slice(0, 300) });
    }));

    if (failures.length && sr.entities.AuditLog) {
      await sr.entities.AuditLog.create({
        school_id: schoolId,
        user_id: actorId,
        action: 'NOTIFICATION_DELIVERY_FAILED',
        target_type: event,
        target_id: String(record.id || ''),
        details: { failed: failures.length, total: summary.total, sample: failures.slice(0, 20) },
      }).catch(() => null);
    }
    return summary;
  } catch (error) {
    return { ...summary, error: String((error as Error)?.message || error).slice(0, 300) };
  }
}
