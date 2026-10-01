// _answer.ts — what schoolRead does once it knows who is asking (v1.8.3).
//
// Split out of entry.ts so the WHOLE request path — profile pick, scope
// derivation, single read, batch, context — runs under `node --test` and the
// load test (scripts/load-test-reads.mjs) against the in-memory fake DB, with
// every service-role call counted. entry.ts keeps only what needs Deno and the
// SDK: authenticating the caller and reading their own UserProfile rows.
//
// Import-free apart from ./_scope.ts (Node 22 strips the types), same as
// _scope.ts itself.
//
// WHY THE COUNT MATTERS. Base44 refuses an entity call with "Rate limit
// exceeded" once the app spends its budget — about 150 operations a minute,
// and every service-role call made by every user's function invocation draws
// from the SAME budget (production logs, 2026-10-01: schoolRead and
// getMySubscription failed in the same seconds for three different users). So
// the cost of a screen is the number of service-role operations it causes,
// and the things that multiply it are: one invocation per list (each one
// re-derives the scope: 2 operations for a parent or a teacher before the
// read itself) and the profile lookup (moved to the caller's own token in
// entry.ts — UserProfile.read is own-row under RLS).
import {
  type Profile, type ReadRequest, type Refusal, type ReadResult, type Db,
  selectCurrentProfile, profileProblem, buildScope, describeScope, readFor, needsScan,
  MAX_BATCH, MAX_SCANS_PER_BATCH,
} from './_scope.ts';

export type Answer = { status: number; body: Record<string, unknown> };

function fail(status: number, code: string, extra: Record<string, unknown> = {}): Answer {
  return { status, body: { ok: false, code, error: code, ...extra } };
}

function isRefusal(r: ReadResult | Refusal): r is Refusal {
  return (r as Refusal).ok === false;
}

/**
 * Answer one schoolRead request for an authenticated caller.
 *   sr        the service-role client (`base44.asServiceRole`)
 *   userId    the caller's user id (from auth.me(), never from the body)
 *   profiles  the caller's own UserProfile rows
 *   body      the request body
 * Scope is derived ONCE per request, however many reads the batch carries.
 */
export async function answerSchoolRead(
  // deno-lint-ignore no-explicit-any
  sr: Db, userId: string, profiles: Profile[], body: any,
): Promise<Answer> {
  const profile = selectCurrentProfile(profiles);
  const problem = profileProblem(profile);
  if (problem) return fail(403, problem);

  // `context: true` on a batch: the caller's context rides along with the
  // reads (v1.8.3) — a screen that needs both pays for one scope derivation.
  const withContext = body?.action === 'context' || (Array.isArray(body?.queries) && body?.context === true);
  const bundle = await buildScope(sr, userId, profile!, { withClassrooms: withContext });
  const { scope } = bundle;

  if (body?.action === 'context') {
    return { status: 200, body: { ok: true, ...describeScope(bundle) } };
  }

  if (Array.isArray(body?.queries)) {
    if (body.queries.length === 0 || body.queries.length > MAX_BATCH) return fail(400, 'INVALID_BATCH');
    // deno-lint-ignore no-explicit-any
    const scans = body.queries.filter((q: any) => needsScan(scope.role, String(q?.entity ?? ''))).length;
    if (scans > MAX_SCANS_PER_BATCH) return fail(400, 'TOO_MANY_SCANS');
    const results: Record<string, unknown> = {};
    const hasMore: Record<string, boolean> = {};
    const truncated: Record<string, boolean> = {};
    for (const q of body.queries) {
      const key = typeof q?.key === 'string' && q.key ? q.key : '';
      if (!key || key in results) return fail(400, 'INVALID_BATCH');
      const out = await readFor(sr, scope, q as ReadRequest);
      if (isRefusal(out)) return fail(out.status, out.code, { key, field: out.field });
      results[key] = out.rows;
      hasMore[key] = out.has_more;
      if (out.truncated) truncated[key] = true;
    }
    const response: Record<string, unknown> = { ok: true, results, has_more: hasMore };
    if (Object.keys(truncated).length) response.truncated = truncated;
    if (withContext) response.context = describeScope(bundle);
    return { status: 200, body: response };
  }

  const out = await readFor(sr, scope, body as ReadRequest);
  if (isRefusal(out)) return fail(out.status, out.code, out.field ? { field: out.field } : {});
  return { status: 200, body: out as unknown as Record<string, unknown> };
}

/**
 * True when Base44 refused an entity call for the app's rate limit. The SDK
 * throws a Base44Error with status 429 and the message "Rate limit exceeded";
 * either is enough. Such a failure is a 429 to the caller — retryable after a
 * pause — not a 500 INTERNAL, which is what every one of them used to become.
 */
export function isRateLimitError(e: unknown): boolean {
  const err = e as { status?: unknown; message?: unknown } | null;
  return err?.status === 429 || /rate limit/i.test(String(err?.message ?? ''));
}

/** Seconds the client should wait before retrying a rate-limited read. */
export const RATE_LIMIT_RETRY_AFTER_S = 3;
