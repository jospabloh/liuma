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
//   { queries: [{ key, entity, filter?, sort?, limit?, skip? }, …],  (≤12,
//     context?: true }   of which ≤MAX_SCANS_PER_BATCH scan-mode reads — see
//                        needsScan)
//       → { ok, results: { [key]: rows }, has_more: { [key]: bool },
//           context? (same shape as action:'context', when asked) }
//     One call, one scope derivation, several reads — how the home screens
//     avoid a round-trip per list. Since v1.8.3 the client batches on its own:
//     single schoolRead() calls made in the same tick travel as one of these
//     (src/lib/data/schoolReadCore.js).
//
// The request handling itself lives in ./_answer.ts (import-free, so the
// tests and scripts/load-test-reads.mjs run it against a fake DB).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';
import type { Profile } from './_scope.ts';
import { answerSchoolRead, isRateLimitError, RATE_LIMIT_RETRY_AFTER_S } from './_answer.ts';
import { makeUserRateLimiter } from './_userLimit.ts';

// One bucket per user, per isolate (./_userLimit.ts says why it is not shared
// storage). Module scope, so it outlives a single request in a warm isolate.
const userLimiter = makeUserRateLimiter();

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ ok: false, code: 'UNAUTHENTICATED', error: 'UNAUTHENTICATED' }, { status: 401 });

    // Before ANY entity call: a user past their share answers 429 without
    // spending the app-wide budget (v1.9.0). Same shape as the platform's own
    // limit below, so the client's read retry (functionRetry.js) honours it.
    const allowed = userLimiter.take(String(user.id));
    if (!allowed.ok) {
      console.warn('schoolRead user rate limited');
      return Response.json(
        { ok: false, code: 'RATE_LIMITED', error: 'RATE_LIMITED', limit: 'user' },
        { status: 429, headers: { 'Retry-After': String(allowed.retryAfterS) } },
      );
    }

    // deno-lint-ignore no-explicit-any
    const body: any = await req.json().catch(() => ({}));

    // The caller's OWN profile rows, read with THEIR token (UserProfile.read
    // is own-row under RLS — the same read useCurrentProfile makes in the
    // browser). With the service role this was one more call per invocation
    // against the app-wide budget that three concurrent users exhausted
    // (v1.8.3, see _answer.ts). The filter is still pinned to user.id.
    const profiles: Profile[] = await base44.entities.UserProfile.filter({ user_id: user.id }, '-created_date', 50);

    const answer = await answerSchoolRead(base44.asServiceRole, String(user.id), profiles, body);
    return Response.json(answer.body, { status: answer.status });
  } catch (e) {
    // Base44's rate limit is a 429 with a pause, not a crash: the client
    // retries a read on it (src/lib/functionRetry.js). Before v1.8.3 it came
    // back as 500 INTERNAL, indistinguishable from a bug.
    if (isRateLimitError(e)) {
      console.warn('schoolRead rate limited');
      return Response.json(
        { ok: false, code: 'RATE_LIMITED', error: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(RATE_LIMIT_RETRY_AFTER_S) } },
      );
    }
    // The detail goes to the function log, not to the caller: a raw SDK error
    // can name entities, queries or ids.
    console.error('schoolRead failed', (e as Error)?.message);
    return Response.json({ ok: false, code: 'INTERNAL', error: 'INTERNAL' }, { status: 500 });
  }
});
