// Onboarding provisioning — the whole server algorithm, as pure(ish) JS.
//
// SECURITY NOTE: the AUTHORITATIVE copy runs server-side in
// base44/functions/provisionOnboardingProfile/entry.ts (service role). Deno
// functions cannot import from src/, so that file carries a hand-kept copy of
// `runOnboardingProvision` below; tests exercise THIS copy against fake
// entities and assert the server copy still contains the load-bearing lines
// (tests/unit/onboarding-server-provision.test.js). Change both together.
//
// WHY IT IS ONE SERVER PATH (audit F03/F26, 2026-09-29). Onboarding used to run
// in the browser: School.create, SchoolSubscription.create, a lookup of the
// school code with School.filter, bootstrap rows in Role/PermissionTemplate/
// AccessBinding and a best-effort ConsentRecord. Every one of those failed in
// production — School and SchoolSubscription are platform-only under RLS, the
// three bootstrap entities do not exist, ConsentRecord did not exist either,
// and the founder check read `created_by_user_id`, which the School schema
// silently dropped. No school could sign up and nobody could join one.
//
// The rules this enforces:
//   - ADMIN may only be the FOUNDER of a school this call (or a previous,
//     interrupted call) created, stamped with the authenticated user's id —
//     never a value from the request. No other active admin may exist.
//   - Everyone else joins with a school code resolved HERE (short join_code,
//     or the legacy 24-hex id) and lands PENDING until an admin approves.
//   - One account, one school (module 18 retired): a user who already has a
//     profile in another school cannot onboard into a second one.
//   - Consent (Aviso de Privacidad + express consent for minors' sensitive
//     data) must be complete, for the CURRENT notice version, and the
//     ConsentRecord must be persisted — or onboarding fails.
//   - The trial SchoolSubscription is created with the SERVER clock
//     (standard module 1: never trust the client's clock for commercial state).
//
// "Atomic" without transactions: the UserProfile is written LAST and is the
// commit point — Home.jsx shows onboarding until a profile exists. Everything
// before it (school, subscription, consent) is idempotent on retry: the
// founder's school is found again by created_by_user_id instead of being
// duplicated, and an existing subscription is reused.

import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  generateJoinCode,
  isLegacySchoolId,
  isValidJoinCode,
  normalizeJoinCode,
} from '../onboarding/joinCode.js';
import { PRIVACY_NOTICE_VERSION, TERMS_VERSION, CONSENT_SCOPES } from '../consent/privacyNotice.js';
import { buildTrialSubscription } from '../license/licenseModel.js';
import { accountDeletedAt, accountDeletionStartedAt } from '../account/accountDeletion.js';

export const APP_ROLES = ['ADMIN', 'TEACHER', 'PARENT'];
export { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH };

const HEX = /^#[0-9a-f]{6}$/i;
const PALETTE_KEYS = ['primary', 'secondary', 'accent', 'neutral'];
const MAX_SCHOOL_NAME = 120;

function fail(code, message) {
  return { ok: false, code, message, appRole: null, status: null };
}

// Decide the app_role + status for the caller's own onboarding profile.
// `schoolAdmins` = UserProfile rows in the school with app_role ADMIN.
export function resolveOnboardingProvision({ user, school, role, schoolAdmins = [] }) {
  if (!user?.id) return fail('UNAUTHENTICATED', 'No authenticated user.');
  if (!APP_ROLES.includes(role)) return fail('INVALID_ROLE', 'Rol de onboarding inválido.');
  if (!school) return fail('SCHOOL_NOT_FOUND', 'No se encontró la escuela.');

  if (role === 'ADMIN') {
    const isFounder = Boolean(school.created_by_user_id) && school.created_by_user_id === user.id;
    const otherActiveAdminExists = schoolAdmins.some(
      (p) => p.status === 'ACTIVE' && p.user_id !== user.id,
    );
    if (!isFounder || otherActiveAdminExists) {
      return fail(
        'ADMIN_NOT_ALLOWED',
        'Solo el fundador de una escuela nueva puede asignarse ADMIN en el registro. Para una escuela existente, solicita el cambio de rol a un administrador.',
      );
    }
    return { ok: true, code: null, message: null, appRole: 'ADMIN', status: 'ACTIVE' };
  }

  // TEACHER / PARENT join an existing school and wait for admin approval.
  return { ok: true, code: null, message: null, appRole: role, status: 'PENDING' };
}

// Build the create/update payload for an onboarding upsert. On an EXISTING
// profile we never rewrite app_role/status (those are governance-controlled once
// the profile exists); we only refresh onboarding-owned fields.
/** The consent stamp a profile carries once its ConsentRecord is written —
 * what schoolRead and the write paths check (profileConsentIsCurrent). */
