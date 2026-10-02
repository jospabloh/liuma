// provisionOnboardingProfile — the ONE onboarding path (service role).
//
// WHY THIS EXISTS (audit F03/F26, 2026-09-29)
// Onboarding used to run in the browser and could not succeed for anyone but
// the platform owner: School and SchoolSubscription are platform-only under
// RLS, the school code was looked up with a client School.filter that RLS
// always emptied, the founder check read a School field the schema dropped,
// and the bootstrap wrote to entities that do not exist. Now this function
// does all of it, for the authenticated caller only:
//
//   ADMIN   → creates (or, on a retry, re-finds) the school they found —
//             created_by_user_id and join_code are stamped HERE, never taken
//             from the request — plus its 30-day trial SchoolSubscription
//             (server clock), and provisions the founder as ACTIVE ADMIN.
//   TEACHER/PARENT → resolves the school code HERE (short join_code, or the
//             legacy 24-hex id) and provisions a PENDING profile that an
//             admin must approve.
//   Everyone → consent must be complete and for the CURRENT notice version,
//             and a ConsentRecord is written before the profile. If it
//             cannot be written, onboarding fails. The profile carries the
//             consent stamp (consent_notice_version/terms_version) that
//             schoolRead and the write paths check (v1.9.0).
//
// The UserProfile is written LAST: it is the commit point (Home.jsx shows
// onboarding until a profile exists). Every earlier step is idempotent on
// retry, which is what "atomic" can mean without transactions.
//
// MIRRORS src/lib/authorization/onboardingProvision.js#runOnboardingProvision
// (tested there against fake entities), src/lib/onboarding/joinCode.js
// (alphabet/length), src/lib/consent/privacyNotice.js (versions) and
// src/lib/license/licenseModel.js#buildTrialSubscription. Deno cannot import
// from src/; tests/unit/onboarding-server-provision.test.js fails if the
// constants here drift from those files. Change them together.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';

const APP_ROLES = ['ADMIN', 'TEACHER', 'PARENT'];
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 8;
const PRIVACY_NOTICE_VERSION = '2026-10-02';
const TERMS_VERSION = '2026-10-02';
const TRIAL_DURATION_DAYS = 30;
const START_STUDENT_LIMIT = 150;
const PALETTE_KEYS = ['primary', 'secondary', 'accent', 'neutral'];
const HEX = /^#[0-9a-f]{6}$/i;
const LEGACY_SCHOOL_ID = /^[a-f0-9]{24}$/i;

type Profile = { id: string; user_id?: string; school_id?: string; app_role?: string; status?: string };
type School = { id: string; name?: string; created_by_user_id?: string };

class ProvisionError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// MIRRORS src/lib/account/accountDeletion.js#accountDeletedAt.
function accountDeletedAt(user: unknown): string {
  const u = (user ?? {}) as { account_deleted_at?: unknown; data?: { account_deleted_at?: unknown } | null };
  const v = u.account_deleted_at ?? u.data?.account_deleted_at;
  return typeof v === 'string' ? v : '';
}

function bad(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, code, error: message }, { status });
}

function normalizeJoinCode(input: unknown): string {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isValidJoinCode(code: string): boolean {
  return code.length === JOIN_CODE_LENGTH && [...code].every((ch) => JOIN_CODE_ALPHABET.includes(ch));
}

function generateJoinCode(): string {
  const limit = 256 - (256 % JOIN_CODE_ALPHABET.length);
  let out = '';
  while (out.length < JOIN_CODE_LENGTH) {
    const bytes = new Uint8Array(JOIN_CODE_LENGTH * 2);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < limit) out += JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length];
      if (out.length === JOIN_CODE_LENGTH) break;
    }
  }
  return out;
}

// deno-lint-ignore no-explicit-any
async function uniqueJoinCode(sr: any): Promise<string> {
  for (let i = 0; i < 6; i += 1) {
    const code = generateJoinCode();
    const clash = await sr.entities.School.filter({ join_code: code });
    if (!clash?.length) return code;
  }
  throw new ProvisionError(500, 'JOIN_CODE_EXHAUSTED', 'Could not allocate a unique join code');
}

// deno-lint-ignore no-explicit-any
async function resolveSchoolByCode(sr: any, rawCode: unknown): Promise<School | null> {
  const code = normalizeJoinCode(rawCode);
  if (isValidJoinCode(code)) {
    const rows = await sr.entities.School.filter({ join_code: code });
    if (rows?.[0]) return rows[0];
  }
  // Codes handed out before join_code existed were the raw School id. The
  // form upper-cases the input and Base44 ids are lower-case hex.
  const legacy = String(rawCode || '').trim().toLowerCase();
  if (LEGACY_SCHOOL_ID.test(legacy)) {
    return await sr.entities.School.get(legacy).catch(() => null);
  }
  return null;
}

