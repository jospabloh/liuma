// listSchoolMembers — the school's member directory: id, full_name and email
// of every user with a UserProfile in ONE school, and nothing else.
//
// WHY THIS EXISTS (sales-readiness audit, finding F09, 2026-09-29).
// UserProfile carries no name or email, so eight client call sites used to
// resolve them with `base44.entities.User.list()`. Under Base44's built-in
// User visibility a regular user can only read their OWN User row, so a
// school ADMIN saw "Sin nombre / Sin correo" for everyone they were
// approving, a teacher linking a parent picked from identical blanks, and the
// emergency alert resolved `email: undefined` for every recipient — silently.
// If the default were ever permissive the same call would instead download
// the platform-wide user list (cross-tenant PII). Both outcomes were wrong;
// this function is the replacement for every one of those reads.
//
// Authority model:
//   1. Caller must be authenticated.
//   2. `schoolId` comes from the request (the client shows the school it is
//      on), but it is only honoured if the caller holds an ACTIVE ADMIN or
//      TEACHER UserProfile IN THAT SCHOOL — re-read here with the service
//      role, never trusted from the body. A PARENT has no use for the
//      directory and gets 403. Platform owner (user.role === 'admin')
//      bypasses, same convention as every other function in this app.
//   3. An ADMIN sees every member of the school, including PENDING and
//      SUSPENDED profiles (Aprobaciones needs the pending ones' names). A
//      TEACHER sees only ACTIVE members — enough to link a parent to a
//      student, without exposing who is waiting for approval.
//   4. The response carries id / full_name / email ONLY. No role, phone,
//      preferences or anything else from User — the client already has the
//      profile rows it needs for those.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';

// A school directory bigger than this is not a real school; the cap only
// exists so a bug can't turn one call into an unbounded scan.
const MAX_MEMBERS = 5000;
const DIRECTORY_ROLES = ['ADMIN', 'TEACHER'];

type Profile = { user_id?: string; school_id?: string; app_role?: string; status?: string; consent_notice_version?: string; consent_terms_version?: string };
// Accepting the current Aviso de Privacidad and Términos is mandatory to use
// LIUMA (v1.9.0). MIRRORS schoolRead/_scope.ts#profileConsentIsCurrent and
// src/lib/consent/privacyNotice.js; tests/unit/consent-gate.test.js checks
// every copy of the versions.
const CONSENT_NOTICE_VERSION = '2026-10-02';
const CONSENT_TERMS_VERSION = '2026-10-02';
function profileConsentIsCurrent(profile: { consent_notice_version?: unknown; consent_terms_version?: unknown } | null): boolean {
  return Boolean(profile)
    && profile!.consent_notice_version === CONSENT_NOTICE_VERSION
    && profile!.consent_terms_version === CONSENT_TERMS_VERSION;
}

type DirectoryUser = { id: string; full_name: string; email: string };

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
    // A deletion of this account started or finished (deleteMyAccount): no
    // access here, whatever consent stamp a race may have left behind.
    // auth.me() returns the User's custom fields, so this costs no read.
    if (accountDeletionBlocked(user)) return Response.json({ ok: false, code: 'ACCOUNT_DELETION_IN_PROGRESS', error: 'ACCOUNT_DELETION_IN_PROGRESS' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const schoolId = String(body?.schoolId || '');
    if (!schoolId) return bad(400, 'MISSING_SCHOOL', 'schoolId is required');

    const sr = base44.asServiceRole;
    const isPlatformOwner = user.role === 'admin';

    let callerRole = 'ADMIN';
    if (!isPlatformOwner) {
      const callerProfiles: Profile[] = await sr.entities.UserProfile.filter(
        { user_id: user.id, school_id: schoolId },
        '-created_date',
      );
      const callerProfile = callerProfiles.find(
        (p) => p.status === 'ACTIVE' && DIRECTORY_ROLES.includes(String(p.app_role)),
      );
      if (!callerProfile) return bad(403, 'FORBIDDEN', 'Requires an active ADMIN or TEACHER profile in this school');
      if (!profileConsentIsCurrent(callerProfile)) return bad(403, 'CONSENT_REQUIRED', 'Accept the current privacy notice first');
      callerRole = String(callerProfile.app_role);
    }

    const schoolProfiles: Profile[] = await sr.entities.UserProfile.filter(
      { school_id: schoolId },
      '-created_date',
      MAX_MEMBERS,
    );
    const visibleProfiles = callerRole === 'ADMIN'
      ? schoolProfiles
      : schoolProfiles.filter((p) => p.status === 'ACTIVE');

    const userIds = [...new Set(visibleProfiles.map((p) => p.user_id).filter(Boolean) as string[])];
    if (userIds.length === 0) return Response.json({ ok: true, users: [] });

    // deno-lint-ignore no-explicit-any
    const rows: any[] = await sr.entities.User.filter({ id: { $in: userIds } }, undefined, MAX_MEMBERS);
    const users: DirectoryUser[] = (rows || [])
      .filter((u) => u?.id && userIds.includes(u.id))
      // full_name carries the name the member chose in LIUMA (User.display_name)
      // when there is one: the directory shows names, and signup's full_name is
      // often just the email handle.
      .map((u) => ({
        id: String(u.id),
        full_name: String(u.display_name || u.data?.display_name || u.full_name || '').trim().slice(0, 200),
        email: String(u.email || ''),
      }));

    return Response.json({ ok: true, users });
  } catch (e) {
    // Base44's rate limit is a 429, not a 500 (v1.8.3): this is a read, so
    // the client retries it with backoff (src/lib/functionRetry.js).
    if (isRateLimitError(e)) {
      console.warn('listSchoolMembers rate limited');
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