export function buildConsentStamp(now = new Date()) {
  return {
    consent_notice_version: PRIVACY_NOTICE_VERSION,
    consent_terms_version: TERMS_VERSION,
    consent_accepted_at: (now instanceof Date ? now : new Date(now)).toISOString(),
  };
}

export function buildOnboardingUpsert({ user, schoolId, phone, appRole, status, existingProfile, now = new Date() }) {
  if (existingProfile) {
    return {
      action: 'update',
      id: existingProfile.id,
      payload: { phone: phone || '', onboarding_completed: true, ...buildConsentStamp(now) },
    };
  }
  return {
    action: 'create',
    id: null,
    payload: {
      user_id: user.id,
      school_id: schoolId,
      app_role: appRole,
      status,
      phone: phone || '',
      onboarding_completed: true,
      ...buildConsentStamp(now),
    },
  };
}

/** Both acceptances, and the version the server is currently publishing. */
export function validateOnboardingConsent(consent, expectedVersion = PRIVACY_NOTICE_VERSION) {
  if (!consent || consent.general !== true || consent.sensitive !== true) {
    return { ok: false, code: 'CONSENT_REQUIRED' };
  }
  if (consent.noticeVersion !== expectedVersion) {
    // A browser running a cached bundle showed an older notice than the one
    // being recorded — make it reload rather than record the wrong version.
    return { ok: false, code: 'CONSENT_VERSION_MISMATCH' };
  }
  return { ok: true, code: null };
}

export function sanitizeThemeSettings(input) {
  const palette = {};
  for (const key of PALETTE_KEYS) {
    const value = input?.palette?.[key];
    if (typeof value !== 'string' || !HEX.test(value)) return null;
    palette[key] = value.toLowerCase();
  }
  return { palette, source: input?.source === 'logo' ? 'logo' : 'custom' };
}

export function sanitizeLogoUrl(input) {
  const value = typeof input === 'string' ? input.trim() : '';
  return /^https:\/\/\S{1,2000}$/.test(value) ? value : null;
}

export function sanitizePhone(input) {
  return typeof input === 'string' ? input.trim().slice(0, 30) : '';
}

export function sanitizeSchoolName(input) {
  return String(input || '').replace(/\s+/g, ' ').trim().slice(0, MAX_SCHOOL_NAME);
}

export function buildServerConsentRecord({ user, schoolId, role, now, userAgent }) {
  return {
    user_id: user.id,
    school_id: schoolId,
    app_role: role,
    notice_version: PRIVACY_NOTICE_VERSION,
    terms_version: TERMS_VERSION,
    accepted_general: true,
    accepted_sensitive_minor_data: true,
    accepted_scopes: [CONSENT_SCOPES.GENERAL, CONSENT_SCOPES.SENSITIVE_MINOR],
    accepted_at: now.toISOString(),
    user_agent: String(userAgent || '').slice(0, 500),
    source: 'onboarding',
  };
}

class ProvisionError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function uniqueJoinCode(sr, randomBytes) {
  for (let i = 0; i < 6; i += 1) {
    const code = generateJoinCode(randomBytes);
    const clash = await sr.entities.School.filter({ join_code: code });
    if (!clash?.length) return code;
  }
  throw new ProvisionError(500, 'JOIN_CODE_EXHAUSTED', 'Could not allocate a unique join code');
}

/** School a joiner's code points at, resolved with the service role. */
export async function resolveSchoolByCode(sr, rawCode) {
  const code = normalizeJoinCode(rawCode);
  if (isValidJoinCode(code)) {
    const rows = await sr.entities.School.filter({ join_code: code });
    if (rows?.[0]) return rows[0];
  }
  // Codes handed out before join_code existed were the raw School id. The
  // onboarding input upper-cases whatever is typed (join codes are upper
  // case), and Base44 ids are lower-case hex — so lower-case it back, or the
  // legacy fallback never matches anything typed into the form.
  if (isLegacySchoolId(rawCode)) {
    return sr.entities.School.get(String(rawCode).trim().toLowerCase()).catch(() => null);
  }
  return null;
}

