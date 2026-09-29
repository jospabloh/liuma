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

// BORRADOR PENDIENTE DE REVISIÓN LEGAL (2026-09-29).
//
// The notice this version pins is a draft written by Claude from the app's
// real data model, published in-app so the consent checkbox finally points at
// a page that exists (before this, PRIVACY_NOTICE_URL was a 404). It has NOT
// been reviewed by a lawyer. When the reviewed text replaces it:
//   1. edit src/lib/legal/legalDocs.js,
//   2. bump PRIVACY_NOTICE_VERSION to the review date,
//   3. set PRIVACY_NOTICE_STATUS to 'vigente' — that removes the BORRADOR
//      banner on the page (the "-borrador" suffix in the version string is
//      what onboarding shows next to the checkbox, so drop it too).
// Every consent row pins the version string, so a consent given against the
// draft stays distinguishable from one given against the reviewed text.
export const PRIVACY_NOTICE_VERSION = '2026-09-29-borrador';

/** 'borrador' until a lawyer signs off; then 'vigente'. */
export const PRIVACY_NOTICE_STATUS = 'borrador';

// Public in-app route (src/App.jsx renders it before any auth or profile gate,
// because the people who must read it — someone mid-onboarding, a parent
// deciding whether to sign up — have no profile yet). Relative on purpose: it
// works on the base44.app host and on any custom domain the app is served from.
export const PRIVACY_NOTICE_PATH = '/aviso-de-privacidad';
export const PRIVACY_NOTICE_URL = PRIVACY_NOTICE_PATH;

// Terms of service / trial terms — same draft status, same public-route rule.
export const SERVICE_TERMS_VERSION = '2026-09-29-borrador';
export const SERVICE_TERMS_PATH = '/terminos';

/** True while the published legal text is still an unreviewed draft. */
export function legalTextIsDraft(status = PRIVACY_NOTICE_STATUS) {
  return status !== 'vigente';
}

export const CONSENT_SCOPES = {
  GENERAL: 'general_privacy_notice', // acceptance of the Aviso de Privacidad
  SENSITIVE_MINOR: 'sensitive_minor_data', // express consent for minors' sensitive data
};

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
 * Build the stored consent artifact. Kept pure so it's unit-testable; the
 * onboarding flow persists the result (best-effort) to a ConsentRecord entity
 * and to the AuditLog.
 */
export function buildConsentRecordPayload({
  user,
  schoolId,
  role,
  acceptances = {},
  noticeVersion = PRIVACY_NOTICE_VERSION,
  at = new Date(),
  userAgent = null,
} = {}) {
  const acceptedAt = (at instanceof Date ? at : new Date(at)).toISOString();
  return {
    user_id: user?.id || null,
    school_id: schoolId || null,
    app_role: role || null,
    notice_version: noticeVersion,
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
