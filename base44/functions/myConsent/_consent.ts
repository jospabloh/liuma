// Pure rules for myConsent — no Deno globals, no SDK, no imports, so the
// function (./entry.ts) and `node --test` (tests/unit/consent-gate.test.js)
// run the very same code against an in-memory database.
//
// WHY THIS EXISTS (owner decision, 2026-10-02). Accepting the Aviso de
// Privacidad and the Términos is mandatory to use LIUMA, and the people who
// signed up before v1.9.0 accepted the 2026-09-29 DRAFT — or nothing at all:
// six of the ten production profiles had no ConsentRecord when this was
// written (read 2026-10-02). They cannot be grandfathered: the texts they saw
// were not the ones in force. So:
//
//   status → does the caller's CURRENT profile carry the current consent?
//            If the stamp is missing but a ConsentRecord for the current
//            versions exists (e.g. a profile created between deploys), the
//            stamp is repaired from that evidence, never invented.
//   accept → both acceptances, for the versions the server publishes, are
//            recorded as a NEW ConsentRecord (append-only evidence: one per
//            acceptance) and only then stamped on the profile. No record, no
//            stamp.
//
// The stamp on UserProfile (consent_notice_version / consent_terms_version)
// is what schoolRead, guardedEntityWrite, guardedFamilyWrite, Lumi,
// listSchoolMembers, approveProfile and governRoleChange check — it costs
// them no extra read, the profile is already loaded. The ConsentRecord is the
// proof; the stamp is the fast path to it.
//
// Everything is derived from the authenticated caller. Nothing in the body
// names a user, a profile or a school.

// MIRRORS src/lib/consent/privacyNotice.js and every copy under
// base44/functions/; tests/unit/consent-gate.test.js checks them all.
export const CONSENT_NOTICE_VERSION = '2026-10-02';
export const CONSENT_TERMS_VERSION = '2026-10-02';

export const CONSENT_SCOPES = ['general_privacy_notice', 'sensitive_minor_data'];
const ROLES = ['ADMIN', 'TEACHER', 'PARENT'];

// deno-lint-ignore no-explicit-any
type Db = any;
type Caller = { id?: string; email?: string; role?: string; account_deleted_at?: unknown; data?: { account_deleted_at?: unknown } | null };
export type Profile = {
  id?: string;
  user_id?: string;
  school_id?: string;
  app_role?: string;
  status?: string;
  onboarding_completed?: boolean;
  consent_notice_version?: string;
  consent_terms_version?: string;
  consent_accepted_at?: string;
  created_date?: string;
};
export type ConsentRow = {
  id?: string;
  user_id?: string;
  school_id?: string;
  event?: string;
  notice_version?: string;
  terms_version?: string;
  accepted_general?: boolean;
  accepted_sensitive_minor_data?: boolean;
  accepted_at?: string;
  withdrawn_at?: string;
  created_date?: string;
};
export type Result = { status: number; body: Record<string, unknown> };

// MIRRORS schoolRead/_scope.ts#selectCurrentProfile (and
// src/lib/tenantSelection.js): the school whose consent counts is the one the
// screens and the server read from. Tested for equality.
export function selectCurrentProfile(profiles: Profile[] = []): Profile | null {
  const sorted = [...(profiles || [])].sort((a, b) =>
    String(b.created_date || '').localeCompare(String(a.created_date || '')));
  const eligible = sorted.filter((p) => p.status === 'ACTIVE' && p.onboarding_completed);
  return eligible[0] || sorted[0] || null;
}

export function profileConsentIsCurrent(profile: { consent_notice_version?: unknown; consent_terms_version?: unknown } | null): boolean {
  return Boolean(profile)
    && profile!.consent_notice_version === CONSENT_NOTICE_VERSION
    && profile!.consent_terms_version === CONSENT_TERMS_VERSION;
}

// MIRRORS src/lib/account/accountDeletion.js#accountDeletedAt.
export function accountDeletedAt(user: unknown): string {
  const u = (user ?? {}) as Caller;
  const v = u.account_deleted_at ?? u.data?.account_deleted_at;
  return typeof v === 'string' ? v : '';
}

function when(row: ConsentRow): string {
  return String(row.withdrawn_at || row.accepted_at || row.created_date || '');
}

/**
 * The newest acceptance of the CURRENT versions in this school, unless a
 * withdrawal came after it. Rows are the caller's own ConsentRecords.
 */
export function currentAcceptance(rows: ConsentRow[], schoolId: string): ConsentRow | null {
  const mine = (rows || []).filter((r) => String(r.school_id || '') === schoolId)
    .sort((a, b) => when(b).localeCompare(when(a)));
  const latest = mine[0];
  if (!latest || latest.event === 'WITHDRAWN') return null;
  const ok = latest.notice_version === CONSENT_NOTICE_VERSION
    && latest.terms_version === CONSENT_TERMS_VERSION
    && latest.accepted_general === true
    && latest.accepted_sensitive_minor_data === true;
  return ok ? latest : null;
}

async function loadCaller(sr: Db, user: Caller): Promise<Profile | null> {
  const rows: Profile[] = await sr.entities.UserProfile.filter({ user_id: user.id }, '-created_date', 50);
  return selectCurrentProfile((rows || []).filter((p) => String(p.user_id || '') === String(user.id)));
}

