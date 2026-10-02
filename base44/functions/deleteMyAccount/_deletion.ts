// Pure rules for deleteMyAccount — no Deno globals, no SDK, no imports, so the
// function (./entry.ts) and `node --test` (tests/unit/account-deletion.test.js)
// run the very same code against an in-memory database.
//
// WHAT THE LEGAL TEXT PROMISES (src/lib/legal/legalDocs.js, Aviso § 10 and
// the retention table, Términos § 6) and where each promise is kept:
//
//   "tu acceso se cierra de inmediato"     → every UserProfile of the caller
//       is deleted (schoolRead and the write paths answer NO_PROFILE from
//       then on), their parent links and classroom assignments are revoked,
//       their app sessions are marked revoked, the User is marked
//       account_deleted_at and then removed from the app.
//   "tu cuenta, tu perfil, tus datos de contacto … se suprimen"
//       → UserProfile (phone, photo), ParentProfile (address, occupation,
//       work phone), the person's notice inbox (NoticeDelivery/NoticeRead),
//       their permission exceptions, their open role-change requests, their
//       e-mail address wherever a server wrote it as a delivery key, and the
//       User itself.
//   "solicitudes que la escuela aún no atendía … se cancelan"
//       → PENDING AbsenceNotification and PENDING UniformOrder rows.
//   "los registros escolares … se quedan con la escuela sin tu nombre"
//       → the name a write stamped (parent_name, teacher_name, author_name,
//       recorded_by_name, uploaded_by_name, requester_name) becomes
//       ANONYMIZED_NAME. Charges and payments are never touched (fiscal and
//       patrimonial records of the school; PaymentRecord carries only an id).
//   "La constancia de tu consentimiento y de su retiro se conserva"
//       → ConsentRecords are never deleted; a WITHDRAWN record is appended
//       per school before anything is deleted (no evidence, no deletion),
//       and AuditLog keeps the withdrawal and the deletion (730 days,
//       retention table).
//
// ORDER, AND WHY (Codex review of PR #197, twice). Every server gate
// authorizes from the consent STAMP on UserProfile, and myConsent writes that
// stamp concurrently (repair, re-acceptance). Ordering alone cannot win that
// race, so there is a two-way handshake on a marker:
//   0. User.account_deletion_started_at is written FIRST, before anything
//      destructive. If it fails, nothing changed (503 DELETION_NOT_STARTED).
//   a. clear the stamps; b. append WITHDRAWN; c. clear the stamps again.
//   myConsent: refuses to stamp when the marker (or account_deleted_at) is
//   set, and after every stamp write RE-READS the marker and clears its own
//   stamp if it is set. A stamp written before step 0 is cleared by (a); one
//   written after step 0 is cleared by myConsent itself. Every
//   consent-gated function also refuses a caller whose User carries the
//   marker (auth.me() returns User custom fields; no extra read), and the
//   app shows the deletion page, so a half-done deletion is finished by
//   re-confirming, never undone by re-accepting.
//   …
//   8. mark the User account_deleted_at BEFORE deleting the profiles: if the
//      mark fails nothing irreversible about the account has happened and the
//      call fails (ACCOUNT_NOT_MARKED); profiles are never gone while the User
//      could still onboard again.
// So on every partial failure: a WITHDRAWN record ⇒ no stamp, and no profile
// ⇒ a marked (or removed) User. Every step is idempotent and a retry runs
// them all again.
//
// What code cannot do, and the function says so instead of pretending:
//   - Lumi conversations: neither the SDK nor Base44's platform API offers a
//     way to delete an agent conversation (checked 2026-10-02: agents has
//     list/get/create/addMessage only; agent-configs is read-only). The text
//     says ACACIA asks Base44 for it; this function e-mails ACACIA the user
//     id to do so (best-effort) and records it in the AuditLog.
//   - Base44 may keep what `delete` removes in its trash; the permanent purge
//     inside the PURGE_DAYS window is ACACIA's step (same e-mail).
//   - Removing the User goes through `entities.User.delete` (Base44's "Remove
//     app user": immediate loss of access; the app owner cannot be removed).
//     Whether the platform accepts it from a function's service role is not
//     documented. If it refuses, the User keeps account_deleted_at (written
//     BEFORE the profiles are deleted, and required: without it the call
//     fails with ACCOUNT_NOT_MARKED), which the app, myConsent and
//     provisionOnboardingProfile treat as deleted, and ACACIA removes it from
//     the panel.
//
// WHO: everything derives from the authenticated caller — no body field
// names a user, profile or school. The only body field is the typed
// confirmation word, checked here as well as in the page.
//
// WHO NOT: the platform owner (they run the platform; Base44 cannot remove the
// app owner), and the only ACTIVE ADMIN of a school (the school would be left
// with no one able to approve members or answer for it) — they get
// SOLE_ADMIN and the page offers "Solicitar eliminación de la escuela"
// (module 7) instead.

