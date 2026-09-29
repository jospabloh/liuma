import { DEFAULT_THEME } from './tenantTheme.js';
import { isLegacySchoolId, isValidJoinCode } from './onboarding/joinCode.js';
import { invokeFunction } from './functionResponse.js';

export const ONBOARDING_ERROR_CODES = {
  VALIDATION: 'validation_error',
  INVALID_SCHOOL_CODE: 'invalid_school_code',
  DUPLICATE_TENANT: 'duplicate_tenant',
  FORBIDDEN: 'forbidden',
  CONSENT_REQUIRED: 'consent_required',
  CONSENT_STALE: 'consent_stale',
  ALREADY_ONBOARDED: 'already_onboarded',
  UNKNOWN: 'unknown_error',
};

export const ONBOARDING_ERROR_MESSAGES = {
  [ONBOARDING_ERROR_CODES.VALIDATION]: 'Faltan datos requeridos para completar el registro.',
  [ONBOARDING_ERROR_CODES.INVALID_SCHOOL_CODE]: 'Código de escuela inválido. Verifica con tu administrador.',
  [ONBOARDING_ERROR_CODES.DUPLICATE_TENANT]: 'Ya existe una escuela con esos datos. Revisa el nombre o contacta a soporte.',
  [ONBOARDING_ERROR_CODES.FORBIDDEN]: 'No tienes permisos para completar esta acción. Vuelve a iniciar sesión o contacta a soporte.',
  [ONBOARDING_ERROR_CODES.CONSENT_REQUIRED]: 'Para continuar, acepta el Aviso de Privacidad y el consentimiento de datos sensibles.',
  [ONBOARDING_ERROR_CODES.CONSENT_STALE]: 'El Aviso de Privacidad se actualizó. Recarga la página para leer la versión vigente y vuelve a aceptarlo.',
  [ONBOARDING_ERROR_CODES.ALREADY_ONBOARDED]: 'Tu cuenta ya pertenece a una escuela. Si necesitas cambiarte, escribe a soporte@acaciaco.com.mx.',
  [ONBOARDING_ERROR_CODES.UNKNOWN]: 'No pudimos completar tu registro. Intenta de nuevo o escribe a soporte@acaciaco.com.mx.',
};

// Which form field an error belongs to, so Onboarding.jsx can show it next
// to the input instead of in an alert() that names nothing.
export const ONBOARDING_ERROR_FIELDS = {
  [ONBOARDING_ERROR_CODES.INVALID_SCHOOL_CODE]: 'schoolCode',
  [ONBOARDING_ERROR_CODES.CONSENT_REQUIRED]: 'consent',
  [ONBOARDING_ERROR_CODES.CONSENT_STALE]: 'consent',
};

// Server codes from provisionOnboardingProfile → user-facing codes. Checked
// BEFORE the HTTP-status fallbacks: a 409 is not always "duplicate school".
const SERVER_CODE_MAP = {
  invalid_school_code: ONBOARDING_ERROR_CODES.INVALID_SCHOOL_CODE,
  school_not_found: ONBOARDING_ERROR_CODES.INVALID_SCHOOL_CODE,
  consent_required: ONBOARDING_ERROR_CODES.CONSENT_REQUIRED,
  consent_version_mismatch: ONBOARDING_ERROR_CODES.CONSENT_STALE,
  already_onboarded: ONBOARDING_ERROR_CODES.ALREADY_ONBOARDED,
  missing_school_name: ONBOARDING_ERROR_CODES.VALIDATION,
  admin_not_allowed: ONBOARDING_ERROR_CODES.FORBIDDEN,
};

function normalizeText(value) {
  return String(value || '').trim();
}

function getResponseBody(error) {
  return error?.data || error?.response?.data || error?.body || null;
}

function getResponseHeaders(error) {
  return error?.headers || error?.response?.headers || {};
}

function getHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name) || headers.get(name.toLowerCase());
  return headers[name] || headers[name.toLowerCase()] || null;
}

export function validateOnboardingPayload({ formData, user }) {
  if (!user?.id) {
    return { valid: false, code: ONBOARDING_ERROR_CODES.VALIDATION, field: 'user.id' };
  }

  if (!formData?.role) {
    return { valid: false, code: ONBOARDING_ERROR_CODES.VALIDATION, field: 'role' };
  }

  if (formData.role === 'ADMIN' && !normalizeText(formData.newSchoolName)) {
    return { valid: false, code: ONBOARDING_ERROR_CODES.VALIDATION, field: 'newSchoolName' };
  }

  if (formData.role !== 'ADMIN') {
    const code = normalizeText(formData.schoolCode);
    if (!code) return { valid: false, code: ONBOARDING_ERROR_CODES.VALIDATION, field: 'schoolCode' };
    // Catch a mistyped code before the round trip; the server still decides.
    if (!isValidJoinCode(code) && !isLegacySchoolId(code)) {
      return { valid: false, code: ONBOARDING_ERROR_CODES.INVALID_SCHOOL_CODE, field: 'schoolCode' };
    }
  }

  return { valid: true };
}