// deno-lint-ignore no-explicit-any
function sanitizeThemeSettings(input: any) {
  const palette: Record<string, string> = {};
  for (const key of PALETTE_KEYS) {
    const value = input?.palette?.[key];
    if (typeof value !== 'string' || !HEX.test(value)) return null;
    palette[key] = value.toLowerCase();
  }
  return { palette, source: input?.source === 'logo' ? 'logo' : 'custom' };
}

function sanitizeLogoUrl(input: unknown): string | null {
  const value = typeof input === 'string' ? input.trim() : '';
  return /^https:\/\/\S{1,2000}$/.test(value) ? value : null;
}

function buildTrialSubscription(schoolId: string, now: Date) {
  const trialEnd = new Date(now);
  trialEnd.setDate(trialEnd.getDate() + TRIAL_DURATION_DAYS);
  return {
    school_id: schoolId,
    subscription_status: 'trial',
    subscription_plan: 'trial',
    license_tier: 'start',
    licensed_student_limit: START_STUDENT_LIMIT,
    trial_start_date: now.toISOString(),
    trial_end_date: trialEnd.toISOString(),
    welcome_message_shown: false,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return bad(401, 'UNAUTHENTICATED', 'Unauthorized');
    // deleteMyAccount marks the User before trying to remove it; if the
    // removal did not go through, the account must not come back to life by
    // onboarding again. ACACIA removes the User within the purge window
    // (CLAUDE.md, "Consentimiento obligatorio y baja de cuenta").
    if (accountDeletedAt(user)) return bad(410, 'ACCOUNT_DELETED', 'This account was deleted');
    // …and one being deleted: onboarding writes a ConsentRecord, a consent
    // stamp and a profile — another consent writer (Codex review of PR #197).
    // A deletion of this account started or finished (deleteMyAccount): no
    // access here, whatever consent stamp a race may have left behind.
    // auth.me() returns the User's custom fields, so this costs no read.
    if (accountDeletionBlocked(user)) return Response.json({ ok: false, code: 'ACCOUNT_DELETION_IN_PROGRESS', error: 'ACCOUNT_DELETION_IN_PROGRESS' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const role = String(body?.role || '');
    if (!APP_ROLES.includes(role)) return bad(400, 'INVALID_ROLE', 'Invalid onboarding role');
    const phone = typeof body?.phone === 'string' ? body.phone.trim().slice(0, 30) : '';

    const consent = body?.consent;
    if (!consent || consent.general !== true || consent.sensitive !== true) {
      return bad(400, 'CONSENT_REQUIRED', 'Consent missing');
    }
    if (consent.noticeVersion !== PRIVACY_NOTICE_VERSION) {
      return bad(409, 'CONSENT_VERSION_MISMATCH', 'Privacy notice version changed; reload');
    }

    const sr = base44.asServiceRole;
    const now = new Date();
    const myProfiles: Profile[] = await sr.entities.UserProfile.filter({ user_id: user.id });

    // What THIS call wrote, so a race with a deletion undoes exactly that
    // (refuseIfDeleting, below; MIRRORS onboardingProvision.js).
    const written: Written = { createdSchoolId: null, createdSubId: null, consentWritten: false, createdProfileId: null, stampedProfileId: null };
    let school: School | null = null;
    if (role === 'ADMIN') {
      const name = String(body?.newSchool?.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      if (!name) return bad(400, 'MISSING_SCHOOL_NAME', 'School name required');

      // Retry of an interrupted signup: reuse the school this user founded.
      const founded: School[] = await sr.entities.School.filter({ created_by_user_id: user.id }, '-created_date', 1);
      school = founded?.[0] || null;
      if (!school) {
        if (myProfiles.length) return bad(409, 'ALREADY_ONBOARDED', 'User already belongs to a school');
        school = await sr.entities.School.create({
          name,
          created_by_user_id: user.id,
          join_code: await uniqueJoinCode(sr),
          theme_settings: sanitizeThemeSettings(body?.newSchool?.theme_settings) || undefined,
          logo_url: sanitizeLogoUrl(body?.newSchool?.logo_url) || undefined,
          is_demo: false,
        });
        written.createdSchoolId = school?.id || null;
      }
    } else {
      school = await resolveSchoolByCode(sr, body?.joinCode);
      if (!school) return bad(404, 'INVALID_SCHOOL_CODE', 'Invalid school code');
    }
    const schoolId = String(school!.id);

    // One account, one school (module 18 retired).
    if (myProfiles.some((p) => p.school_id !== schoolId)) {
      return bad(409, 'ALREADY_ONBOARDED', 'User already belongs to another school');
    }

    let appRole = role;
    let status = 'PENDING';
    if (role === 'ADMIN') {
      const schoolAdmins: Profile[] = await sr.entities.UserProfile.filter({ school_id: schoolId, app_role: 'ADMIN' });
      const isFounder = Boolean(school!.created_by_user_id) && school!.created_by_user_id === user.id;
      const otherActiveAdminExists = schoolAdmins.some((p) => p.status === 'ACTIVE' && p.user_id !== user.id);
      if (!isFounder || otherActiveAdminExists) {
        return bad(403, 'ADMIN_NOT_ALLOWED', 'Only the founder of a new school may self-assign ADMIN during onboarding');
      }
      appRole = 'ADMIN';
      status = 'ACTIVE';

      const subs = await sr.entities.SchoolSubscription.filter({ school_id: schoolId });
      if (!subs?.length) {
        const sub = await sr.entities.SchoolSubscription.create(buildTrialSubscription(schoolId, now));
        written.createdSubId = sub?.id || null;
      }
    }

    // Must land before the profile (the commit point): no record, no onboarding.
    await sr.entities.ConsentRecord.create({
      user_id: user.id,
      school_id: schoolId,
      app_role: role,
      notice_version: PRIVACY_NOTICE_VERSION,
      terms_version: TERMS_VERSION,
      accepted_general: true,
      accepted_sensitive_minor_data: true,
      accepted_scopes: ['general_privacy_notice', 'sensitive_minor_data'],
      accepted_at: now.toISOString(),
      user_agent: String(req.headers.get('user-agent') || '').slice(0, 500),
      source: 'onboarding',
    });
    written.consentWritten = true;

    // Right before the commit point: a deletion that started meanwhile wins.
    await refuseIfDeleting(sr, { userId: String(user.id), schoolId, role, written, now });

    // The consent stamp travels with the profile: schoolRead and the write
    // paths refuse a profile without the CURRENT one (CONSENT_REQUIRED), and
    // the ConsentRecord above is what proves it.
    const consentStamp = {
      consent_notice_version: PRIVACY_NOTICE_VERSION,
      consent_terms_version: TERMS_VERSION,
      consent_accepted_at: now.toISOString(),
    };

    // On an existing profile never rewrite app_role/status (governance-controlled).
    const existing = myProfiles.find((p) => p.school_id === schoolId) || null;
    let profileId: string | null = null;
    let resolvedStatus = status;
    if (existing) {
      await sr.entities.UserProfile.update(existing.id, { phone, onboarding_completed: true, ...consentStamp });
      profileId = existing.id;
      written.stampedProfileId = existing.id;
      resolvedStatus = existing.status || status;
    } else {
      const created = await sr.entities.UserProfile.create({
        user_id: user.id,
        school_id: schoolId,
        app_role: appRole,
        status,
        phone,
        onboarding_completed: true,
        ...consentStamp,
      });
      profileId = created?.id || null;
      written.createdProfileId = profileId;
    }

    // …and right after it: a marker set before this read is seen here; one
    // set after it finds our profile, which the deletion removes itself.
    await refuseIfDeleting(sr, { userId: String(user.id), schoolId, role, written, now });

    return Response.json({ ok: true, profileId, status: resolvedStatus, schoolId, schoolName: school!.name || '' });
  } catch (e) {
    if (e instanceof ProvisionError) return bad(e.status, e.code, e.message);
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

// --- Racing a deletion (Codex review of PR #197, round 7) -------------------
// MIRRORS src/lib/authorization/onboardingProvision.js#storedDeletionState /
// compensateOnboarding / refuseIfDeleting (tested there): the auth.me()
// snapshot checked at the top can be stale by the time this call writes.
// Re-read the STORED User right before the profile write and right after;
// on a marker (or a User already gone) undo what this call wrote and refuse.
// The ConsentRecord is kept (consent history is evidence the deletion path
// never deletes) and a WITHDRAWN record is appended after it.

type Written = {
  createdSchoolId: string | null;
  createdSubId: string | null;
  consentWritten: boolean;
  createdProfileId: string | null;
  stampedProfileId: string | null;
};

function provisionNotFound(e: unknown): boolean {
  const err = e as { status?: unknown; message?: unknown } | null;
  return err?.status === 404 || /not found/i.test(String(err?.message ?? ''));
}

// deno-lint-ignore no-explicit-any
async function storedDeletionState(sr: any, userId: string): Promise<'none' | 'marked' | 'unknown'> {
  let row: unknown;
  try {
    row = await sr.entities.User.get(userId);
  } catch (e) {
    return provisionNotFound(e) ? 'marked' : 'unknown';
  }
  return accountDeletionBlocked(row) ? 'marked' : 'none';
}

// MIRRORS onboardingProvision.js#PROFILE_NEUTRALIZED: no access, no personal data.
const PROFILE_NEUTRALIZED = {
  status: 'SUSPENDED',
  phone: '',
  photo_url: '',
  pending_notification_recipients: [],
  consent_notice_version: '',
  consent_terms_version: '',
  consent_accepted_at: '',
};

async function provisionTryTwice(fn: () => Promise<unknown>): Promise<boolean> {
  for (let i = 0; i < 2; i += 1) {
    try { await fn(); return true; } catch { /* retried once */ }
  }
  return false;
}

async function compensateOnboarding(
  // deno-lint-ignore no-explicit-any
  sr: any, { userId, schoolId, role, written, now }: { userId: string; schoolId: string; role: string; written: Written; now: Date },
): Promise<string[]> {
  const failed: string[] = [];
  // Layered: a profile that cannot be deleted is SUSPENDED and emptied; what
  // is still unresolved is persisted (ONBOARDING_COMPENSATION_UNRESOLVED).
  const neutralize = (id: string) => provisionTryTwice(() => sr.entities.UserProfile.update(id, PROFILE_NEUTRALIZED));
  if (written.createdProfileId) {
    const id = written.createdProfileId;
    if (!await provisionTryTwice(() => sr.entities.UserProfile.delete(id)) && !await neutralize(id)) failed.push(`UserProfile ${id}`);
  }
  if (written.stampedProfileId) {
    const id = written.stampedProfileId;
    if (!await provisionTryTwice(() => sr.entities.UserProfile.update(id, { consent_notice_version: '', consent_terms_version: '' })) && !await neutralize(id)) failed.push(`UserProfile stamp ${id}`);
  }
  if (written.consentWritten) {
    const withdrawnAt = new Date(Math.max(Date.now(), now.getTime() + 1)).toISOString();
    const ok = await provisionTryTwice(() => sr.entities.ConsentRecord.create({
      user_id: userId, school_id: schoolId, app_role: role, event: 'WITHDRAWN',
      notice_version: PRIVACY_NOTICE_VERSION, terms_version: TERMS_VERSION,
      accepted_general: false, accepted_sensitive_minor_data: false, accepted_scopes: [],
      withdrawn_at: withdrawnAt, source: 'onboarding_cancelled',
    }));
    if (!ok) failed.push(`ConsentRecord WITHDRAWN for ${schoolId}`);
  }
  if (written.createdSchoolId) {
    const schoolId2 = written.createdSchoolId;
    let others: unknown[] | null = null;
    try {
      others = await sr.entities.UserProfile.filter({ school_id: schoolId2 });
    } catch {
      others = null;
    }
    if (others && others.length === 0) {
      const subId = written.createdSubId;
      if (subId && !await provisionTryTwice(() => sr.entities.SchoolSubscription.delete(subId))) failed.push(`SchoolSubscription ${subId}`);
      if (!await provisionTryTwice(() => sr.entities.School.delete(schoolId2))) failed.push(`School ${schoolId2}`);
    } else if (!others) {
      failed.push(`School ${schoolId2} (members unreadable)`);
    }
  }
  if (failed.length) {
    console.error('provisionOnboardingProfile: compensation incomplete', userId, failed.join('; '));
    const recorded = await provisionTryTwice(() => sr.entities.AuditLog.create({
      school_id: schoolId || 'unknown',
      user_id: userId,
      action: 'ONBOARDING_COMPENSATION_UNRESOLVED',
      target_type: 'UserProfile',
      target_id: String(written.createdProfileId || written.stampedProfileId || ''),
      details: { unresolved: failed, school_created: written.createdSchoolId || null, subscription_created: written.createdSubId || null },
    }));
    if (!recorded) console.error('provisionOnboardingProfile: unresolved compensation not recorded', userId, failed.join('; '));
  }
  return failed;
}

async function refuseIfDeleting(
  // deno-lint-ignore no-explicit-any
  sr: any, args: { userId: string; schoolId: string; role: string; written: Written; now: Date },
): Promise<void> {
  const state = await storedDeletionState(sr, args.userId);
  if (state === 'none') return;
  await compensateOnboarding(sr, args);
  if (state === 'marked') throw new ProvisionError(403, 'ACCOUNT_DELETION_IN_PROGRESS', 'This account is being deleted');
  throw new ProvisionError(503, 'ONBOARDING_NOT_CONFIRMED', 'Could not confirm the account; retry');
}
