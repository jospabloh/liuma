import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASELINE_PERMISSION_TEMPLATES,
  ONBOARDING_ERROR_CODES,
  REQUIRED_TENANT_ROLES,
  buildSchoolPayload,
  buildUserProfilePayload,
  captureOnboardingFailure,
  completeOnboardingTenantCreation,
  extractBackendErrorDetails,
  mapOnboardingError,
  validateOnboardingPayload,
} from '../../src/lib/onboardingTenantCreation.js';
import { DEFAULT_THEME } from '../../src/lib/tenantTheme.js';

const user = { id: 'user-1', email: 'owner@example.com', full_name: 'Owner User' };
const themePreview = { palette: { primary: '#111111', secondary: '#222222', accent: '#333333', neutral: '#444444' } };

function createEntity(seed = []) {
  const rows = [...seed];
  return {
    rows,
    createCalls: [],
    updateCalls: [],
    async filter(query, order) {
      const result = rows.filter((row) => Object.entries(query).every(([key, value]) => row[key] === value));
      if (order === '-created_date') return [...result].sort((a, b) => String(b.created_date || '').localeCompare(String(a.created_date || '')));
      return result;
    },
    async create(payload) {
      this.createCalls.push(payload);
      const row = { id: `${this.createCalls.length}`, ...payload };
      rows.push(row);
      return row;
    },
    async update(id, payload) {
      this.updateCalls.push({ id, payload });
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows[index] = { ...rows[index], ...payload };
      return rows[index] || { id, ...payload };
    },
    async list() {
      return rows;
    },
  };
}

function createBase44(seed = {}) {
  return {
    integrations: { Core: { UploadFile: async () => ({ file_url: 'https://cdn.test/logo.png' }) } },
    entities: {
      School: createEntity(seed.schools),
      SchoolSubscription: createEntity(seed.subscriptions),
      UserProfile: createEntity(seed.profiles),
      User: createEntity(seed.users),
      Role: createEntity(seed.roles),
      PermissionTemplate: createEntity(seed.permissionTemplates),
      AccessBinding: createEntity(seed.accessBindings),
    },
  };
}

test('validates required tenant creation fields before backend calls', () => {
  assert.deepEqual(
    validateOnboardingPayload({ formData: { role: 'ADMIN', newSchoolName: '   ' }, user }),
    { valid: false, code: ONBOARDING_ERROR_CODES.VALIDATION, field: 'newSchoolName' }
  );
  assert.deepEqual(
    validateOnboardingPayload({ formData: { role: 'TEACHER', schoolCode: '' }, user }),
    { valid: false, code: ONBOARDING_ERROR_CODES.VALIDATION, field: 'schoolCode' }
  );
});

test('lets any admin create a tenant and never assigns the privileged super-admin flag from the client', async () => {
  const base44 = createBase44();

  const result = await completeOnboardingTenantCreation({
    base44,
    notificationService: { sendByEvent: async () => {} },
    logAuditEvent: async () => {},
    user: { ...user, email: 'director@example.com' },
    formData: { role: 'ADMIN', newSchoolName: 'Colegio Nuevo', phone: '', isDemo: false },
    logoFile: null,
    themePreview,
  });

  assert.ok(result.profileId);
  assert.equal(base44.entities.School.createCalls.length, 1);
  assert.equal(base44.entities.UserProfile.createCalls.length, 1);
  assert.equal('is_super_admin' in base44.entities.UserProfile.createCalls[0], false);
});

test('builds test-data tenant and profile payloads with required defaults and foreign keys', () => {
  const formData = { role: 'ADMIN', newSchoolName: ' Colegio Demo ', phone: ' 555 ', isDemo: true };

  assert.deepEqual(buildSchoolPayload({ formData, user, logoUrl: null, themePreview }), {
    name: 'Colegio Demo',
    created_by_user_id: 'user-1',
    is_demo: true,
    data_mode: 'test-data',
    theme_settings: themePreview,
  });

  assert.deepEqual(buildUserProfilePayload({ formData, user, schoolId: 'school-1' }), {
    user_id: 'user-1',
    school_id: 'school-1',
    app_role: 'ADMIN',
    status: 'ACTIVE',
    phone: '555',
    onboarding_completed: true,
  });
});

test('provisions tenant, trial subscription, admin profile, and audit hook for admin creation', async () => {
  const base44 = createBase44();
  const auditCalls = [];

  const result = await completeOnboardingTenantCreation({
    base44,
    notificationService: { sendByEvent: async () => {} },
    logAuditEvent: async (payload) => auditCalls.push(payload),
    user,
    formData: { role: 'ADMIN', newSchoolName: 'Colegio Nuevo', phone: '', isDemo: false },
    logoFile: null,
    themePreview,
  });

  assert.equal(result.schoolId, '1');
  assert.equal(result.profileId, '1');
  assert.equal(base44.entities.School.createCalls.length, 1);
  assert.equal(base44.entities.SchoolSubscription.createCalls[0].school_id, '1');
  assert.equal(base44.entities.UserProfile.createCalls[0].school_id, '1');
  assert.equal(base44.entities.UserProfile.createCalls[0].status, 'ACTIVE');
  assert.equal(auditCalls[0].entityId, '1');
});