export const CONFIRMATION_WORD = 'ELIMINAR';
export const ANONYMIZED_NAME = 'Cuenta eliminada';
export const SUPPORT_EMAIL = 'soporte@acaciaco.com.mx';
export const PURGE_DAYS = 30; // MIRRORS src/lib/legal/legalDocs.js#PURGE_DAYS

const OPEN_CHANGE_STATUSES = ['PENDING_ADMIN_APPROVAL', 'PENDING_SECOND_ADMIN_APPROVAL'];
const ESCALATION_TIERS = ['SCHOOL_ADMIN', 'PLATFORM'];

// [entity, the field holding the author's user id, the name it stamped].
export const ANONYMIZE: Array<[string, string, string]> = [
  ['AbsenceNotification', 'parent_id', 'parent_name'],
  ['UniformOrder', 'parent_id', 'parent_name'],
  ['EventResponse', 'parent_id', 'parent_name'],
  ['Attendance', 'recorded_by', 'recorded_by_name'],
  ['DiaryEntry', 'teacher_id', 'teacher_name'],
  ['Homework', 'teacher_id', 'teacher_name'],
  ['Notice', 'author_id', 'author_name'],
  ['OfficialDocument', 'uploaded_by', 'uploaded_by_name'],
  ['SupportTicket', 'requester_user_id', 'requester_name'],
];

// deno-lint-ignore no-explicit-any
type Db = any;
type Caller = {
  id?: string;
  email?: string;
  role?: string;
  account_deleted_at?: unknown;
  data?: { account_deleted_at?: unknown } | null;
};
type Profile = { id?: string; user_id?: string; school_id?: string; app_role?: string; status?: string; created_date?: string };
type ConsentRow = {
  id?: string;
  school_id?: string;
  app_role?: string;
  event?: string;
  notice_version?: string;
  terms_version?: string;
  accepted_at?: string;
  withdrawn_at?: string;
  created_date?: string;
};
export type Result = { status: number; body: Record<string, unknown> };

// A rate limit is the one failure worth surfacing even from a best-effort
// write: the request is about to fail anyway, and the retry converges.
function isRateLimit(e: unknown): boolean {
  const err = e as { status?: unknown; message?: unknown } | null;
  return err?.status === 429 || /rate limit/i.test(String(err?.message ?? ''));
}

function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Result {
  return { status, body: { ok: false, code, error: message, ...extra } };
}

// MIRRORS src/lib/account/accountDeletion.js#accountDeletedAt.
export function accountDeletedAt(user: unknown): string {
  const u = (user ?? {}) as Caller;
  const v = u.account_deleted_at ?? u.data?.account_deleted_at;
  return typeof v === 'string' ? v : '';
}

// MIRRORS src/lib/account/accountDeletion.js#accountDeletionStartedAt and
// myConsent/_consent.ts#accountDeletionStartedAt.
export function deletionStartedAt(user: unknown): string {
  const u = (user ?? {}) as { account_deletion_started_at?: unknown; data?: { account_deletion_started_at?: unknown } | null };
  const v = u.account_deletion_started_at ?? u.data?.account_deletion_started_at;
  return typeof v === 'string' ? v : '';
}