// The `newSchool` block sent to provisionOnboardingProfile. The server stamps
// created_by_user_id and join_code itself and re-sanitises everything here;
// is_demo is never taken from the client (only the platform marks a demo).
export function buildSchoolPayload({ formData, logoUrl, themePreview }) {
  const payload = {
    name: normalizeText(formData.newSchoolName),
    theme_settings: themePreview || DEFAULT_THEME,
  };
  if (logoUrl) payload.logo_url = logoUrl;
  return payload;
}

export function extractBackendErrorDetails(error) {
  const responseBody = getResponseBody(error);
  const headers = getResponseHeaders(error);
  const backendCode = responseBody?.code || responseBody?.error_code || responseBody?.extra_data?.reason || error?.code || null;
  const backendMessage = responseBody?.message || responseBody?.error || error?.message || null;
  const correlationId = responseBody?.correlation_id || responseBody?.request_id || error?.correlationId || error?.requestId || getHeader(headers, 'x-correlation-id') || getHeader(headers, 'x-request-id') || null;

  return {
    status: error?.status || error?.response?.status || null,
    responseBody,
    backendCode,
    errorCode: backendCode,
    backendMessage,
    correlationId,
  };
}

function withField(result, field) {
  const resolved = field || ONBOARDING_ERROR_FIELDS[result.code] || null;
  return resolved ? { ...result, field: resolved } : result;
}

export function mapOnboardingError(error) {
  if (error?.code && ONBOARDING_ERROR_MESSAGES[error.code]) {
    return withField({ code: error.code, message: ONBOARDING_ERROR_MESSAGES[error.code] }, error.field);
  }

  const details = extractBackendErrorDetails(error);
  const lowerCode = String(details.backendCode || '').toLowerCase();
  const lowerMessage = String(details.backendMessage || '').toLowerCase();

  const mapped = SERVER_CODE_MAP[lowerCode];
  if (mapped) return withField({ code: mapped, message: ONBOARDING_ERROR_MESSAGES[mapped] });

  if (
    details.status === 400 ||
    lowerCode.includes('validation') ||
    lowerCode.includes('invalid_payload') ||
    lowerMessage.includes('required')
  ) {
    return { code: ONBOARDING_ERROR_CODES.VALIDATION, message: ONBOARDING_ERROR_MESSAGES[ONBOARDING_ERROR_CODES.VALIDATION] };
  }

  if (
    details.status === 404 ||
    lowerCode.includes('school_not_found') ||
    lowerCode.includes('invalid_school_code') ||
    lowerMessage.includes('invalid school code')
  ) {
    return withField({ code: ONBOARDING_ERROR_CODES.INVALID_SCHOOL_CODE, message: ONBOARDING_ERROR_MESSAGES[ONBOARDING_ERROR_CODES.INVALID_SCHOOL_CODE] });
  }

  if (details.status === 403 || details.status === 401) {
    return { code: ONBOARDING_ERROR_CODES.FORBIDDEN, message: ONBOARDING_ERROR_MESSAGES[ONBOARDING_ERROR_CODES.FORBIDDEN] };
  }

  if (details.status === 409 || lowerCode.includes('duplicate') || lowerMessage.includes('duplicate') || lowerMessage.includes('already exists')) {
    return { code: ONBOARDING_ERROR_CODES.DUPLICATE_TENANT, message: ONBOARDING_ERROR_MESSAGES[ONBOARDING_ERROR_CODES.DUPLICATE_TENANT] };
  }

  return { code: ONBOARDING_ERROR_CODES.UNKNOWN, message: ONBOARDING_ERROR_MESSAGES[ONBOARDING_ERROR_CODES.UNKNOWN] };
}

export function captureOnboardingFailure({ error, requestPayload, phase, correlationId }) {
  const details = extractBackendErrorDetails(error);

  return {
    phase,
    requestPayload,
    ...details,
    errorCode: details.errorCode || 'unknown_error',
    correlationId: details.correlationId || correlationId || null,
  };
}

