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

export const PRIVACY_NOTICE_VERSION = '2026-06-18';

// Where the full Aviso de Privacidad is published. Replace with the live URL.
export const PRIVACY_NOTICE_URL = 'https://liuma-2232ffd8.base44.app/aviso-de-privacidad';

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