/** The confirmation must be the word itself (case and surrounding blanks forgiven). */
export function confirmationMatches(input: unknown): boolean {
  return typeof input === 'string' && input.trim().toUpperCase() === CONFIRMATION_WORD;
}

/** Every spelling of the caller's address a server may have written. */
export function emailVariants(email: unknown): string[] {
  const raw = typeof email === 'string' ? email.trim() : '';
  return raw ? [...new Set([raw, raw.toLowerCase()])] : [];
}

/**
 * Schools where the caller is the only ACTIVE ADMIN. `adminsBySchool` maps a
 * school id to its ACTIVE ADMIN profiles (the caller's included).
 */
export function soleAdminSchoolIds(myProfiles: Profile[], adminsBySchool: Record<string, Profile[]>, userId: string): string[] {
  const out: string[] = [];
  for (const p of myProfiles || []) {
    if (p.app_role !== 'ADMIN' || p.status !== 'ACTIVE' || !p.school_id) continue;
    const others = (adminsBySchool[p.school_id] || []).filter((a) => String(a.user_id || '') !== userId);
    if (!others.length && !out.includes(p.school_id)) out.push(p.school_id);
  }
  return out;
}

async function myProfiles(sr: Db, userId: string): Promise<Profile[]> {
  const rows: Profile[] = await sr.entities.UserProfile.filter({ user_id: userId }, '-created_date', 50);
  return (rows || []).filter((p) => String(p.user_id || '') === userId);
}

async function soleAdminSchools(sr: Db, profiles: Profile[], userId: string): Promise<Array<{ id: string; name: string }>> {
  const adminsBySchool: Record<string, Profile[]> = {};
  for (const p of profiles) {
    if (p.app_role !== 'ADMIN' || p.status !== 'ACTIVE' || !p.school_id || adminsBySchool[p.school_id]) continue;
    adminsBySchool[p.school_id] = await sr.entities.UserProfile.filter({ school_id: p.school_id, app_role: 'ADMIN', status: 'ACTIVE' }) || [];
  }
  const ids = soleAdminSchoolIds(profiles, adminsBySchool, userId);
  const out: Array<{ id: string; name: string }> = [];
  for (const id of ids) {
    const school: { name?: string } | null = await sr.entities.School.get(id).catch(() => null);
    out.push({ id, name: String(school?.name || '') });
  }
  return out;
}

function isNotFound(e: unknown): boolean {
  const err = e as { status?: unknown; message?: unknown } | null;
  return err?.status === 404 || /not found/i.test(String(err?.message ?? ''));
}

// MIRRORS nothing on the client: only this function reads it.
export function deletionReservedAt(user: unknown): string {
  const u = (user ?? {}) as { account_deletion_reserved_at?: unknown; data?: { account_deletion_reserved_at?: unknown } | null };
  const v = u.account_deletion_reserved_at ?? u.data?.account_deletion_reserved_at;
  return typeof v === 'string' ? v : '';
}

/**
 * Did this deletion already pass the director check (or finish)? Only a
 * durable RESERVATION skips it on a retry — not the started marker (Codex
 * review of PR #197, round 4: two directors starting at once both had the
 * marker, so both retries skipped the check and the school lost both). The
 * token's copy first; the stored User otherwise.
 */
async function deletionReserved(sr: Db, user: Caller): Promise<boolean> {
  if (deletionReservedAt(user) || accountDeletedAt(user)) return true;
  try {
    const row = await sr.entities.User.get(String(user.id));
    return Boolean(deletionReservedAt(row) || accountDeletedAt(row));
  } catch (e) {
    if (isNotFound(e)) return false;
    throw e;
  }
}

// --- The director seat (claim pattern, like resolvePaymentRace) ------------
//
// The pre-check (soleAdminSchools) is a read: two directors of a two-director
// school confirming at once both pass it. So a director's deletion CLAIMS its
// leave first — an AuditLog row per school, whose created_date the SERVER
// assigns, so claims are ordered by when they were written, not by each
// caller's clock — and only then re-reads the school's ACTIVE directors and
// live claims. Rule: I may leave iff some ACTIVE director remains after
// removing every claimer whose claim is at or before mine (same instant
// counts as before: on an exact tie both refuse, never both leave).
//
// Why it holds: if A's claim was written before B's, B's re-read (after B's
// own claim) sees A's claim, so B removes A and itself; A only removes
// itself. With two directors, B refuses and A goes — whatever the order of
// the reads. A loser deletes its claim and clears its marker; a claim left
// behind by a failed clean-up only makes later deletions MORE careful.