test('automatically bootstraps required roles, permission templates, owner binding, and theme fallback for new admin tenant', async () => {
  const base44 = createBase44();

  await completeOnboardingTenantCreation({
    base44,
    notificationService: { sendByEvent: async () => {} },
    logAuditEvent: async () => {},
    user,
    formData: { role: 'ADMIN', newSchoolName: 'Colegio Bootstrap', phone: '', isDemo: false },
    logoFile: null,
    themePreview: null,
  });

  assert.deepEqual(base44.entities.School.createCalls[0].theme_settings, DEFAULT_THEME);
  assert.deepEqual(
    base44.entities.Role.createCalls.map((row) => ({ role_key: row.role_key, school_id: row.school_id, is_required: row.is_required })),
    REQUIRED_TENANT_ROLES.map((role) => ({ role_key: role.role_key, school_id: '1', is_required: true }))
  );
  assert.deepEqual(
    base44.entities.PermissionTemplate.createCalls.map((row) => ({ role_key: row.role_key, school_id: row.school_id, is_baseline: row.is_baseline })),
    BASELINE_PERMISSION_TEMPLATES.map((template) => ({ role_key: template.role_key, school_id: '1', is_baseline: true }))
  );
  assert.deepEqual(base44.entities.AccessBinding.createCalls[0], {
    school_id: '1',
    user_profile_id: '1',
    binding_key: 'tenant_owner_admin',
    role_key: 'ADMIN',
    status: 'ACTIVE',
  });
});

test('retries tenant provisioning idempotently after school creation succeeds but hooks are incomplete', async () => {
  const base44 = createBase44({ schools: [{ id: 'school-existing', name: 'Colegio Retry', created_by_user_id: 'user-1' }] });

  const result = await completeOnboardingTenantCreation({
    base44,
    notificationService: { sendByEvent: async () => {} },
    logAuditEvent: async () => {},
    user,
    formData: { role: 'ADMIN', newSchoolName: 'Colegio Retry', phone: '', isDemo: false },
    logoFile: null,
    themePreview,
  });

  assert.equal(result.schoolId, 'school-existing');
  assert.equal(base44.entities.School.createCalls.length, 0);
  assert.equal(base44.entities.SchoolSubscription.createCalls.length, 1);
  assert.equal(base44.entities.UserProfile.createCalls[0].school_id, 'school-existing');
});

test('captures unknown backend details and maps duplicate failures explicitly for users', () => {
  const error = {
    status: 409,
    data: { code: 'duplicate_key', message: 'School already exists' },
  };

  assert.deepEqual(extractBackendErrorDetails(error), {
    status: 409,
    responseBody: { code: 'duplicate_key', message: 'School already exists' },
    backendCode: 'duplicate_key',
    errorCode: 'duplicate_key',
    backendMessage: 'School already exists',
    correlationId: null,
  });
  assert.deepEqual(mapOnboardingError(error), {
    code: ONBOARDING_ERROR_CODES.DUPLICATE_TENANT,
    message: 'Ya existe una escuela con esos datos. Revisa el nombre o contacta a soporte.',
  });
  assert.deepEqual(captureOnboardingFailure({ error, requestPayload: { role: 'ADMIN' }, phase: 'school_create' }), {
    phase: 'school_create',
    requestPayload: { role: 'ADMIN' },
    status: 409,
    responseBody: { code: 'duplicate_key', message: 'School already exists' },
    backendCode: 'duplicate_key',
    errorCode: 'duplicate_key',
    backendMessage: 'School already exists',
    correlationId: null,
  });
});

test('captures tenant creation correlation IDs and error codes for operational logs', () => {
  const error = {
    response: {
      status: 500,
      data: { error_code: 'tenant_write_failed', message: 'Write failed' },
      headers: { 'x-correlation-id': 'corr-123' },
    },
  };

  const failure = captureOnboardingFailure({
    error,
    requestPayload: { role: 'ADMIN' },
    phase: 'onboarding_tenant_creation',
    correlationId: 'client-corr-1',
  });

  assert.equal(failure.correlationId, 'corr-123');
  assert.equal(failure.errorCode, 'tenant_write_failed');
  assert.equal(failure.backendCode, 'tenant_write_failed');
});

test('maps failed tenant creation to a deterministic duplicate message without creating dependent rows', async () => {
  const duplicateError = {
    status: 409,
    data: { code: 'duplicate_school', message: 'School already exists' },
  };
  const base44 = createBase44();
  base44.entities.School.create = async () => { throw duplicateError; };

  await assert.rejects(
    completeOnboardingTenantCreation({
      base44,
      notificationService: { sendByEvent: async () => {} },
      logAuditEvent: async () => {},
      user,
      formData: { role: 'ADMIN', newSchoolName: 'Colegio Duplicado', phone: '', isDemo: false },
      logoFile: null,
      themePreview,
    }),
    duplicateError
  );

  assert.deepEqual(mapOnboardingError(duplicateError), {
    code: ONBOARDING_ERROR_CODES.DUPLICATE_TENANT,
    message: 'Ya existe una escuela con esos datos. Revisa el nombre o contacta a soporte.',
  });
  assert.equal(base44.entities.SchoolSubscription.createCalls.length, 0);
  assert.equal(base44.entities.UserProfile.createCalls.length, 0);
  assert.equal(base44.entities.Role.createCalls.length, 0);
});

test('maps validation and invalid-school backend failures to deterministic user-facing messages', () => {
  const validationError = {
    status: 400,
    data: { code: 'validation_failed', message: 'required field missing' },
  };
  const invalidSchoolCodeError = {
    status: 404,
    data: { code: 'invalid_school_code', message: 'invalid school code' },
  };

  assert.deepEqual(mapOnboardingError(validationError), {
    code: ONBOARDING_ERROR_CODES.VALIDATION,
    message: 'Faltan datos requeridos para completar el registro.',
  });
  assert.deepEqual(mapOnboardingError(invalidSchoolCodeError), {
    code: ONBOARDING_ERROR_CODES.INVALID_SCHOOL_CODE,
    message: 'Código de escuela inválido. Verifica con tu administrador.',
  });
});