function stampFor(acceptedAt: string) {
  return {
    consent_notice_version: CONSENT_NOTICE_VERSION,
    consent_terms_version: CONSENT_TERMS_VERSION,
    consent_accepted_at: acceptedAt,
  };
}

function statusBody(profile: Profile | null, required: boolean, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    required,
    hasProfile: Boolean(profile),
    role: profile?.app_role || null,
    noticeVersion: CONSENT_NOTICE_VERSION,
    termsVersion: CONSENT_TERMS_VERSION,
    acceptedVersion: profile?.consent_notice_version || null,
    ...extra,
  };
}

/** { action: 'status' } */
export async function consentStatus(sr: Db, user: Caller): Promise<Result> {
  if (!user?.id) return { status: 401, body: { ok: false, code: 'UNAUTHENTICATED', error: 'Unauthorized' } };
  if (accountDeletedAt(user)) {
    return { status: 200, body: { ok: true, required: false, accountDeleted: true, hasProfile: false } };
  }
  const profile = await loadCaller(sr, user);
  // No profile: onboarding records the consent itself (provisionOnboardingProfile).
  if (!profile) return { status: 200, body: statusBody(null, false) };
  if (profileConsentIsCurrent(profile)) return { status: 200, body: statusBody(profile, false) };

  const schoolId = String(profile.school_id || '');
  const rows: ConsentRow[] = schoolId
    ? await sr.entities.ConsentRecord.filter({ user_id: user.id, school_id: schoolId }, '-created_date', 50)
    : [];
  const accepted = currentAcceptance(rows || [], schoolId);
  if (accepted && profile.id) {
    // Evidence exists, the stamp does not: repair it (idempotent).
    await sr.entities.UserProfile.update(profile.id, stampFor(String(accepted.accepted_at || new Date().toISOString())));
    return { status: 200, body: statusBody({ ...profile, ...stampFor('') }, false, { repaired: true }) };
  }
  return { status: 200, body: statusBody(profile, true) };
}

/** { action: 'accept', general, sensitive, noticeVersion, termsVersion } */
export async function acceptConsent(
  sr: Db,
  user: Caller,
  body: Record<string, unknown>,
  now: Date,
  userAgent: string,
): Promise<Result> {
  if (!user?.id) return { status: 401, body: { ok: false, code: 'UNAUTHENTICATED', error: 'Unauthorized' } };
  if (accountDeletedAt(user)) return { status: 410, body: { ok: false, code: 'ACCOUNT_DELETED', error: 'This account was deleted' } };
  if (body?.general !== true || body?.sensitive !== true) {
    return { status: 400, body: { ok: false, code: 'CONSENT_REQUIRED', error: 'Both acceptances are required' } };
  }
  // A browser running a cached bundle showed other texts than the ones in
  // force: make it reload rather than record a version it never displayed.
  if (body?.noticeVersion !== CONSENT_NOTICE_VERSION || body?.termsVersion !== CONSENT_TERMS_VERSION) {
    return { status: 409, body: { ok: false, code: 'CONSENT_VERSION_MISMATCH', error: 'Privacy notice version changed; reload' } };
  }
  const profile = await loadCaller(sr, user);
  if (!profile?.id || !profile.school_id) {
    return { status: 409, body: { ok: false, code: 'NO_PROFILE', error: 'Finish onboarding first' } };
  }
  if (profileConsentIsCurrent(profile)) return { status: 200, body: statusBody(profile, false, { already: true }) };

  const role = ROLES.includes(String(profile.app_role)) ? String(profile.app_role) : undefined;
  const acceptedAt = now.toISOString();
  // Evidence first: if this write fails nothing is stamped and the gate stays.
  const record = await sr.entities.ConsentRecord.create({
    user_id: user.id,
    school_id: profile.school_id,
    app_role: role,
    event: 'ACCEPTED',
    notice_version: CONSENT_NOTICE_VERSION,
    terms_version: CONSENT_TERMS_VERSION,
    accepted_general: true,
    accepted_sensitive_minor_data: true,
    accepted_scopes: CONSENT_SCOPES,
    accepted_at: acceptedAt,
    user_agent: String(userAgent || '').slice(0, 500),
    source: 'reacceptance',
  });
  await sr.entities.UserProfile.update(profile.id, stampFor(acceptedAt));

  // Best-effort trail next to the other sensitive actions; the ConsentRecord
  // above is the evidence that matters.
  try {
    await sr.entities.AuditLog.create({
      school_id: profile.school_id,
      user_id: user.id,
      user_email: user.email || '',
      action: 'PRIVACY_CONSENT_ACCEPTED',
      target_type: 'ConsentRecord',
      target_id: String(record?.id || ''),
      details: { notice_version: CONSENT_NOTICE_VERSION, terms_version: CONSENT_TERMS_VERSION, source: 'reacceptance' },
    });
  } catch {
    // never fails the acceptance
  }
  return { status: 200, body: statusBody({ ...profile, ...stampFor(acceptedAt) }, false, { recordId: record?.id || null }) };
}