export const DELETION_CLAIM_TARGET = 'AccountDeletionClaim';
const SEAT_READ_LIMIT = 500;

type ClaimRow = { id?: string; user_id?: string; created_date?: string };

function claimTime(row: ClaimRow): string {
  return String(row.created_date || '');
}

/** May `userId` leave `schoolId`? Pure: admins and claims as read after my claim. */
export function seatDecision(admins: Profile[], claims: ClaimRow[], myClaim: ClaimRow, userId: string): boolean {
  const adminIds = new Set(admins.map((a) => String(a.user_id || '')).filter(Boolean));
  const mine = claimTime(myClaim);
  const leavingFirst = new Set<string>([userId]);
  for (const c of claims) {
    const id = String(c.user_id || '');
    if (!adminIds.has(id)) continue; // no longer a director: irrelevant
    if (claimTime(c) <= mine) leavingFirst.add(id);
  }
  return [...adminIds].some((id) => !leavingFirst.has(id));
}

async function tryTwice(fn: () => Promise<unknown>): Promise<boolean> {
  for (let i = 0; i < 2; i += 1) {
    try { await fn(); return true; } catch { /* retried */ }
  }
  return false;
}

/**
 * Claim the seat in every school where the caller is an ACTIVE director.
 * Returns null when they may leave, or the refusal (after giving the claims
 * and the started marker back).
 */
async function reserveDirectorSeats(sr: Db, userId: string, profiles: Profile[]): Promise<Result | null> {
  const schools = [...new Set(profiles
    .filter((p) => p.app_role === 'ADMIN' && p.status === 'ACTIVE' && p.school_id)
    .map((p) => String(p.school_id)))];
  const myClaims: string[] = [];
  const lost: Array<{ id: string; name: string }> = [];
  let unreadable = false;
  for (const schoolId of schools) {
    let claim: ClaimRow;
    try {
      claim = await sr.entities.AuditLog.create({
        school_id: schoolId, user_id: userId, action: 'RECORD_CREATED',
        target_type: DELETION_CLAIM_TARGET, target_id: schoolId, details: { purpose: 'director_leaving' },
      });
    } catch (e) {
      if (isRateLimit(e)) throw e;
      unreadable = true;
      break;
    }
    if (claim?.id) myClaims.push(String(claim.id));
    const admins: Profile[] = (await sr.entities.UserProfile.filter({ school_id: schoolId, app_role: 'ADMIN', status: 'ACTIVE' }, 'created_date', SEAT_READ_LIMIT)) || [];
    const adminIds = admins.map((a) => String(a.user_id || '')).filter(Boolean);
    const claims: ClaimRow[] = adminIds.length
      ? (await sr.entities.AuditLog.filter({ target_type: DELETION_CLAIM_TARGET, target_id: schoolId, user_id: { $in: adminIds } }, 'created_date', SEAT_READ_LIMIT)) || []
      : [];
    // A page that may hide rows cannot prove a director remains: refuse.
    if (admins.length >= SEAT_READ_LIMIT || claims.length >= SEAT_READ_LIMIT) { unreadable = true; break; }
    const seen = claims.some((c) => String(c.id) === String(claim.id)) ? claims : [...claims, claim];
    if (!seatDecision(admins, seen, claim, userId)) {
      const school: { name?: string } | null = await sr.entities.School.get(schoolId).catch(() => null);
      lost.push({ id: schoolId, name: String(school?.name || '') });
    }
  }
  if (!lost.length && !unreadable) return null;

  // Give everything back: claims first (so others stop counting me), then
  // the marker (so I can use the app again). Retried; a marker that cannot
  // be cleared leaves the person blocked, and the answer says so.
  for (const id of myClaims) await tryTwice(() => sr.entities.AuditLog.delete(id));
  const unblocked = await tryTwice(() => sr.entities.User.update(userId, { account_deletion_started_at: '' }));
  if (unreadable && !lost.length) {
    return fail(503, 'DELETION_NOT_STARTED', 'The directors of your school could not be checked; nothing was changed, retry', { blocked: !unblocked });
  }
  return fail(409, 'SOLE_ADMIN', 'You are the only active director of your school', { soleAdminSchools: lost, blocked: !unblocked });
}

