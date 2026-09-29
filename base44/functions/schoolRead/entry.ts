// schoolRead — the app's tenant READ path (P10, sales-readiness audit F01,
// 2026-09-29). The read-side sibling of guardedEntityWrite.
//
// WHY THIS EXISTS. The deployed entity RLS lets only the Base44 platform owner
// (user.role === 'admin') read School, Classroom, Student, Event, Discount,
// PaymentConcept, WeeklyMenu, OfficialDocument, SchoolSetupGuide,
// PermissionOverride, PendingChange… and everything else only to its author.
// ADMIN / TEACHER / PARENT are UserProfile.app_role, not User.role, so a real
// director, teacher or parent read empty screens. Owner decision: the RLS
// stays strict; school users read through this function, with the service
// role, scoped by their own profile.
//
// Authority model (all of it in ./_scope.ts, shared byte for byte with Lumi):
//   1. Caller must be authenticated.
//   2. Their school and role come from THEIR current UserProfile
//      (selectCurrentProfile — newest ACTIVE+onboarded, deterministic), never
//      from the body. A `school_id` in a filter must equal it (else 403).
//   3. Classrooms (TeacherClassroom) and children (ParentStudent) are
//      re-derived here on every call.
//   4. Each entity × role is an explicit allowlist rule; unknown entities,
//      unknown filter fields and operators other than
//      $eq/$ne/$in/$nin/$gt/$gte/$lt/$lte are refused. Filters only narrow.
//   5. Every row is re-checked and projected (hidden fields removed) before it
//      leaves.
//
// Request shapes:
//   { action: 'context' }
//       → { ok, role, school_id, profile_id, classroom_ids, student_ids,
//           link_student_ids, students, classrooms }
//   { entity, filter?, sort?, limit? (≤1000), skip? }
//       → { ok, rows, has_more, truncated? }
//   { queries: [{ key, entity, filter?, sort?, limit?, skip? }, …] }  (≤12)
//       → { ok, results: { [key]: rows }, has_more: { [key]: bool } }
//     One call, one scope derivation, several reads — how the home screens
//     avoid a round-trip per list.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';
import {
  type Profile, type ReadRequest, type Refusal, type ReadResult,
  selectCurrentProfile, profileProblem, buildScope, describeScope, readFor, MAX_BATCH,
} from './_scope.ts';

function fail(status: number, code: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ ok: false, code, error: code, ...extra }, { status });
}

function isRefusal(r: ReadResult | Refusal): r is Refusal {
  return (r as Refusal).ok === false;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return fail(401, 'UNAUTHENTICATED');

    // deno-lint-ignore no-explicit-any
    const body: any = await req.json().catch(() => ({}));
    const sr = base44.asServiceRole;

    const profiles: Profile[] = await sr.entities.UserProfile.filter({ user_id: user.id }, '-created_date', 50);
    const profile = selectCurrentProfile(profiles);
    const problem = profileProblem(profile);
    if (problem) return fail(403, problem);

    const bundle = await buildScope(sr, String(user.id), profile!, { withClassrooms: body?.action === 'context' });
    const { scope } = bundle;

    if (body?.action === 'context') {
      return Response.json({ ok: true, ...describeScope(bundle) });
    }

    if (Array.isArray(body?.queries)) {
      if (body.queries.length === 0 || body.queries.length > MAX_BATCH) return fail(400, 'INVALID_BATCH');
      const results: Record<string, unknown> = {};
      const hasMore: Record<string, boolean> = {};
      for (const q of body.queries) {
        const key = typeof q?.key === 'string' && q.key ? q.key : '';
        if (!key || key in results) return fail(400, 'INVALID_BATCH');
        const out = await readFor(sr, scope, q as ReadRequest);
        if (isRefusal(out)) return fail(out.status, out.code, { key, field: out.field });
        results[key] = out.rows;
        hasMore[key] = out.has_more;
      }
      return Response.json({ ok: true, results, has_more: hasMore });
    }

    const out = await readFor(sr, scope, body as ReadRequest);
    if (isRefusal(out)) return fail(out.status, out.code, out.field ? { field: out.field } : {});
    return Response.json(out);
  } catch (e) {
    return Response.json({ ok: false, code: 'INTERNAL', error: (e as Error).message }, { status: 500 });
  }
});