// Everything that writes School / SchoolSubscription / ConsentRecord /
// UserProfile now happens server-side in provisionOnboardingProfile (see
// src/lib/authorization/onboardingProvision.js for the algorithm and why).
// What stays in the browser is only what needs the browser: validating the
// form, uploading the logo file, and two best-effort follow-ups.
//
// Removed on purpose (audit F03/F26, 2026-09-29): the client School.create /
// SchoolSubscription.create (platform-only under RLS — they always failed),
// findSchoolById (School.read is platform-only — every code was "invalid"),
// ensureTenantBootstrapRecords (Role / PermissionTemplate / AccessBinding do
// not exist and nothing reads them; the SDK's entity Proxy made its
// `Entity?.filter` guard always pass, so it threw after a partial write) and
// the best-effort consent write (now mandatory and server-side).

export async function completeOnboardingTenantCreation({
  base44,
  notificationService,
  logAuditEvent,
  user,
  formData,
  logoFile,
  themePreview,
  consent,
}) {
  const validation = validateOnboardingPayload({ formData, user });
  if (!validation.valid) {
    const error = new Error(`Invalid onboarding payload: ${validation.field}`);
    error.code = validation.code;
    error.field = validation.field;
    throw error;
  }

  const request = {
    role: formData.role,
    phone: normalizeText(formData.phone),
    consent: {
      general: Boolean(consent?.acceptances?.general),
      sensitive: Boolean(consent?.acceptances?.sensitive),
      noticeVersion: consent?.noticeVersion || null,
    },
  };

  if (formData.role === 'ADMIN') {
    let logoUrl = null;
    if (logoFile) {
      const uploaded = await base44.integrations.Core.UploadFile({ file: logoFile });
      logoUrl = uploaded?.file_url || null;
    }
    request.newSchool = buildSchoolPayload({ formData, logoUrl, themePreview });
  } else {
    request.joinCode = normalizeText(formData.schoolCode);
  }

  // invokeFunction unwraps the axios response to the function's body.
  const result = await invokeFunction(base44, 'provisionOnboardingProfile', request);
  const schoolId = result?.schoolId || null;
  const profileId = result?.profileId || null;
  const status = result?.status || (formData.role === 'ADMIN' ? 'ACTIVE' : 'PENDING');

  // Best-effort follow-ups. The account already exists at this point, so a
  // failure here must never turn into "Hubo un error al crear la escuela" and
  // an invitation to retry.
  if (status === 'PENDING') {
    try {
      await notifySchoolAdminsOfPendingUser({ base44, notificationService, user, schoolId, schoolName: result?.schoolName, role: formData.role });
    } catch (error) {
      console.error('pending_user_notice_failed', { message: String(error?.message || error) });
    }
  }

  if (formData.role === 'ADMIN' && typeof logAuditEvent === 'function') {
    try {
      await logAuditEvent({
        user,
        userProfile: { school_id: schoolId, app_role: 'ADMIN' },
        entity: 'SchoolTheme',
        entityId: schoolId,
        action: 'THEME_CREATED_OR_UPDATED',
        reason: 'tenant_theme_onboarding',
        context: { old_palette: null, new_palette: (themePreview || DEFAULT_THEME).palette, timestamp: new Date().toISOString() },
      });
    } catch (error) {
      console.error('onboarding_theme_audit_failed', { message: String(error?.message || error) });
    }
  }

  return { schoolId, profileId, status };
}

// KNOWN GAP (for the notifications package): a PENDING joiner cannot read the
// school's admin UserProfiles or User rows under RLS, so this usually finds no
// recipients and the admins learn about the request only from Aprobaciones.
// sendNotificationEmail already accepts new_user_pending from a PENDING caller;
// what is missing is resolving the admin recipients server-side.
async function notifySchoolAdminsOfPendingUser({ base44, notificationService, user, schoolId, schoolName, role }) {
  const adminProfiles = await base44.entities.UserProfile.filter({
    school_id: schoolId,
    app_role: 'ADMIN',
    status: 'ACTIVE',
  });
  if (!adminProfiles?.length) return;
  const allUsers = await base44.entities.User.list();
  const roleNames = { TEACHER: 'Maestro/a', PARENT: 'Padre/Madre' };
  const recipients = adminProfiles.map((profile) => {
    const adminUser = allUsers.find((u) => u.id === profile.user_id);
    return {
      user_id: profile.user_id,
      app_role: profile.app_role,
      email: adminUser?.email,
      notification_preferences: profile.notification_preferences || {},
      school_notification_preferences: {},
    };
  });

  await notificationService.sendByEvent({
    eventType: 'new_user_pending',
    schoolId,
    actorUserId: user.id,
    recipients,
    templateContext: {
      schoolName: schoolName || 'LIUMA',
      userName: user.full_name,
      userEmail: user.email,
      roleName: roleNames[role],
    },
    channels: ['email', 'in_app'],
  });
}
