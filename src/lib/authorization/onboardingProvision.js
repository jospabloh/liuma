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
export function buildOnboardingUpsert({ user, schoolId, phone, appRole, status, existingProfile }) {
  if (existingProfile) {
    return {
      action: 'update',
      id: existingProfile.id,
      payload: { phone: phone || '', onboarding_completed: true },
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
  // Codes handed out before join_code existed were the raw School id.
  if (isLegacySchoolId(rawCode)) {
    return sr.entities.School.get(String(rawCode).trim()).catch(() => null);
  }
  return null;
}

/**
 * The provisioning algorithm. `sr` = service-role entities client
 * ({ entities: { School, SchoolSubscription, UserProfile, ConsentRecord } }).
 * Returns the response body; throws ProvisionError (status + code) on refusal.
 */
export async function runOnboardingProvision({ user, body, sr, now = new Date(), userAgent = '', randomBytes }) {
  if (!user?.id) throw new ProvisionError(401, 'UNAUTHENTICATED', 'Unauthorized');
  const role = String(body?.role || '');
  if (!APP_ROLES.includes(role)) throw new ProvisionError(400, 'INVALID_ROLE', 'Invalid onboarding role');
  const phone = sanitizePhone(body?.phone);

  const consentCheck = validateOnboardingConsent(body?.consent);
  if (!consentCheck.ok) {
    throw new ProvisionError(consentCheck.code === 'CONSENT_REQUIRED' ? 400 : 409, consentCheck.code, 'Consent missing or stale');
  }

  const myProfiles = await sr.entities.UserProfile.filter({ user_id: user.id });

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
    if (!subs?.length) await sr.entities.SchoolSubscription.create(buildTrialSubscription(school.id, now));
  }

  // Must land before the profile (the commit point): no record, no onboarding.
  await sr.entities.ConsentRecord.create(buildServerConsentRecord({ user, schoolId: school.id, role, now, userAgent }));

  const existing = myProfiles.find((p) => p.school_id === school.id) || null;
  const upsert = buildOnboardingUpsert({
    user, schoolId: school.id, phone, appRole: decision.appRole, status: decision.status, existingProfile: existing,
  });
  let profileId;
  let status = decision.status;
  if (upsert.action === 'update') {
    await sr.entities.UserProfile.update(upsert.id, upsert.payload);
    profileId = upsert.id;
    status = existing.status || decision.status;
  } else {
    const created = await sr.entities.UserProfile.create(upsert.payload);
    profileId = created?.id || null;
  }

  return { ok: true, profileId, status, schoolId: school.id, schoolName: school.name || '' };
}

export { ProvisionError };
