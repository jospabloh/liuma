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

// BORRADOR PENDIENTE DE REVISIÓN LEGAL (2026-09-29). El texto del aviso y de
// los términos (src/lib/legal/*.js) lo redactó Claude a partir de la LFPDPPP y
// no lo ha revisado un abogado. Se publica dentro de la app marcado como
// borrador — visible en la página y aquí — porque lo contrario era peor: el
// consentimiento apuntaba a una URL que no existía. Cuando el texto final
// llegue: reemplaza el contenido, pon PRIVACY_NOTICE_IS_DRAFT en false y SUBE
// las versiones (cada ConsentRecord fija la versión que el usuario aceptó).
//
// MIRROR: base44/functions/provisionOnboardingProfile/entry.ts rechaza un
// consentimiento con otra versión (un cliente en caché con el aviso viejo), y
// tests/unit/legal-consent.test.js falla si las dos copias se separan.
export const PRIVACY_NOTICE_VERSION = '2026-09-29-borrador';
export const TERMS_VERSION = '2026-09-29-borrador';
export const PRIVACY_NOTICE_IS_DRAFT = true;

// In-app routes (registered in src/App.jsx, reachable with or without a
// session — a notice you can only read after accepting it is no notice).
export const PRIVACY_NOTICE_URL = '/aviso-de-privacidad';
export const TERMS_URL = '/terminos';

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
