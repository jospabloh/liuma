// notifyParents — server-side email delivery for the two parent-facing email
// touches that used to fire directly from the browser via
// base44.integrations.Core.SendEmail: Asistencia.jsx's absence notice and
// CrearBitacora.jsx's diary send.
//
// WHY THIS EXISTS (Base44 security scan, "Evitar el uso no autorizado de
// créditos", High). SendEmail is a credit-consuming integration; called from
// src/ with the client building the subject/body/recipient list itself, any
// token holder could burn credits — or turn it into a free mail relay — with
// arbitrary content. Here the caller supplies only a stored record id: the
// subject, body and recipient list are all derived server-side from that
// record and its linked Student/ParentStudent/User rows, so nothing in the
// request body reaches the outgoing message. For the absence path,
// idempotency doubles as the credit guard: a record that's already
// `parent_notified` (or no longer `absent`) is a no-op instead of a resend —
// a caller retrying the same recordId can't multiply the credit spend.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';

const MAX_RECIPIENTS = 20;
const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function bad(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, code, error: message }, { status });
}

// Duplicated from src/lib/htmlEscape.js — Deno functions can't import across
// function directories (same constraint documented on
// guardedEntityWrite/entry.ts), and every interpolated field here (a
// student's name, a teacher's free-text notes/message, an attendance reason)
// is entity data a school user entered, so it's escaped uniformly before
// landing in an HTML email body (OWASP A03 / CWE-79).
function escapeHtml(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// record.date is a plain 'YYYY-MM-DD' string (Base44 `format: "date"`); both
// renderers below are pure string ops on that, no date-fns / Date parsing
// (avoids timezone-shift bugs from `new Date('YYYY-MM-DD')`).
function ddmmyyyy(dateStr: string): string {
  const [y, m, d] = String(dateStr || '').split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

function spanishDate(dateStr: string, withYear: boolean): string {
  const parts = String(dateStr || '').split('-').map(Number);
  const [y, m, d] = parts;
  if (!y || !m || !d) return '';
  const month = MONTHS_ES[m - 1] || '';
  return withYear ? `${d} de ${month}, ${y}` : `${d} de ${month}`;
}

// deno-lint-ignore no-explicit-any
async function resolveParentEmails(sr: any, studentId: string): Promise<string[]> {
  const links: Array<{ parent_id?: string }> = await sr.entities.ParentStudent.filter({ student_id: studentId, status: 'ACTIVE' });
  const emails: string[] = [];
  for (const link of links.slice(0, MAX_RECIPIENTS)) {
    if (!link.parent_id) continue;
    const parent = await sr.entities.User.get(link.parent_id).catch(() => null);
    if (parent?.email) emails.push(parent.email);
  }
  return emails;
}

const DIARY_NOTIFY_WINDOW_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return bad(401, 'UNAUTHENTICATED', 'Unauthorized');

    const body = await req.json().catch(() => ({}));
    const kind = String(body?.kind || '');
    const recordId = String(body?.recordId || '');
    if (kind !== 'absence' && kind !== 'diary') return bad(400, 'BAD_KIND', 'kind must be absence or diary');
    if (!recordId) return bad(400, 'MISSING_RECORD', 'recordId is required');

    const sr = base44.asServiceRole;
    const isPlatformOwner = user.role === 'admin';
    const userId = user.id;

    const assertCallerCanNotify = async (schoolId: string) => {
      if (isPlatformOwner) return;
      const profiles: Array<{ status?: string; app_role?: string }> = await sr.entities.UserProfile.filter({ user_id: userId, school_id: schoolId });
      const profile = profiles.find((p) => p.status === 'ACTIVE' && ['TEACHER', 'ADMIN'].includes(String(p.app_role)));
      if (!profile) throw { status: 403, code: 'NO_PROFILE', message: 'Requires an active TEACHER or ADMIN profile in this school' };
    };

    // Base44 security scan, 2026-09-28 (confirmed): assertCallerCanNotify
    // only checks the CALLER's profile against the RECORD's school_id — it
    // never checks that the STUDENT the record points at is actually in
    // that school. guardedEntityWrite's create path ties school_id to the
    // caller's own profile but takes student_id from the client as-is, so a
    // teacher in school A could create an Attendance/DiaryEntry row with
    // school_id: A but student_id pointing at a school-B student, then have
    // this function mail that student's real parents. Failing closed here
    // if the two disagree closes that cross-school targeting without
    // touching the (legitimate) same-school case of an ADMIN notifying for
    // a different teacher's record.
    const assertStudentInSchool = (student: { school_id?: string } | null, schoolId: string) => {
      if (!student || String(student.school_id || '') !== schoolId) {
        throw { status: 404, code: 'NOT_FOUND', message: 'Student not found in this school' };
      }
    };

    if (kind === 'absence') {
      const record = await sr.entities.Attendance.get(recordId).catch(() => null);
      if (!record) return bad(404, 'NOT_FOUND', 'Attendance record not found');
      await assertCallerCanNotify(String(record.school_id || ''));

      // Idempotency IS the credit guard here: a record that's no longer
      // 'absent', or already notified, is a no-op rather than a resend.
      if (record.status !== 'absent' || record.parent_notified) {
        return Response.json({ ok: true, skipped: true });
      }

      const student = await sr.entities.Student.get(String(record.student_id || '')).catch(() => null);
      assertStudentInSchool(student, String(record.school_id || ''));
      const emails = await resolveParentEmails(sr, String(record.student_id || ''));

      const firstName = escapeHtml(student?.first_name);
      const lastName = escapeHtml(student?.last_name);
      const dateLabel = escapeHtml(ddmmyyyy(String(record.date || '')));
      const reason = record.reason ? String(record.reason) : '';

      const subject = `Ausencia de ${student?.first_name || ''} ${student?.last_name || ''}`.trim();
      const emailBody = `
        <h2>Notificación de Ausencia</h2>
        <p>Estimado padre/madre de familia:</p>
        <p>Le informamos que <strong>${firstName} ${lastName}</strong> no asistió a clases el día <strong>${dateLabel}</strong>.</p>
        ${reason ? `<p><strong>Motivo registrado:</strong> ${escapeHtml(reason)}</p>` : ''}
        <p>Si tiene alguna pregunta, por favor contacte a la escuela.</p>
        <p>Atentamente,<br>Equipo LIUMA</p>
      `;

      const results = await Promise.allSettled(emails.map((to) =>
        sr.integrations.Core.SendEmail({ from_name: 'LIUMA - Sistema Escolar', to, subject, body: emailBody })
      ));
      const sent = results.filter((r) => r.status === 'fulfilled').length;

      // Only a delivered email marks the record: if every send failed, leave
      // it unmarked so the next save of this absence can try again.
      if (sent > 0) {
        await sr.entities.Attendance.update(recordId, { parent_notified: true, notified_at: new Date().toISOString() });
      }
      return Response.json({ ok: true, sent, failed: emails.length - sent });
    }

    // kind === 'diary'
    const record = await sr.entities.DiaryEntry.get(recordId).catch(() => null);
    if (!record) return bad(404, 'NOT_FOUND', 'Diary entry not found');
    await assertCallerCanNotify(String(record.school_id || ''));

    if (!record.sent_to_parents) {
      return Response.json({ ok: true, skipped: true });
    }
    const createdAt = Date.parse(String(record.created_date || ''));
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > DIARY_NOTIFY_WINDOW_MS) {
      return Response.json({ ok: true, skipped: true, reason: 'window_expired' });
    }

    const student = await sr.entities.Student.get(String(record.student_id || '')).catch(() => null);
    assertStudentInSchool(student, String(record.school_id || ''));
    const allEmails = await resolveParentEmails(sr, String(record.student_id || ''));
    // Idempotency guard (Base44 security scan finding, 2026-09-28; corrected
    // same day per a Codex review catching the first version of this fix).
    // Tracked PER RECIPIENT (notified_parent_emails), not a single
    // sent/not-sent flag on the record: a single flag set after ANY
    // successful send would let a genuinely-failed recipient (bad address,
    // transient SendEmail error) never get retried, since the whole record
    // would already read as "notified". Filtering to only the
    // not-yet-notified emails on each call still closes the credit-drain
    // replay (a fully-delivered record has nothing left to send to) while
    // letting a partial failure recover on the next call within the window.
    const alreadyNotified: string[] = Array.isArray(record.notified_parent_emails) ? record.notified_parent_emails : [];
    const emails = allEmails.filter((e) => !alreadyNotified.includes(e));
    if (emails.length === 0) {
      return Response.json({ ok: true, skipped: true, reason: allEmails.length === 0 ? 'no_recipients' : 'already_notified' });
    }

    const dateNoYear = spanishDate(String(record.date || ''), false);
    const dateWithYear = spanishDate(String(record.date || ''), true);

    const subject = `Nueva bitácora de ${student?.first_name || ''} - ${dateNoYear}`;
    const emailBody = `
      <h2>Bitácora de ${escapeHtml(student?.first_name)} ${escapeHtml(student?.last_name)}</h2>
      <p><strong>Fecha:</strong> ${escapeHtml(dateWithYear)}</p>

      <div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p style="color: #334155; white-space: pre-wrap;">${escapeHtml(record.notes_text)}</p>
      </div>

      ${record.teacher_message ? `
        <div style="background: linear-gradient(to right, #fce7f3, #f3e8ff); padding: 16px; border-radius: 8px; border: 1px solid #f9a8d4; margin: 16px 0;">
          <p style="font-size: 12px; color: #9f1239; font-weight: bold; margin-bottom: 8px;">💌 Mensajito especial</p>
          <p style="color: #7c3aed;">${escapeHtml(record.teacher_message)}</p>
        </div>
      ` : ''}

      <p style="margin-top: 16px;">Registrado por: ${escapeHtml(record.teacher_name)}</p>
      <p style="color: #64748b; font-size: 12px; margin-top: 8px;">Este es un mensaje automático de LIUMA.</p>
    `;

    const results = await Promise.allSettled(emails.map((to) =>
      sr.integrations.Core.SendEmail({ from_name: 'LIUMA - Bitácora Escolar', to, subject, body: emailBody })
    ));
    const newlyNotified = emails.filter((_, i) => results[i].status === 'fulfilled');
    const sent = newlyNotified.length;

    // Only the emails that actually delivered join notified_parent_emails —
    // a failed one stays out, so it's picked up again by the `emails`
    // filter above on the next call within the window, instead of being
    // silently skipped forever.
    if (sent > 0) {
      await sr.entities.DiaryEntry.update(recordId, {
        notified_parent_emails: [...alreadyNotified, ...newlyNotified],
        parents_notified_at: record.parents_notified_at || new Date().toISOString(),
      });
    }
    return Response.json({ ok: true, sent, failed: emails.length - sent });
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) {
      const err = e as { status: number; code: string; message: string };
      return bad(err.status, err.code, err.message);
    }
    return Response.json({ ok: false, code: 'INTERNAL', error: (e as Error).message }, { status: 500 });
  }
});