/** { action: 'preview' } — what the page needs to choose its path. */
export async function previewDeletion(sr: Db, user: Caller): Promise<Result> {
  if (!user?.id) return fail(401, 'UNAUTHENTICATED', 'Unauthorized');
  const userId = String(user.id);
  if (user.role === 'admin') {
    return { status: 200, body: { ok: true, platformOwner: true, soleAdmin: false, soleAdminSchools: [], hasProfile: false, role: null, resume: false } };
  }
  const profiles = await myProfiles(sr, userId);
  const resume = await deletionReserved(sr, user);
  const sole = resume ? [] : await soleAdminSchools(sr, profiles, userId);
  return {
    status: 200,
    body: {
      ok: true,
      platformOwner: false,
      hasProfile: profiles.length > 0,
      role: profiles[0]?.app_role || null,
      soleAdmin: sole.length > 0,
      soleAdminSchools: sole,
      // The page then always offers "finish the deletion".
      resume,
    },
  };
}

/** updateMany batches per call before giving up (×500 rows per batch). */
export const MAX_UPDATE_BATCHES = 40;

/**
 * A bulk step that stopped with rows left (Codex review of PR #197: the
 * loop used to stop at its bound with has_more still true and report
 * success). Thrown BEFORE the account is marked deleted or removed, so the
 * page offers a retry, and the retry continues where this one stopped —
 * every query here excludes the rows it already changed.
 */
export class DeletionIncompleteError extends Error {
  status = 503;
  code = 'DELETION_INCOMPLETE';
  constructor(entity: string) {
    super(`updateMany on ${entity} still had rows left after ${MAX_UPDATE_BATCHES} batches`);
  }
}

async function updateAll(sr: Db, entity: string, query: Record<string, unknown>, data: Record<string, unknown>): Promise<number> {
  let total = 0;
  // updateMany works in batches of up to 500 and says has_more; loop until
  // it says there are none, and FAIL — never report done — at the bound.
  for (let i = 0; i < MAX_UPDATE_BATCHES; i += 1) {
    const res: { updated?: number; has_more?: boolean } | null = await sr.entities[entity].updateMany(query, data);
    total += Number(res?.updated || 0);
    if (!res?.has_more) return total;
  }
  throw new DeletionIncompleteError(entity);
}

// Clearing the stamp sends the person to the consent screen and makes every
// server gate (profileConsentIsCurrent) refuse them.
async function revokeConsentStamps(sr: Db, userId: string): Promise<number> {
  return await updateAll(sr, 'UserProfile', { user_id: userId, consent_notice_version: { $ne: '' } }, { $set: { consent_notice_version: '', consent_terms_version: '' } });
}

async function deleteAll(sr: Db, entity: string, query: Record<string, unknown>): Promise<number> {
  const res: { deleted?: number } | null = await sr.entities[entity].deleteMany(query);
  return Number(res?.deleted || 0);
}

function latestBySchool(rows: ConsentRow[]): Record<string, ConsentRow> {
  const out: Record<string, ConsentRow> = {};
  const when = (r: ConsentRow) => String(r.withdrawn_at || r.accepted_at || r.created_date || '');
  for (const r of rows || []) {
    const id = String(r.school_id || '');
    if (!id) continue;
    if (!out[id] || when(r).localeCompare(when(out[id])) > 0) out[id] = r;
  }
  return out;
}

