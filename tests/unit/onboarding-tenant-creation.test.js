import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ONBOARDING_ERROR_CODES,
  buildSchoolPayload,
  buildUserProfilePayload,
  captureOnboardingFailure,
  completeOnboardingTenantCreation,
  extractBackendErrorDetails,
  mapOnboardingError,
  validateOnboardingPayload,
} from '../../src/lib/onboardingTenantCreation.js';

const user = { id: 'user-1', email: 'owner@example.com', full_name: 'Owner User' };
const themePreview = { palette: { primary: '#111111', secondary: '#222222', accent: '#333333', neutral: '#444444' } };

function createEntity(seed = []) {
  const rows = [...seed];
  return {
    rows,
    createCalls: [],
    updateCalls: [],
    async filter(query) {
      return rows.filter((row) => Object.entries(query).every(([key, value]) => row[key] === value));
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

test('builds test-data tenant and profile payloads with required defaults and foreign keys', () => {
  const formData = { role: 'ADMIN', newSchoolName: ' Colegio Demo ', phone: ' 555 ', isDemo: true };

  assert.deepEqual(buildSchoolPayload({ formData, user, logoUrl: null, themePreview }), {
    name: 'Colegio Demo',
    created_by_user_id: 'user-1',
    is_demo: true,
    data_mode: 'test-data',
  });

  assert.deepEqual(buildUserProfilePayload({ formData, user, schoolId: 'school-1', ownerEmail: 'owner@example.com' }), {
    user_id: 'user-1',
    school_id: 'school-1',
    app_role: 'ADMIN',
    status: 'ACTIVE',
    phone: '555',
    onboarding_completed: true,
    is_super_admin: true,
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
    ownerEmail: 'owner@example.com',
  });

  assert.equal(result.schoolId, '1');
  assert.equal(base44.entities.School.createCalls.length, 1);
  assert.equal(base44.entities.SchoolSubscription.createCalls[0].school_id, '1');
  assert.equal(base44.entities.UserProfile.createCalls[0].school_id, '1');
  assert.equal(base44.entities.UserProfile.createCalls[0].status, 'ACTIVE');
  assert.equal(auditCalls[0].entityId, '1');
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
    ownerEmail: '',
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
    backendMessage: 'School already exists',
  });
  assert.equal(mapOnboardingError(error).code, ONBOARDING_ERROR_CODES.DUPLICATE_TENANT);
  assert.deepEqual(captureOnboardingFailure({ error, requestPayload: { role: 'ADMIN' }, phase: 'school_create' }), {
    phase: 'school_create',
    requestPayload: { role: 'ADMIN' },
    status: 409,
    responseBody: { code: 'duplicate_key', message: 'School already exists' },
    backendCode: 'duplicate_key',
    backendMessage: 'School already exists',
  });
});
