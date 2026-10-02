// lumiQuery — Lumi's read tool. One function, many intents, every answer
// scoped server-side to the caller.
//
// WHY THIS EXISTS (sales-readiness audit 2026-09-29, F16/F17/LUMI-01/LUMI-13)
// Lumi used to get raw entity tools (read Student, Homework, Notice, …). Those
// run under the entity RLS, which for school users (ADMIN/TEACHER/PARENT are
// UserProfile.app_role, not User.role) returns nothing — so every family,
// teacher and director got "Aún no hay información" — and for the platform
// owner returns EVERY school at once. The model was also left to guess field
// names ("date" on Homework, which has due_date) and "today" in UTC.
//
// Here the caller's school, role, classrooms (TeacherClassroom) and children
// (ParentStudent) are re-derived from their own current UserProfile — the
// selectCurrentUserProfile rule, platform owner included — and every read is
// filtered by that school_id with the service role, then re-checked row by row
// (_lumiCore.ts rowVisible). Dates are resolved in America/Mexico_City here,
// and results come back already translated (no ids except the student
// reference Lumi needs for lumiWrite, no English enums, money in MXN).
//
// Tenant READ architecture (P10, owner decision): school users read through
// service-role functions scoped by their own profile. This function and
// schoolRead (the app's screens) share ./_scope.ts byte for byte — the scope
// derivation, the per-entity × role row rules and the field projection — so
// Lumi can never show anyone more than the UI would.
//
// NOT VERIFIED LIVE: whether Base44 forwards the chatting user's token when an
// agent calls a function tool. If it does not, auth.me() fails and this
// returns UNAUTHENTICATED — it fails closed, never open.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';
import { buildScope } from './_scope.ts';
import {
  type Profile, type Scope,
  selectCurrentProfile, profileProblem, canRunIntent, QUERY_INTENTS, scopeRows,
  mexicoToday, mexicoDayOf, addDays, isDateOnly, spanishLongDate, isoWeek, menuDayKey,
  label, formatMXN, fullName, matchStudents, errorMessage, chargeOwed, OPEN_CHARGE_STATUSES,
  displayUserName, displayPersonName, helpsWith, writableKinds, licenseIsReadOnly, nextDueGroup, homeworkRange, attendanceWindow,
} from './_lumiCore.ts';

const MAX_ROWS = 200;

function fail(status: number, code: string): Response {
  return Response.json({ ok: false, code, message: errorMessage(code) }, { status });
}

// deno-lint-ignore no-explicit-any
type Sr = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

// Student rows buildScope already loaded for a PARENT/TEACHER scope, so each
// intent does not re-fetch them one by one (one scope object per request).
const scopedStudents = new WeakMap<Scope, Row[]>();

// The caller's scope comes from ./_scope.ts's buildScope — the same
// derivation schoolRead uses for the app's screens (P10) — plus the Student
// rows it had to load anyway, kept so each intent does not re-fetch them.
async function loadScope(sr: Sr, userId: string, profile: Profile): Promise<Scope> {
  const bundle = await buildScope(sr, userId, profile);
  scopedStudents.set(bundle.scope, bundle.students);
  return bundle.scope;
}

async function schoolStudents(sr: Sr, scope: Scope): Promise<Row[]> {
  if (scope.role === 'ADMIN') {
    const all: Row[] = await sr.entities.Student.filter({ school_id: scope.schoolId }, 'first_name', 1000);
    return all.filter((s) => s.is_active !== false);
  }
  return (scopedStudents.get(scope) || []).filter((s) => String(s.school_id) === scope.schoolId);
}

async function classroomNames(sr: Sr, schoolId: string): Promise<Map<string, string>> {
  const rows: Row[] = await sr.entities.Classroom.filter({ school_id: schoolId });
  return new Map(rows.map((c) => [String(c.id), String(c.name || '')]));
}