export type DeletionReport = {
  schools: string[];
  withdrawals: number;
  revokedLinks: number;
  closedAssignments: number;
  canceledRequests: number;
  anonymized: number;
  emailsRemoved: number;
  deletedAccountData: number;
  revokedSessions: number;
  deletedProfiles: number;
  userMarked: boolean;
  userRemoved: boolean;
};

/** { action: 'delete', confirm: 'ELIMINAR' } */
export async function runAccountDeletion({ sr, user, body, now, userAgent = '' }: {
  sr: Db;
  user: Caller;
  body: Record<string, unknown>;
  now: Date;
  userAgent?: string;
}): Promise<Result> {
  if (!user?.id) return fail(401, 'UNAUTHENTICATED', 'Unauthorized');
  const userId = String(user.id);
  if (user.role === 'admin') {
    return fail(403, 'PLATFORM_OWNER', 'The platform owner account cannot delete itself from the app');
  }
  if (!confirmationMatches(body?.confirm)) {
    return fail(400, 'CONFIRMATION_REQUIRED', `Type ${CONFIRMATION_WORD} to confirm`);
  }

  const profiles = await myProfiles(sr, userId);
  // A deletion that already RESERVED its director seat is finished, not
  // re-judged: refusing now (another director left meanwhile) would strand
  // the person, whose access is already closed.
  const reserved = await deletionReserved(sr, user);
  // The cheap read-only pre-check: a lone director is refused with nothing
  // written. It is not the decision — reserveDirectorSeats below is.
  const sole = reserved ? [] : await soleAdminSchools(sr, profiles, userId);
  if (sole.length) {
    return fail(409, 'SOLE_ADMIN', 'You are the only active director of your school', { soleAdminSchools: sole });
  }

  const nowIso = now.toISOString();
  const emails = emailVariants(user.email);
  const profileIds = profiles.map((p) => String(p.id || '')).filter(Boolean);

  // 0. The deletion-in-progress marker, BEFORE any other write. From here
  //    on myConsent refuses to stamp consent (and compensates a stamp it
  //    wrote concurrently: it re-reads this marker after every stamp write),
  //    every consent-gated function refuses the caller, and the app shows the
  //    deletion page to finish — never the consent screen. If this write
  //    fails nothing has changed and the call says so; a retry starts over.
  //    A retry keeps the first start date.
  const startedAt = deletionStartedAt(user) || nowIso;
  try {
    await sr.entities.User.update(userId, { account_deletion_started_at: startedAt });
  } catch (e) {
    if (isRateLimit(e)) throw e;
    return fail(503, 'DELETION_NOT_STARTED', 'The deletion could not be started; nothing was changed, retry');
  }

  // 0b. A director claims their seat and re-checks that another director
  //     stays (reserveDirectorSeats); then the RESERVATION is written, and
  //     only it lets a retry skip the check. Nothing destructive before it.
  if (!reserved) {
    const refused = await reserveDirectorSeats(sr, userId, profiles);
    if (refused) return refused;
    try {
      await sr.entities.User.update(userId, { account_deletion_reserved_at: nowIso });
    } catch (e) {
      // Without the durable reservation a retry would re-judge a seat others
      // already counted as gone: give it back and start over.
      await sr.entities.AuditLog.deleteMany({ target_type: DELETION_CLAIM_TARGET, user_id: userId }).catch(() => null);
      await sr.entities.User.update(userId, { account_deletion_started_at: '' }).catch(() => null);
      if (isRateLimit(e)) throw e;
      return fail(503, 'DELETION_NOT_STARTED', 'The deletion could not be started; nothing was changed, retry');
    }
  }

  // 1a. Cut access: the stamps are what the server gates read.
  await revokeConsentStamps(sr, userId);

  // 1b. Evidence before any deletion: a WITHDRAWN ConsentRecord per school the
  //    person had a profile or a consent in. A retry does not stack a second one.
  const consentRows: ConsentRow[] = await sr.entities.ConsentRecord.filter({ user_id: userId }, '-created_date', 200) || [];
  const latest = latestBySchool(consentRows);
  const schools = [...new Set([
    ...profiles.map((p) => String(p.school_id || '')),
    ...Object.keys(latest),
  ].filter(Boolean))];
  const withdrawnNow: string[] = [];
  for (const schoolId of schools) {
    const last = latest[schoolId];
    if (last?.event === 'WITHDRAWN') continue;
    const profile = profiles.find((p) => p.school_id === schoolId);
    await sr.entities.ConsentRecord.create({
      user_id: userId,
      school_id: schoolId,
      app_role: profile?.app_role || last?.app_role || undefined,
      event: 'WITHDRAWN',
      notice_version: last?.notice_version || 'sin-registro',
      terms_version: last?.terms_version || 'sin-registro',
      accepted_general: false,
      accepted_sensitive_minor_data: false,
      accepted_scopes: [],
      withdrawn_at: nowIso,
      user_agent: String(userAgent || '').slice(0, 500),
      source: 'account_deletion',
    });
    withdrawnNow.push(schoolId);
  }
  const withdrawals = withdrawnNow.length;
  // 1c. Again. Not what keeps the stamp away — the marker of step 0 is: a
  //    myConsent stamp written before it is cleared by 1a, one written after
  //    it is cleared by myConsent's own re-read — but cheap, idempotent, and
  //    run on every retry.
  await revokeConsentStamps(sr, userId);
  // The trail next to the other sensitive actions. Best-effort: the
  // ConsentRecord above is the evidence, and a log failure must not leave the
  // deletion half-started for a reason the person cannot fix. Only for the
  // withdrawals written now, so a retry does not log it twice.
  for (const schoolId of withdrawnNow) {
    try {
      await sr.entities.AuditLog.create({
        school_id: schoolId,
        user_id: userId,
        user_email: user.email || '',
        action: 'PRIVACY_CONSENT_WITHDRAWN',
        target_type: 'User',
        target_id: userId,
        details: { source: 'account_deletion' },
      });
    } catch (e) {
      if (isRateLimit(e)) throw e;
    }
  }

  // 2. What grants access to children's and classrooms' data.
  const revokedLinks = await updateAll(sr, 'ParentStudent', { parent_id: userId, status: { $ne: 'REVOKED' } }, { $set: { status: 'REVOKED' } });
  const closedAssignments = await updateAll(sr, 'TeacherClassroom', { teacher_id: userId, is_active: true }, { $set: { is_active: false } });

  // 3. Requests the school had not attended yet.
  let canceledRequests = 0;
  canceledRequests += await deleteAll(sr, 'AbsenceNotification', { parent_id: userId, status: 'PENDING' });
  canceledRequests += await deleteAll(sr, 'UniformOrder', { parent_id: userId, status: 'PENDING' });
  canceledRequests += await deleteAll(sr, 'PendingChange', { requester_user_id: userId, status: { $in: OPEN_CHANGE_STATUSES } });
  if (profileIds.length) {
    canceledRequests += await deleteAll(sr, 'PendingChange', { target_profile_id: { $in: profileIds }, status: { $in: OPEN_CHANGE_STATUSES } });
  }

  // 4. Records that stay with the school, without the person's name.
  let anonymized = 0;
  for (const [entity, idField, nameField] of ANONYMIZE) {
    anonymized += await updateAll(sr, entity, { [idField]: userId, [nameField]: { $ne: ANONYMIZED_NAME } }, { $set: { [nameField]: ANONYMIZED_NAME } });
  }

  // 5. The address wherever a server wrote it as a delivery key.
  let emailsRemoved = 0;
  if (emails.length) {
    emailsRemoved += await updateAll(sr, 'DiaryEntry', { notified_parent_emails: { $in: emails } }, { $pull: { notified_parent_emails: { $in: emails } } });
    emailsRemoved += await updateAll(sr, 'UserProfile', { pending_notification_recipients: { $in: emails } }, { $pull: { pending_notification_recipients: { $in: emails } } });
    const keys = ESCALATION_TIERS.flatMap((tier) => emails.map((e) => `${tier}:${e}`));
    emailsRemoved += await updateAll(sr, 'SupportTicket', { escalation_notified_recipients: { $in: keys } }, { $pull: { escalation_notified_recipients: { $in: keys } } });
  }

  // 6. The person's own account data.
  let deletedAccountData = 0;
  deletedAccountData += await deleteAll(sr, 'NoticeDelivery', { recipient_user_id: userId });
  deletedAccountData += await deleteAll(sr, 'NoticeRead', { user_id: userId });
  deletedAccountData += await deleteAll(sr, 'ParentProfile', { user_id: userId });
  if (profileIds.length) {
    deletedAccountData += await deleteAll(sr, 'PermissionOverride', { user_profile_id: { $in: profileIds } });
  }

  // 7. Sessions: kept for the audit window (retention table), but closed.
  const revokedSessions = emails.length
    ? await updateAll(sr, 'AppSession', { user_email: { $in: emails }, revoked_by: { $ne: 'account_deleted' } }, { $set: { revoked_at: nowIso, revoked_by: 'account_deleted' } })
    : 0;

  // 8. The durable mark BEFORE the profiles go: provisionOnboardingProfile and
  //    myConsent refuse a marked User. If the mark fails, the profiles stay
  //    (already without consent, links or assignments: no access) and the
  //    call fails, so a retry finishes it. Never "profiles gone, User free to
  //    onboard again, and the page saying it worked".
  //    A retry keeps the first deletion date.
  const markedAt = accountDeletedAt(user) || nowIso;
  try {
    await sr.entities.User.update(userId, { account_deleted_at: markedAt, display_name: '' });
  } catch (e) {
    if (isRateLimit(e)) throw e;
    return fail(503, 'ACCOUNT_NOT_MARKED', 'The account could not be marked as deleted, so its profiles were kept; retry to finish');
  }
  const userMarked = true;

  // 9. The commit point: without a profile nothing in LIUMA answers.
  const deletedProfiles = await deleteAll(sr, 'UserProfile', { user_id: userId });

  // 10. Remove the User. Best-effort now: the mark above already makes the
  //     account deleted for LIUMA; ACACIA removes it from the panel if not.
  let userRemoved = false;
  try {
    await sr.entities.User.delete(userId);
    userRemoved = true;
  } catch {
    userRemoved = false;
  }

  const report: DeletionReport = {
    schools,
    withdrawals,
    revokedLinks,
    closedAssignments,
    canceledRequests,
    anonymized,
    emailsRemoved,
    deletedAccountData,
    revokedSessions,
    deletedProfiles,
    userMarked,
    userRemoved,
  };

  // 11. The trail, and ACACIA's manual steps (best-effort: the deletion above
  //     already happened and must not be reported as failed).
  const manualSteps = [
    `Pedir a Base44 la supresión de las conversaciones con Lumi del usuario ${userId}.`,
    `Purgar de la papelera de Base44 lo borrado para este usuario dentro de ${PURGE_DAYS} días.`,
    ...(userRemoved ? [] : [`Quitar al usuario ${userId} de la app en el panel de Base44 (la función no pudo).`]),
  ];
  for (const schoolId of schools) {
    try {
      await sr.entities.AuditLog.create({
        school_id: schoolId,
        user_id: userId,
        user_email: user.email || '',
        action: 'ACCOUNT_DELETED',
        target_type: 'User',
        target_id: userId,
        details: { ...report, manual_steps: manualSteps },
      });
    } catch {
      // the deletion stands; the e-mail below still reaches ACACIA
    }
  }
  try {
    await sr.integrations?.Core?.SendEmail?.({
      to: SUPPORT_EMAIL,
      subject: 'LIUMA · Cuenta eliminada — pasos manuales',
      body: [
        `Una persona eliminó su cuenta de LIUMA el ${nowIso}.`,
        `Usuario: ${userId}. Escuelas: ${schools.join(', ') || 'ninguna'}.`,
        `Usuario quitado de la app: ${userRemoved ? 'sí' : 'NO'}.`,
        '',
        'Pendiente para ACACIA:',
        ...manualSteps.map((s) => `- ${s}`),
      ].join('\n'),
      from_name: 'LIUMA',
    });
  } catch {
    // best-effort
  }

  return { status: 200, body: { ok: true, ...report } };
}
