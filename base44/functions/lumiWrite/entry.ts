// lumiWrite — the only way Lumi can change data: register attendance or a
// bitácora for one student, in two steps (preview -> commit).
//
// WHY THIS EXISTS (sales-readiness audit 2026-09-29, F07 agent half / LUMI-02 /
// LUMI-03). lumi.jsonc used to grant DiaryEntry [create] and Attendance
// [create, update] to the one agent every role talks to. Those entity tools
// wrote under RLS rules that only pin recorded_by/teacher_id to the caller, so
// a PARENT could ask Lumi to mark attendance, any student_id could be written,
// and the writes skipped guardedEntityWrite (PermissionOverride deny, the
// read-only billing gate, the student-in-school check) and notifyParents.
// The model also had no way to resolve "Sofía" to a real student and was told
// to fill school_id/student_id "del contexto", i.e. to guess.
//
// What this does instead:
//   1. Re-derives the caller's school/role/classrooms from their current
//      UserProfile (selectCurrentUserProfile rule, platform owner included).
//      Only TEACHER and ADMIN may write; a TEACHER only for students in their
//      own classrooms (TeacherClassroom) — guardedEntityWrite does not check
//      that, so it is checked here.
//   2. Whitelists and validates the payload (_lumiCore.ts validateWrite).
//      school_id, classroom_id and student_id come from the resolved Student
//      record, never from the model.
//   3. action:'preview' returns a Spanish summary + confirmation_code.
//      action:'commit' only runs with the code that exact preview produced
//      (a digest of who/what/when, see confirmationCode) — the model cannot
//      skip the preview or commit something other than what was shown.
//      Since v1.9.0 the code also expires after 10 minutes (410 CODE_EXPIRED)
//      and commits once (409 CODE_USED): repeating a commit no longer
//      re-applies it, e.g. reverting a correction made since in Asistencia.
//   4. DELEGATES the write to guardedEntityWrite and the parent email to
//      notifyParents, invoked with the caller's own token — the same two
//      functions the Asistencia and CrearBitacora pages use. No write or
//      permission logic is duplicated here.
//
// NOT VERIFIED LIVE: (a) that Base44 forwards the chatting user's token to an
// agent's function tool, and (b) that a function's user-scoped client forwards
// it again on functions.invoke. Either one missing makes this fail closed
// (UNAUTHENTICATED / WRITE_FAILED), never write as someone else.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';
import {
  type Profile, type Scope,
  selectCurrentProfile, profileProblem, canWriteKind, WRITE_KINDS,
  mexicoToday, validateWrite, confirmationCode, describeWrite, fullName, errorMessage, label,
  checkConfirmationCode, claimConfirmationCode, releaseConfirmationCode, CONFIRMATION_TTL_SECONDS,
} from './_lumiCore.ts';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

function fail(status: number, code: string, extra: Row = {}): Response {
  return Response.json({ ok: false, code, message: errorMessage(code), ...extra }, { status });
}

// functions.invoke's return shape differs across SDK builds (the body itself,
// or an axios-style { data }). Normalize to the function's JSON body.
// deno-lint-ignore no-explicit-any
function unwrap(result: any): Row {
  if (result && typeof result === 'object' && result.data && typeof result.data === 'object' && 'ok' in result.data) {
    return result.data;
  }
  return result || {};
}