// Optional student filter from the model. It must be one the caller can see —
// otherwise it is a denial, not an empty answer.
function pickStudent(scope: Scope, body: Row): { studentId?: string; denied?: boolean } {
  const studentId = body?.student_id ? String(body.student_id) : '';
  if (!studentId) return {};
  if (scope.role !== 'ADMIN' && !scope.studentIds.includes(studentId)) return { denied: true };
  return { studentId };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return fail(401, 'UNAUTHENTICATED');

    const body: Row = await req.json().catch(() => ({}));
    const intent = String(body?.intent || '');
    if (!QUERY_INTENTS[intent]) {
      return Response.json({ ok: false, code: 'UNKNOWN_INTENT', message: errorMessage('UNKNOWN_INTENT'), intents: Object.keys(QUERY_INTENTS) }, { status: 400 });
    }

    const sr = base44.asServiceRole;
    const profiles: Profile[] = await sr.entities.UserProfile.filter({ user_id: user.id });
    const profile = selectCurrentProfile(profiles);
    const problem = profileProblem(profile);
    if (problem) return fail(403, problem);
    if (!canRunIntent(String(profile!.app_role), intent)) return fail(403, 'NOT_ALLOWED_FOR_ROLE');

    const scope = await loadScope(sr, String(user.id), profile!);
    const today = mexicoToday();
    const school = await sr.entities.School.get(scope.schoolId).catch(() => null);
    const base = {
      ok: true,
      intent,
      today,
      today_label: spanishLongDate(today),
      role: label('role', scope.role),
      school_name: String(school?.name || ''),
    };

    const picked = pickStudent(scope, body);
    if (picked.denied) return fail(403, 'STUDENT_NOT_VISIBLE');

    switch (intent) {
      case 'my_context': {
        const students = scope.role === 'ADMIN' ? [] : await schoolStudents(sr, scope);
        // Offer a write only if guardedEntityWrite would take it: the
        // caller's own write overrides and the license, read here with the
        // service role. Any failure offers no write (fails closed).
        let writable: Record<string, boolean> = {};
        if (scope.role !== 'PARENT' && scope.profileId) {
          try {
            const [overrides, subs] = await Promise.all([
              sr.entities.PermissionOverride.filter({ school_id: scope.schoolId, user_profile_id: scope.profileId, action: 'write' }),
              sr.entities.SchoolSubscription.filter({ school_id: scope.schoolId }, '-created_date', 1),
            ]);
            writable = writableKinds({ role: scope.role, overrides, licenseReadOnly: licenseIsReadOnly(subs[0] || null, new Date()) });
          } catch (e) {
            console.warn('lumiQuery my_context: write gate unavailable', (e as Error)?.message);
          }
        }
        const rooms = await classroomNames(sr, scope.schoolId);
        return Response.json({
          ...base,
          // '' when full_name is only the email handle: Lumi must not guess a
          // name out of it (QA r5, LP12).
          // The name the user chose in LIUMA (User.display_name) first.
          user_name: displayUserName(user.display_name || user.data?.display_name || user.full_name, user.email),
          // What to offer, from the server's own intent table (not recalled
          // by the model): a docente is never offered pagos or uniformes.
          helps_with: helpsWith(scope.role, writable),
          classrooms: scope.classroomIds.map((id) => rooms.get(id)).filter(Boolean),
          students: students.map((s) => ({ student_ref: s.id, name: fullName(s), classroom: rooms.get(String(s.classroom_id)) || '' })),
        });
      }

      case 'my_children_summary': {
        const students = await schoolStudents(sr, scope);
        const rooms = await classroomNames(sr, scope.schoolId);
        const children = await Promise.all(students.map(async (s) => {
          const att: Row[] = scopeRows(scope, 'Attendance',
            await sr.entities.Attendance.filter({ school_id: scope.schoolId, student_id: s.id, date: today }));
          const charges: Row[] = scopeRows(scope, 'ChargeItem',
            await sr.entities.ChargeItem.filter({ school_id: scope.schoolId, student_id: s.id }));
          const open = charges.filter((c) => chargeOwed(c) > 0);
          const diary: Row[] = scopeRows(scope, 'DiaryEntry',
            await sr.entities.DiaryEntry.filter({ school_id: scope.schoolId, student_id: s.id, date: today }));
          return {
            student_ref: s.id,
            name: fullName(s),
            classroom: rooms.get(String(s.classroom_id)) || '',
            attendance_today: att[0] ? label('attendance_status', att[0].status) : 'sin registro todavía',
            has_diary_today: diary.length > 0,
            pending_charges: open.length,
            pending_total: formatMXN(open.reduce((sum, c) => sum + chargeOwed(c), 0)),
          };
        }));
        return Response.json({ ...base, children });
      }

      case 'resolve_student_by_name': {
        const students = await schoolStudents(sr, scope);
        const rooms = await classroomNames(sr, scope.schoolId);
        const result = matchStudents(students, body?.name);
        return Response.json({
          ...base,
          status: result.status,
          candidates: result.candidates.slice(0, 10).map((s) => ({
            student_ref: s.id,
            name: fullName(s),
            classroom: rooms.get(String(s.classroom_id)) || '',
          })),
        });
      }

      case 'homework': {
        const { from, to } = homeworkRange(today, body?.from, body?.to);
        let classroomIds = scope.classroomIds;
        if (picked.studentId) {
          const s = await sr.entities.Student.get(picked.studentId).catch(() => null);
          classroomIds = s && String(s.school_id) === scope.schoolId && s.classroom_id ? [String(s.classroom_id)] : [];
        }
        const rows: Row[] = scope.role === 'ADMIN' && !picked.studentId
          ? await sr.entities.Homework.filter({ school_id: scope.schoolId }, '-due_date', MAX_ROWS)
          : (await Promise.all(classroomIds.map((cid) =>
            sr.entities.Homework.filter({ school_id: scope.schoolId, classroom_id: cid }, '-due_date', MAX_ROWS)))).flat();
        const rooms = await classroomNames(sr, scope.schoolId);
        const visible = scopeRows(scope, 'Homework', rows)
          .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
        const present = (h: Row) => ({
          title: h.title, subject: h.subject || '', description: h.description || '',
          due: spanishLongDate(String(h.due_date)), classroom: rooms.get(String(h.classroom_id)) || '',
          teacher: displayPersonName(h.teacher_name),
        });
        const homework = visible
          .filter((h) => String(h.due_date || '') >= from && String(h.due_date || '') <= to)
          .map(present);
        // An empty range is not "no homework": say what comes next, so Lumi
        // can answer "la siguiente entrega es el martes 20" instead of "no hay
        // tareas" (QA r5, LP01). Never a past due date: an empty range of
        // last week must not offer last Friday as "la siguiente".
        // Every task due that day, not only the first (live QA of v1.8.3).
        const next = homework.length ? [] : nextDueGroup(visible, to, today);
        return Response.json({
          ...base,
          range: { from: spanishLongDate(from), to: spanishLongDate(to) },
          homework,
          next_due: next.length ? { due: spanishLongDate(String(next[0].due_date)), items: next.map(present) } : null,
        });
      }

      case 'attendance': {
        const date = isDateOnly(body?.date) ? String(body.date) : today;
        const students = await schoolStudents(sr, scope);
        const names = new Map(students.map((s) => [String(s.id), fullName(s)]));
        let rows: Row[];
        let upcomingRows: Row[] = [];
        if (picked.studentId) {
          // Past 14 days UP TO TODAY; a future row (an approved absence
          // request) is what is scheduled, not an absence that happened
          // (QA r5, LM04).
          const split = attendanceWindow(scopeRows(scope, 'Attendance',
            await sr.entities.Attendance.filter({ school_id: scope.schoolId, student_id: picked.studentId }, '-date', 60)), today);
          rows = split.past;
          upcomingRows = split.upcoming;
        } else {
          rows = await sr.entities.Attendance.filter({ school_id: scope.schoolId, date }, '-date', 1000);
        }
        // The per-student rows were scoped (and projected) above already.
        const visible = picked.studentId ? rows : scopeRows(scope, 'Attendance', rows);
        const present = (r: Row) => ({
          student: names.get(String(r.student_id)) || 'alumno',
          date: spanishLongDate(String(r.date)),
          status: label('attendance_status', r.status),
          reason: r.reason || '',
        });
        const records = visible.map(present);
        const counts: Record<string, number> = {};
        for (const r of visible) counts[label('attendance_status', r.status)] = (counts[label('attendance_status', r.status)] || 0) + 1;
        const recorded = new Set(visible.map((r) => String(r.student_id)));
        const without = picked.studentId ? [] : students.filter((s) => !recorded.has(String(s.id))).map((s) => fullName(s));
        return Response.json({
          ...base,
          date_label: picked.studentId ? `últimos 14 días, hasta hoy ${spanishLongDate(today)}` : spanishLongDate(date),
          counts,
          records: records.slice(0, MAX_ROWS),
          // Per student only: future records (e.g. "falta justificada"
          // already approved for tomorrow). Not counted above.
          upcoming: upcomingRows.slice(0, 20).map(present),
          students_without_record: without.slice(0, 100),
        });
      }

      case 'diary_recent': {
        if (!picked.studentId) return Response.json({ ok: false, code: 'MISSING_STUDENT', message: 'Indica de qué alumno (usa resolve_student_by_name).' }, { status: 400 });
        const since = addDays(today, -Math.min(Math.max(Number(body?.days) || 7, 1), 31));
        const rows: Row[] = await sr.entities.DiaryEntry.filter({ school_id: scope.schoolId, student_id: picked.studentId }, '-date', 40);
        const entries = scopeRows(scope, 'DiaryEntry', rows)
          .filter((d) => String(d.date || '') >= since)
          .map((d) => ({
            date: spanishLongDate(String(d.date)),
            notes: d.notes_text || '',
            mood: label('mood', d.mood) || label('general_mood', d.general_mood),
            food: label('food', d.food) || label('food_mood', d.food_mood),
            behavior: label('behavior', d.behavior),
            learning: label('learning', d.learning),
            nap: d.sleep_hours != null || d.sleep_minutes != null ? `${Number(d.sleep_hours || 0)} h ${Number(d.sleep_minutes || 0)} min` : (d.naps || ''),
            incidents: d.incidents || '',
            teacher: displayPersonName(d.teacher_name),
            // Staff see whether the family got it; a parent only ever gets
            // sent entries (_scope.ts), so the flag would say nothing there.
            ...(scope.role === 'PARENT' ? {} : { sent_to_family: d.sent_to_parents === true }),
          }));
        return Response.json({ ...base, entries });
      }

      case 'pending_charges': {
        const students = await schoolStudents(sr, scope);
        const names = new Map(students.map((s) => [String(s.id), fullName(s)]));
        const rows: Row[] = scope.role === 'PARENT'
          ? (await Promise.all(scope.studentIds.map((id) =>
            sr.entities.ChargeItem.filter({ school_id: scope.schoolId, student_id: id })))).flat()
          // Query the two open statuses directly: a school's paid history must
          // not crowd pending charges out of a row cap.
          : (await Promise.all(OPEN_CHARGE_STATUSES.map((status) =>
            sr.entities.ChargeItem.filter({ school_id: scope.schoolId, status }, 'due_date', 1000)))).flat();
        const open = scopeRows(scope, 'ChargeItem', rows)
          .filter((c) => chargeOwed(c) > 0)
          .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
        const overdue = (c: Row) => c.status === 'OVERDUE' || String(c.due_date || '') < today;
        // What is still owed after partial payments, not the full amounts.
        const total = open.reduce((s, c) => s + chargeOwed(c), 0);
        return Response.json({
          ...base,
          count: open.length,
          total: formatMXN(total),
          overdue_count: open.filter(overdue).length,
          charges: open.slice(0, scope.role === 'PARENT' ? MAX_ROWS : 30).map((c) => ({
            student: names.get(String(c.student_id)) || '',
            concept: c.concept_name || label('charge_type', c.concept_type),
            amount: formatMXN(chargeOwed(c)),
            due: spanishLongDate(String(c.due_date)),
            status: overdue(c) ? 'vencido' : c.status === 'PARTIAL' ? 'pago parcial' : 'pendiente',
          })),
        });
      }

      case 'notices': {
        const rows: Row[] = await sr.entities.Notice.filter({ school_id: scope.schoolId }, '-created_date', 100);
        const nowMs = Date.now();
        // expires_at may be a bare day ("vigente hasta el 30" = all of the 30th)
        // or a timestamp; either way compare in Mexico time, not as strings.
        const stillValid = (n: Row) => {
          if (!n.expires_at) return true;
          const raw = String(n.expires_at);
          if (isDateOnly(raw)) return raw >= today;
          const t = Date.parse(/([zZ]|[+-]\d\d:?\d\d)$/.test(raw) ? raw : `${raw}Z`);
          return !Number.isFinite(t) || t > nowMs;
        };
        const notices = scopeRows(scope, 'Notice', rows)
          .filter(stillValid)
          .slice(0, 15)
          .map((n) => ({
            title: n.title, content: String(n.content || '').slice(0, 600),
            priority: label('notice_priority', n.priority), emergency: !!n.is_emergency,
            author: n.author_name || '', sent: spanishLongDate(mexicoDayOf(n.created_date)),
          }));
        return Response.json({ ...base, notices });
      }

      case 'upcoming_events': {
        const to = addDays(today, Math.min(Math.max(Number(body?.days) || 30, 1), 90));
        const rows: Row[] = await sr.entities.Event.filter({ school_id: scope.schoolId }, 'date', 300);
        const events = scopeRows(scope, 'Event', rows)
          .filter((e) => String(e.date || '') >= today && String(e.date || '') <= to)
          .slice(0, 20)
          .map((e) => ({
            title: e.title, date: spanishLongDate(String(e.date)), time: e.time || '', location: e.location || '',
            description: String(e.description || '').slice(0, 400),
            cost: e.has_cost ? formatMXN(e.cost_amount) : '',
            requires_confirmation: !!e.requires_confirmation,
            confirm_by: e.confirmation_deadline ? spanishLongDate(String(e.confirmation_deadline)) : '',
          }));
        return Response.json({ ...base, events });
      }

      case 'current_menu': {
        const date = isDateOnly(body?.date) ? String(body.date) : today;
        const wk = isoWeek(date);
        const menus: Row[] = wk ? scopeRows(scope, 'WeeklyMenu',
          await sr.entities.WeeklyMenu.filter({ school_id: scope.schoolId, week_number: wk.week, year: wk.year })) : [];
        const menu = menus.find((m) => m.is_active !== false) || null;
        const docs: Row[] = scopeRows(scope, 'OfficialDocument',
          await sr.entities.OfficialDocument.filter({ school_id: scope.schoolId, document_type: 'MENU', is_current: true }));
        const dayKey = menuDayKey(date);
        return Response.json({
          ...base,
          date_label: spanishLongDate(date),
          is_weekend: !dayKey,
          day_menu: menu && dayKey ? String(menu[dayKey] || '') : '',
          week_menu: menu ? {
            lunes: menu.monday || '', martes: menu.tuesday || '', miércoles: menu.wednesday || '',
            jueves: menu.thursday || '', viernes: menu.friday || '',
          } : null,
          menu_document: docs[0] ? { title: docs[0].title, description: docs[0].description || '', url: docs[0].file_url } : null,
        });
      }

      case 'official_documents': {
        const type = String(body?.document_type || '');
        const query: Row = { school_id: scope.schoolId, is_current: true };
        if (['MENU', 'COMMUNICATION', 'MINUTA', 'UNIFORM_CATALOG'].includes(type)) query.document_type = type;
        const docs = scopeRows(scope, 'OfficialDocument', await sr.entities.OfficialDocument.filter(query, '-valid_from', 50))
          .slice(0, 15)
          .map((d) => ({
            title: d.title, type: label('document_type', d.document_type), description: String(d.description || '').slice(0, 600),
            valid_from: d.valid_from ? spanishLongDate(String(d.valid_from)) : '', url: d.file_url,
          }));
        return Response.json({ ...base, documents: docs });
      }

      case 'setup_pending': {
        const rows: Row[] = await sr.entities.SchoolSetupGuide.filter({ school_id: scope.schoolId }, 'step_number', 200);
        const steps = rows.filter((r) => String(r.school_id) === scope.schoolId);
        const pending = steps.filter((s) => !s.is_completed).map((s) => ({
          step: s.step_number, name: s.step_name, category: label('setup_category', s.category),
          description: String(s.description || '').slice(0, 600), notes: String(s.notes || '').slice(0, 300),
        }));
        return Response.json({ ...base, total_steps: steps.length, completed: steps.length - pending.length, pending });
      }

      case 'uniform_status': {
        const students = await schoolStudents(sr, scope);
        const names = new Map(students.map((s) => [String(s.id), fullName(s)]));
        // Dirección sees OPEN orders only, and is told so (open_only +
        // delivered_count): "no hay pedidos" must not read as "never had any"
        // (QA r5, LD04).
        const all: Row[] = scope.role === 'PARENT'
          ? await sr.entities.UniformOrder.filter({ school_id: scope.schoolId, parent_id: user.id }, '-created_date', 50)
          : await sr.entities.UniformOrder.filter({ school_id: scope.schoolId }, '-created_date', 300);
        const openOnly = scope.role !== 'PARENT';
        const scoped = scopeRows(scope, 'UniformOrder', all);
        const rows = openOnly ? scoped.filter((o) => ['PENDING', 'PROCESSING', 'READY'].includes(String(o.status))) : scoped;
        const deliveredCount = scoped.filter((o) => String(o.status) === 'DELIVERED').length;
        const orders = rows.slice(0, 30).map((o) => ({
          student: names.get(String(o.student_id)) || '',
          status: label('uniform_status', o.status),
          items: Array.isArray(o.items) ? o.items.length : 0,
          estimated_delivery: o.estimated_delivery ? spanishLongDate(String(o.estimated_delivery)) : '',
          ordered: spanishLongDate(mexicoDayOf(o.created_date)),
        }));
        return Response.json({ ...base, open_only: openOnly, delivered_count: deliveredCount, orders });
      }
    }

    return fail(400, 'UNKNOWN_INTENT');
  } catch (e) {
    return Response.json({ ok: false, code: 'INTERNAL', message: errorMessage('INTERNAL'), error: (e as Error).message }, { status: 500 });
  }
});
