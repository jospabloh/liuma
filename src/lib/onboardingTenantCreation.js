import { DEFAULT_THEME } from './tenantTheme.js';
import { buildConsentRecordPayload } from './consent/privacyNotice.js';
import { buildTrialSubscription } from './license/licenseModel.js';

export const ONBOARDING_ERROR_CODES = {
  VALIDATION: 'validation_error',
  INVALID_SCHOOL_CODE: 'invalid_school_code',
  DUPLICATE_TENANT: 'duplicate_tenant',
  FORBIDDEN: 'forbidden',
  UNKNOWN: 'unknown_error',
};

export const ONBOARDING_ERROR_MESSAGES = {
  [ONBOARDING_ERROR_CODES.VALIDATION]: 'Faltan datos requeridos para completar el registro.',
  [ONBOARDING_ERROR_CODES.INVALID_SCHOOL_CODE]: 'Código de escuela inválido. Verifica con tu administrador.',
  [ONBOARDING_ERROR_CODES.DUPLICATE_TENANT]: 'Ya existe una escuela con esos datos. Revisa el nombre o contacta a soporte.',
  [ONBOARDING_ERROR_CODES.FORBIDDEN]: 'No tienes permisos para completar esta acción. Vuelve a iniciar sesión o contacta a soporte.',
  [ONBOARDING_ERROR_CODES.UNKNOWN]: 'Hubo un error al crear la escuela. Intenta de nuevo o contacta a soporte.',
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

export const REQUIRED_TENANT_ROLES = [
  { role_key: 'ADMIN', name: 'Administrador', is_required: true },
  { role_key: 'TEACHER', name: 'Maestro/a', is_required: true },
  { role_key: 'PARENT', name: 'Padre/Madre', is_required: true },
];

export const BASELINE_PERMISSION_TEMPLATES = [
  { role_key: 'ADMIN', name: 'Plantilla Admin', permissions: { all: true } },
  { role_key: 'TEACHER', name: 'Plantilla Maestro', permissions: { classroom_scope: true } },
  { role_key: 'PARENT', name: 'Plantilla Padre/Madre', permissions: { student_scope: true } },
];

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

  if (formData.role !== 'ADMIN' && !normalizeText(formData.schoolCode)) {
    return { valid: false, code: ONBOARDING_ERROR_CODES.VALIDATION, field: 'schoolCode' };
  }

  return { valid: true };
}

export function buildSchoolPayload({ formData, user, logoUrl, themePreview }) {
  const payload = {
    name: normalizeText(formData.newSchoolName),
    created_by_user_id: user.id,
    theme_settings: themePreview || DEFAULT_THEME,
  };

  if (logoUrl) {
    payload.logo_url = logoUrl;
  }

  if (formData.isDemo) {
    payload.is_demo = true;
    payload.data_mode = 'test-data';
  }

  return payload;
}