// deno-lint-ignore no-explicit-any
function invokeError(e: any): Row {
  return e?.response?.data || e?.data || { code: 'WRITE_FAILED' };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return fail(401, 'UNAUTHENTICATED');

    const body: Row = await req.json().catch(() => ({}));
    const action = String(body?.action || 'preview');
    const kind = String(body?.kind || '');
    if (!WRITE_KINDS[kind]) return fail(400, 'UNKNOWN_KIND');
    if (action !== 'preview' && action !== 'commit') return fail(400, 'UNKNOWN_INTENT');

    const sr = base44.asServiceRole;
    const profiles: Profile[] = await sr.entities.UserProfile.filter({ user_id: user.id });
    const profile = selectCurrentProfile(profiles);
    const problem = profileProblem(profile);
    if (problem) return fail(403, problem);
    const role = String(profile!.app_role) as Scope['role'];
    const schoolId = String(profile!.school_id);
    if (!canWriteKind(role, kind)) return fail(403, 'NOT_ALLOWED_FOR_ROLE');

    // The student must exist, be active, be in the caller's school and — for a
    // TEACHER — in one of their own classrooms.
    const studentId = String(body?.student_id || '');
    const student: Row | null = studentId ? await sr.entities.Student.get(studentId).catch(() => null) : null;
    if (!student || String(student.school_id || '') !== schoolId || student.is_active === false) {
      return fail(403, 'STUDENT_NOT_VISIBLE');
    }
    if (role === 'TEACHER') {
      const assignments: Row[] = await sr.entities.TeacherClassroom.filter({ teacher_id: user.id, school_id: schoolId });
      const mine = assignments.filter((a) => a.is_active !== false).map((a) => String(a.classroom_id || ''));
      if (!student.classroom_id || !mine.includes(String(student.classroom_id))) return fail(403, 'STUDENT_NOT_VISIBLE');
    }

    const today = mexicoToday();
    const validation = validateWrite(kind, body?.data || {}, today);
    if (!validation.ok) {
      return Response.json({
        ok: false, code: 'INVALID_DATA', errors: validation.errors,
        messages: validation.errors.map(errorMessage),
      }, { status: 400 });
    }
    const data = validation.data;
    const name = fullName(student);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const writeParts = { userId: String(user.id), kind, studentId, data };

    // Existing record for that student and day (attendance is updated in place;
    // a second bitácora the same day is refused, same as CrearBitacora).
    const existingRows: Row[] = await sr.entities[kind === 'attendance' ? 'Attendance' : 'DiaryEntry']
      .filter({ school_id: schoolId, student_id: studentId, date: data.date });
    const existing = existingRows[0] || null;
    if (kind === 'diary' && existing) return fail(409, 'ALREADY_EXISTS');

    if (action === 'preview') {
      const code = await confirmationCode({ ...writeParts, issuedAt: nowSeconds });
      return Response.json({
        ok: true,
        action: 'preview',
        summary: describeWrite(kind, name, data),
        replaces_existing: kind === 'attendance' && !!existing,
        // What the teacher would be overwriting, so "¿Lo registro?" can say
        // "hoy ya estaba como ausente".
        previous_status: kind === 'attendance' && existing ? label('attendance_status', existing.status) : '',
        confirmation_code: code,
        confirmation_expires_in_minutes: CONFIRMATION_TTL_SECONDS / 60,
        next_step: 'Muestra el resumen y pregunta "¿Lo registro?". Sólo si la persona confirma, repite la llamada con action "commit", los mismos datos y este confirmation_code. El código sirve una sola vez y caduca en 10 minutos.',
      });
    }

    const codeState = await checkConfirmationCode(body?.confirmation_code, writeParts, nowSeconds);
    if (codeState === 'NEEDS_CONFIRMATION') return fail(409, 'NEEDS_CONFIRMATION');
    if (codeState === 'CODE_EXPIRED') return fail(410, 'CODE_EXPIRED');
    // Single use: the claim is written before the write and re-read, so two
    // commits with the same code cannot both get through.
    const code = String(body.confirmation_code);
    const claimId = await claimConfirmationCode(sr, {
      code, userId: String(user.id), userEmail: user.email || '', schoolId, kind, studentId,
    });
    if (!claimId) return fail(409, 'CODE_USED');

    // --- commit: delegate to guardedEntityWrite with the caller's own token.
    let record: Row | null = null;
    try {
      if (kind === 'attendance') {
        const payload = existing
          ? { entity: 'Attendance', operation: 'update', id: existing.id, data: { status: data.status, reason: data.reason || '' } }
          : {
            entity: 'Attendance', operation: 'create',
            data: { school_id: schoolId, classroom_id: student.classroom_id, student_id: studentId, ...data },
          };
        record = unwrap(await base44.functions.invoke('guardedEntityWrite', payload)).record || null;
      } else {
        const payload = {
          entity: 'DiaryEntry', operation: 'create',
          data: {
            school_id: schoolId, classroom_id: student.classroom_id, student_id: studentId, ...data,
            sent_at: data.sent_to_parents ? new Date().toISOString() : undefined,
          },
        };
        record = unwrap(await base44.functions.invoke('guardedEntityWrite', payload)).record || null;
      }
    } catch (e) {
      // Nothing was written: give the code back so a retry within its 10
      // minutes works (a retry is safe — attendance updates in place, a
      // second bitácora is refused as ALREADY_EXISTS).
      await releaseConfirmationCode(sr, claimId);
      const err = invokeError(e);
      const denied = ['FORBIDDEN', 'WRITE_BLOCKED', 'STUDENT_NOT_IN_SCHOOL', 'NO_PROFILE'].includes(String(err.code));
      return fail(denied ? 403 : 502, err.code === 'WRITE_BLOCKED' || err.code === 'FORBIDDEN' ? err.code : 'WRITE_FAILED');
    }
    if (!record?.id) {
      await releaseConfirmationCode(sr, claimId);
      return fail(502, 'WRITE_FAILED');
    }

    // Parent email, same function and same conditions as the app's own pages:
    // an absence always notifies (notifyParents is idempotent per record), a
    // bitácora only when the teacher said to send it. Best effort — the record
    // is saved either way, and the answer says whether the email went out.
    let parentsNotified: boolean | null = null;
    const notifyKind = kind === 'attendance' ? (data.status === 'absent' ? 'absence' : null) : (data.sent_to_parents ? 'diary' : null);
    if (notifyKind) {
      try {
        const res = unwrap(await base44.functions.invoke('notifyParents', { kind: notifyKind, recordId: record.id }));
        parentsNotified = Number(res.sent || 0) > 0;
      } catch (_e) {
        parentsNotified = false;
      }
    }

    // Server-side trace of what the assistant did, in the same log the app's
    // own AI calls use.
    await sr.entities.AuditLog.create({
      school_id: schoolId,
      user_id: user.id,
      user_email: user.email || '',
      action: 'AI_REQUEST_ALLOWED',
      target_type: kind === 'attendance' ? 'Attendance' : 'DiaryEntry',
      target_id: String(record.id),
      details: { tool: 'lumiWrite', kind, updated_existing: !!existing, parents_notified: parentsNotified, confirmation_code: code },
    }).catch(() => null);

    return Response.json({
      ok: true,
      action: 'commit',
      summary: describeWrite(kind, name, data),
      updated_existing: !!existing,
      parents_notified: parentsNotified,
    });
  } catch (e) {
    return Response.json({ ok: false, code: 'INTERNAL', message: errorMessage('INTERNAL'), error: (e as Error).message }, { status: 500 });
  }
});