// --- Racing a deletion (Codex review of PR #197, round 7) -------------------
//
// The deletion markers are checked on the auth.me() snapshot at the top, but
// deleteMyAccount can set its marker — and finish its clean-up — while this
// call is still writing. Same compensation as myConsent: re-read the STORED
// User right before the commit point (the profile write) and right after it;
// if a marker is set (or the User is gone), undo what THIS call wrote and
// refuse. A marker written before our post-commit read is seen by it; one
// written after it comes after our profile exists, and the deletion removes
// that profile itself (it re-reads profiles after its own marker).
//
// The ConsentRecord this call wrote is NOT deleted: consent history is legal
// evidence the deletion path itself never deletes (Aviso de Privacidad,
// retention table: "la constancia de tu consentimiento y de su retiro se
// conserva"). A WITHDRAWN record is appended after it instead, so the newest
// record for that school is the withdrawal and nothing repairs a stamp from
// the acceptance. MIRRORED in provisionOnboardingProfile/entry.ts.

function provisionNotFound(e) {
  return e?.status === 404 || /not found/i.test(String(e?.message ?? ''));
}

/** 'none' | 'marked' (a marker is set, or the User is gone) | 'unknown'. */
export async function storedDeletionState(sr, userId) {
  let row;
  try {
    row = await sr.entities.User.get(String(userId));
  } catch (e) {
    return provisionNotFound(e) ? 'marked' : 'unknown';
  }
  return accountDeletedAt(row) || accountDeletionStartedAt(row) ? 'marked' : 'none';
}

/** What a profile that could not be deleted is reduced to: no access, no personal data. */
export const PROFILE_NEUTRALIZED = Object.freeze({
  status: 'SUSPENDED',
  phone: '',
  photo_url: '',
  pending_notification_recipients: [],
  consent_notice_version: '',
  consent_terms_version: '',
  consent_accepted_at: '',
});

async function provisionTryTwice(fn) {
  for (let i = 0; i < 2; i += 1) {
    try { await fn(); return true; } catch { /* retried once */ }
  }
  return false;
}