export function buildUserProfilePayload({ formData, user, schoolId }) {
  const isAdmin = formData.role === 'ADMIN';

  // `is_super_admin` is a privileged field owned exclusively by the backend (Base44 entity
  // rules / RLS). The client never sets it, so it cannot self-elevate to platform owner.
  return {
    user_id: user.id,
    school_id: schoolId,
    app_role: isAdmin ? 'ADMIN' : formData.role,
    status: isAdmin ? 'ACTIVE' : 'PENDING',
    phone: normalizeText(formData.phone),
    onboarding_completed: true,
  };
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

export function mapOnboardingError(error) {
  if (error?.code && ONBOARDING_ERROR_MESSAGES[error.code]) {
    return { code: error.code, message: ONBOARDING_ERROR_MESSAGES[error.code] };
  }

  const details = extractBackendErrorDetails(error);
  const lowerCode = String(details.backendCode || '').toLowerCase();
  const lowerMessage = String(details.backendMessage || '').toLowerCase();

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
    return { code: ONBOARDING_ERROR_CODES.INVALID_SCHOOL_CODE, message: ONBOARDING_ERROR_MESSAGES[ONBOARDING_ERROR_CODES.INVALID_SCHOOL_CODE] };
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

async function findSchoolById(School, schoolCode) {
  const schools = await School.filter({ id: normalizeText(schoolCode) });
  return schools[0] || null;
}

async function findReusableCreatedSchool(School, schoolPayload) {
  const schools = await School.filter({
    name: schoolPayload.name,
    created_by_user_id: schoolPayload.created_by_user_id,
  }, '-created_date', 1);
  return schools[0] || null;
}

async function ensureSchoolSubscription(SchoolSubscription, schoolId) {
  const existing = await SchoolSubscription.filter({ school_id: schoolId }, '-created_date', 1);
  if (existing[0]) return existing[0];

  // Seed the 30-day trial with its license tier/limit (mirrors FlowFin).
  return SchoolSubscription.create(buildTrialSubscription(schoolId));
}

async function ensureMissingTenantRows(Entity, query, payload) {
  if (!Entity?.filter || !Entity?.create) return null;

  const existing = await Entity.filter(query, '-created_date', 1);
  if (existing[0]) return existing[0];

  return Entity.create(payload);
}

async function ensureTenantBootstrapRecords(base44, schoolId, ownerProfileId) {
  const created = { roles: [], permissionTemplates: [], accessBindings: [] };

  for (const role of REQUIRED_TENANT_ROLES) {
    const row = await ensureMissingTenantRows(
      base44.entities.Role,
      { school_id: schoolId, role_key: role.role_key },
      { ...role, school_id: schoolId }
    );
    if (row) created.roles.push(row);
  }

  for (const template of BASELINE_PERMISSION_TEMPLATES) {
    const row = await ensureMissingTenantRows(
      base44.entities.PermissionTemplate,
      { school_id: schoolId, role_key: template.role_key },
      { ...template, school_id: schoolId, is_baseline: true }
    );
    if (row) created.permissionTemplates.push(row);
  }

  if (ownerProfileId) {
    const row = await ensureMissingTenantRows(
      base44.entities.AccessBinding,
      { school_id: schoolId, user_profile_id: ownerProfileId, binding_key: 'tenant_owner_admin' },
      { school_id: schoolId, user_profile_id: ownerProfileId, binding_key: 'tenant_owner_admin', role_key: 'ADMIN', status: 'ACTIVE' }
    );
    if (row) created.accessBindings.push(row);
  }

  return created;
}

/**
 * Persist the privacy-notice consent the user gave during onboarding. Required
 * by the LFPDPPP for processing minors' sensitive data. Best-effort: a missing
 * ConsentRecord entity (not yet created in Base44) must never block onboarding,
 * so both writes are guarded. The AuditLog write provides a durable trail using
 * an entity that already exists.
 */
async function persistOnboardingConsent({ base44, logAuditEvent, user, schoolId, role, consent }) {
  if (!consent) return;

  const payload = buildConsentRecordPayload({
    user,
    schoolId,
    role,
    acceptances: consent.acceptances,
    noticeVersion: consent.noticeVersion,
    at: consent.acceptedAt,
    userAgent: consent.userAgent,
  });

  try {
    if (base44?.entities?.ConsentRecord?.create) {
      await base44.entities.ConsentRecord.create(payload);
    }
  } catch (error) {
    console.error('consent_record_persist_failed', { message: String(error?.message || error) });
  }

  try {
    if (typeof logAuditEvent === 'function') {
      await logAuditEvent({
        user,
        userProfile: { school_id: schoolId, app_role: role },
        entity: 'ConsentRecord',
        entityId: user?.id || 'unknown',
        action: 'PRIVACY_CONSENT_ACCEPTED',
        reason: `aviso_de_privacidad ${payload.notice_version}`,
        context: payload,
      });
    }
  } catch (error) {
    console.error('consent_audit_persist_failed', { message: String(error?.message || error) });
  }
}

async function upsertUserProfile(UserProfile, profilePayload) {
  const existingProfiles = await UserProfile.filter({
    user_id: profilePayload.user_id,
    school_id: profilePayload.school_id,
  }, '-created_date', 1);

  if (existingProfiles[0]) {
    await UserProfile.update(existingProfiles[0].id, profilePayload);
    return existingProfiles[0].id;
  }

  const created = await UserProfile.create(profilePayload);
  return created?.id || null;
}

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

  let schoolId = null;
  let school = null;
  let logoUrl = null;

  if (formData.role === 'ADMIN') {
    if (logoFile) {
      const uploaded = await base44.integrations.Core.UploadFile({ file: logoFile });
      logoUrl = uploaded.file_url;
    }

    const schoolPayload = buildSchoolPayload({ formData, user, logoUrl, themePreview });
    school = await findReusableCreatedSchool(base44.entities.School, schoolPayload);
    if (!school) {
      school = await base44.entities.School.create(schoolPayload);
    }
    schoolId = school.id;
    await ensureSchoolSubscription(base44.entities.SchoolSubscription, schoolId);
  } else {
    school = await findSchoolById(base44.entities.School, formData.schoolCode);
    if (!school) {
      const error = new Error('Invalid school code');
      error.code = ONBOARDING_ERROR_CODES.INVALID_SCHOOL_CODE;
      throw error;
    }
    schoolId = school.id;
  }

  const profilePayload = buildUserProfilePayload({ formData, user, schoolId });
  const profileId = await upsertUserProfile(base44.entities.UserProfile, profilePayload);

  await persistOnboardingConsent({ base44, logAuditEvent, user, schoolId, role: formData.role, consent });

  if (formData.role === 'ADMIN') {
    await ensureTenantBootstrapRecords(base44, schoolId, profileId);
  }

  if (profilePayload.status === 'PENDING') {
    const adminProfiles = await base44.entities.UserProfile.filter({
      school_id: schoolId,
      app_role: 'ADMIN',
      status: 'ACTIVE'
    });
    const allUsers = await base44.entities.User.list();
    const roleNames = {
      TEACHER: 'Maestro/a',
      PARENT: 'Padre/Madre'
    };
    const recipients = adminProfiles.map((profile) => {
      const adminUser = allUsers.find((u) => u.id === profile.user_id);
      return {
        user_id: profile.user_id,
        app_role: profile.app_role,
        email: adminUser?.email,
        notification_preferences: profile.notification_preferences || {},
        school_notification_preferences: school?.notification_preferences || {},
      };
    });

    await notificationService.sendByEvent({
      eventType: 'new_user_pending',
      schoolId,
      actorUserId: user.id,
      recipients,
      templateContext: {
        schoolName: school?.name || 'LIUMA',
        userName: user.full_name,
        userEmail: user.email,
        roleName: roleNames[formData.role],
      },
      channels: ['email', 'in_app'],
    });
  }

  if (formData.role === 'ADMIN') {
    const actorProfile = { school_id: schoolId, app_role: 'ADMIN' };
    await logAuditEvent({
      user,
      userProfile: actorProfile,
      entity: 'SchoolTheme',
      entityId: schoolId,
      action: 'THEME_CREATED_OR_UPDATED',
      reason: 'tenant_theme_onboarding',
      context: { old_palette: null, new_palette: (themePreview || DEFAULT_THEME).palette, timestamp: new Date().toISOString() },
    });
  }

  return { schoolId, profileId };
}
