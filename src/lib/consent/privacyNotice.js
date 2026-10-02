/**
 * Privacy-notice consent capture (México / LFPDPPP).
 *
 * LIUMA processes minors' sensitive personal data (blood type, allergies,
 * medical notes, behavioral diary). Under the LFPDPPP that requires **express**
 * consent, captured and stored. This module defines the notice version, the
 * consent scopes, and a builder for the stored consent artifact.
 *
 * Update PRIVACY_NOTICE_VERSION (and the hosted notice) whenever the Aviso de
 * Privacidad changes, so each consent record pins the version the user accepted.
 */

// VIGENTE desde el 2 de octubre de 2026 (owner decision; research and sources
// in docs/legal-research-2026-10.md). The texts these versions pin live in
// src/lib/legal/legalDocs.js — the ONE source of both. When either text
// changes, bump BOTH versions here and in the server mirror below; every
// ConsentRecord pins the version string, so a consent given to one text stays
// distinguishable from one given to the next. Consents recorded before this
// date pin the 2026-09-29 version string (the unreviewed draft).
//
// MIRROR: base44/functions/provisionOnboardingProfile/entry.ts and
// myConsent/_consent.ts reject a consent for any other version (a cached
// client with the old notice); schoolRead/_scope.ts (x3),
// guardedEntityWrite/_policy.ts, guardedFamilyWrite/_policy.ts,
// listSchoolMembers, approveProfile and governRoleChange refuse a profile
// whose stamp is not this version. tests/unit/legal-final.test.js and
// tests/unit/consent-gate.test.js fail if any copy drifts. Bumping a version
// sends EVERY user back to the consent screen on their next request.
export const PRIVACY_NOTICE_VERSION = '2026-10-02';

/** The published legal texts are final ('vigente'). */
export const PRIVACY_NOTICE_STATUS = 'vigente';

// Public in-app routes (src/App.jsx renders them before any auth or profile
// gate, because the people who must read them — someone mid-onboarding, a
// parent deciding whether to sign up — have no profile yet). Relative on
// purpose: they work on the base44.app host and on any custom domain.
export const PRIVACY_NOTICE_PATH = '/aviso-de-privacidad';
export const PRIVACY_NOTICE_URL = PRIVACY_NOTICE_PATH;

// Terms of service / trial terms — same version and the same public-route rule.
export const SERVICE_TERMS_VERSION = '2026-10-02';
export const SERVICE_TERMS_PATH = '/terminos';
// Aliases used by onboarding (P6).
export const TERMS_VERSION = SERVICE_TERMS_VERSION;
export const TERMS_URL = SERVICE_TERMS_PATH;

export const CONSENT_SCOPES = {
  GENERAL: 'general_privacy_notice', // acceptance of the Aviso de Privacidad
  SENSITIVE_MINOR: 'sensitive_minor_data', // express consent for minors' sensitive data
};

/**
 * Has this UserProfile accepted the texts in force? The stamp
 * (consent_notice_version / consent_terms_version) is written only by the
 * server — provisionOnboardingProfile and myConsent, right after the
 * ConsentRecord that proves it. Mirrors profileConsentIsCurrent in
 * base44/functions/schoolRead/_scope.ts, which makes every data function
 * answer CONSENT_REQUIRED without it: the consent screen
 * (src/components/consent/ConsentGate.jsx) is the UI half of that rule.
 */
export function profileConsentIsCurrent(profile) {
  return Boolean(profile)
    && profile.consent_notice_version === PRIVACY_NOTICE_VERSION
    && profile.consent_terms_version === SERVICE_TERMS_VERSION;
}

/** Both acceptances are required to finish onboarding. */
export function consentIsComplete(acceptances = {}) {
  return Boolean(acceptances.general) && Boolean(acceptances.sensitive);
}

/** Role-specific wording for the express sensitive-data consent line. */
export function sensitiveConsentLabel(role) {
  if (role === 'PARENT') {
    return 'Doy mi consentimiento expreso para que la escuela y LIUMA traten los datos personales sensibles de mi(s) hijo(s) — por ejemplo tipo de sangre, alergias y notas médicas — con la finalidad de su cuidado y la operación escolar.';
  }
  return 'Me comprometo a tratar los datos personales sensibles de los alumnos — por ejemplo tipo de sangre, alergias y notas médicas — únicamente para su cuidado y la operación escolar, conforme al Aviso de Privacidad.';
}

/**
 * Shape of the stored consent artifact (ConsentRecord.jsonc). The record is
 * written SERVER-side by provisionOnboardingProfile, which builds the same
 * fields from its own clock and the authenticated user — this pure copy is the
 * documented shape and what the tests pin.
 */
export function buildConsentRecordPayload({
  user,
  schoolId,
  role,
  acceptances = {},
  noticeVersion = PRIVACY_NOTICE_VERSION,
  termsVersion = TERMS_VERSION,
  at = new Date(),
  userAgent = null,
} = {}) {
  const acceptedAt = (at instanceof Date ? at : new Date(at)).toISOString();
  return {
    user_id: user?.id || null,
    school_id: schoolId || null,
    app_role: role || null,
    notice_version: noticeVersion,
    terms_version: termsVersion,
    accepted_general: Boolean(acceptances.general),
    accepted_sensitive_minor_data: Boolean(acceptances.sensitive),
    accepted_scopes: [
      acceptances.general ? CONSENT_SCOPES.GENERAL : null,
      acceptances.sensitive ? CONSENT_SCOPES.SENSITIVE_MINOR : null,
    ].filter(Boolean),
    accepted_at: acceptedAt,
    user_agent: userAgent,
  };
}