/** Undo exactly what this call wrote. Logs (with ids) whatever it could not. */
export async function compensateOnboarding(sr, { userId, schoolId, role, written, now }) {
  const failed = [];
  // Layered (Codex review of PR #197, round 8): a profile that cannot be
  // deleted is at least SUSPENDED and emptied — it grants nothing and holds
  // nothing personal — and whatever is still unresolved is persisted for the
  // owner (ONBOARDING_COMPENSATION_UNRESOLVED), not only logged.
  const neutralize = (id) => provisionTryTwice(() => sr.entities.UserProfile.update(id, PROFILE_NEUTRALIZED));
  if (written.createdProfileId) {
    const id = written.createdProfileId;
    if (!await provisionTryTwice(() => sr.entities.UserProfile.delete(id)) && !await neutralize(id)) failed.push(`UserProfile ${id}`);
  }
  if (written.stampedProfileId) {
    const id = written.stampedProfileId;
    const clear = { consent_notice_version: '', consent_terms_version: '' };
    if (!await provisionTryTwice(() => sr.entities.UserProfile.update(id, clear)) && !await neutralize(id)) failed.push(`UserProfile stamp ${id}`);
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
  // A school (and its trial) this call founded, only while nobody else is in it.
  if (written.createdSchoolId) {
    let others = null;
    try {
      others = await sr.entities.UserProfile.filter({ school_id: written.createdSchoolId });
    } catch {
      others = null;
    }
    if (others && others.length === 0) {
      if (written.createdSubId && !await provisionTryTwice(() => sr.entities.SchoolSubscription.delete(written.createdSubId))) failed.push(`SchoolSubscription ${written.createdSubId}`);
      if (!await provisionTryTwice(() => sr.entities.School.delete(written.createdSchoolId))) failed.push(`School ${written.createdSchoolId}`);
    } else if (!others) {
      failed.push(`School ${written.createdSchoolId} (members unreadable)`);
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

async function refuseIfDeleting(sr, { user, schoolId, role, written, now }) {
  const state = await storedDeletionState(sr, user.id);
  if (state === 'none') return;
  await compensateOnboarding(sr, { userId: user.id, schoolId, role, written, now });
  if (state === 'marked') throw new ProvisionError(403, 'ACCOUNT_DELETION_IN_PROGRESS', 'This account is being deleted');
  throw new ProvisionError(503, 'ONBOARDING_NOT_CONFIRMED', 'Could not confirm the account; retry');
}

/**
 * The provisioning algorithm. `sr` = service-role entities client
 * ({ entities: { School, SchoolSubscription, UserProfile, ConsentRecord } }).
 * Returns the response body; throws ProvisionError (status + code) on refusal.
 */
export async function runOnboardingProvision({ user, body, sr, now = new Date(), userAgent = '', randomBytes }) {
  if (!user?.id) throw new ProvisionError(401, 'UNAUTHENTICATED', 'Unauthorized');
  if (accountDeletedAt(user)) throw new ProvisionError(410, 'ACCOUNT_DELETED', 'This account was deleted');
  // Onboarding writes consent: refused while a deletion is under way, like
  // myConsent (MIRRORS provisionOnboardingProfile/entry.ts).
  if (accountDeletionStartedAt(user)) throw new ProvisionError(403, 'ACCOUNT_DELETION_IN_PROGRESS', 'This account is being deleted');
  const role = String(body?.role || '');
  if (!APP_ROLES.includes(role)) throw new ProvisionError(400, 'INVALID_ROLE', 'Invalid onboarding role');
  const phone = sanitizePhone(body?.phone);

  const consentCheck = validateOnboardingConsent(body?.consent);
  if (!consentCheck.ok) {
    throw new ProvisionError(consentCheck.code === 'CONSENT_REQUIRED' ? 400 : 409, consentCheck.code, 'Consent missing or stale');
  }

  const myProfiles = await sr.entities.UserProfile.filter({ user_id: user.id });

  // What THIS call wrote, so a race with a deletion undoes exactly that.
  const written = { createdSchoolId: null, createdSubId: null, consentWritten: false, createdProfileId: null, stampedProfileId: null };
  let school;
  if (role === 'ADMIN') {
    const name = sanitizeSchoolName(body?.newSchool?.name);
    if (!name) throw new ProvisionError(400, 'MISSING_SCHOOL_NAME', 'School name required');

    // Retry of an interrupted signup: reuse the school this user founded.
    const founded = await sr.entities.School.filter({ created_by_user_id: user.id }, '-created_date', 1);
    school = founded?.[0] || null;
    if (!school) {
      if (myProfiles.length) throw new ProvisionError(409, 'ALREADY_ONBOARDED', 'User already belongs to a school');
      school = await sr.entities.School.create({
        name,
        created_by_user_id: user.id,
        join_code: await uniqueJoinCode(sr, randomBytes),
        theme_settings: sanitizeThemeSettings(body?.newSchool?.theme_settings) || undefined,
        logo_url: sanitizeLogoUrl(body?.newSchool?.logo_url) || undefined,
        is_demo: false,
      });
      written.createdSchoolId = school?.id || null;
    }
  } else {
    school = await resolveSchoolByCode(sr, body?.joinCode);
    if (!school) throw new ProvisionError(404, 'INVALID_SCHOOL_CODE', 'Invalid school code');
  }

  if (myProfiles.some((p) => p.school_id !== school.id)) {
    throw new ProvisionError(409, 'ALREADY_ONBOARDED', 'User already belongs to another school');
  }

  const schoolAdmins = await sr.entities.UserProfile.filter({ school_id: school.id, app_role: 'ADMIN' });
  const decision = resolveOnboardingProvision({ user, school, role, schoolAdmins });
  if (!decision.ok) {
    throw new ProvisionError(decision.code === 'ADMIN_NOT_ALLOWED' ? 403 : 400, decision.code, decision.message);
  }

  if (role === 'ADMIN') {
    const subs = await sr.entities.SchoolSubscription.filter({ school_id: school.id });
    if (!subs?.length) {
      const sub = await sr.entities.SchoolSubscription.create(buildTrialSubscription(school.id, now));
      written.createdSubId = sub?.id || null;
    }
  }

  // Must land before the profile (the commit point): no record, no onboarding.
  await sr.entities.ConsentRecord.create(buildServerConsentRecord({ user, schoolId: school.id, role, now, userAgent }));
  written.consentWritten = true;

  // Right before the commit point: a deletion that started meanwhile wins.
  await refuseIfDeleting(sr, { user, schoolId: school.id, role, written, now });

  const existing = myProfiles.find((p) => p.school_id === school.id) || null;
  const upsert = buildOnboardingUpsert({
    user, schoolId: school.id, phone, appRole: decision.appRole, status: decision.status, existingProfile: existing, now,
  });
  let profileId;
  let status = decision.status;
  if (upsert.action === 'update') {
    await sr.entities.UserProfile.update(upsert.id, upsert.payload);
    profileId = upsert.id;
    written.stampedProfileId = upsert.id;
    status = existing.status || decision.status;
  } else {
    const created = await sr.entities.UserProfile.create(upsert.payload);
    profileId = created?.id || null;
    written.createdProfileId = profileId;
  }

  // …and right after it: a marker set before this read is seen here; one set
  // after it finds our profile, which the deletion then removes itself.
  await refuseIfDeleting(sr, { user, schoolId: school.id, role, written, now });

  return { ok: true, profileId, status, schoolId: school.id, schoolName: school.name || '' };
}

export { ProvisionError };
