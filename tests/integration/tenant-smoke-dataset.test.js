import test from 'node:test';
import assert from 'node:assert/strict';
import { tenantDataset } from '../fixtures/tenant-smoke-dataset.js';
import { filterByRowLevel } from '../../src/lib/authorization/policy.js';
import { LUMI_INTENTS, buildCapabilityRequest, evaluateCapabilityAccess } from '../../src/lib/lumi/capabilities.js';
import { completeOnboardingTenantCreation, ONBOARDING_ERROR_CODES } from '../../src/lib/onboardingTenantCreation.js';
import { resolveOnboardingProvision, buildOnboardingUpsert } from '../../src/lib/authorization/onboardingProvision.js';

function createEntity(seed = []) {
  const rows = [...seed];
  return {
    async filter(query) {
      return rows.filter((row) => Object.entries(query).every(([key, value]) => row[key] === value));
    },
    async create(payload) {
      const row = { id: `${rows.length + 1}`, ...payload };
      rows.push(row);
      return row;
    },
    async update(id, payload) {
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows[index] = { ...rows[index], ...payload };
      return rows[index] || { id, ...payload };
    },
  };
}

function createBase44(seed = {}, actingUser = { id: 'owner-1' }) {
  const entities = {
    School: createEntity(seed.schools),
    SchoolSubscription: createEntity(seed.subscriptions),
    UserProfile: createEntity(seed.profiles),
    User: createEntity(seed.users),
    Role: createEntity(seed.roles),
    PermissionTemplate: createEntity(seed.permissionTemplates),
    AccessBinding: createEntity(seed.accessBindings),
  };
  const functions = {
    async invoke(name, payload) {
      if (name !== 'provisionOnboardingProfile') throw new Error(`unexpected function ${name}`);
      const { schoolId, role, phone } = payload;
      const school = (await entities.School.filter({ id: schoolId }))[0] || null;
      const schoolAdmins = await entities.UserProfile.filter({ school_id: schoolId, app_role: 'ADMIN' });
      const decision = resolveOnboardingProvision({ user: actingUser, school, role, schoolAdmins });
      if (!decision.ok) {
        const error = new Error(decision.message);
        error.code = decision.code;
        error.data = { code: decision.code, error: decision.message };
        throw error;
      }
      const existing = (await entities.UserProfile.filter({ user_id: actingUser.id, school_id: schoolId }))[0] || null;
      const upsert = buildOnboardingUpsert({ user: actingUser, schoolId, phone, appRole: decision.appRole, status: decision.status, existingProfile: existing });
      if (upsert.action === 'update') {
        await entities.UserProfile.update(upsert.id, upsert.payload);
        return { ok: true, profileId: upsert.id, status: existing.status || decision.status };
      }
      const created = await entities.UserProfile.create(upsert.payload);
      return { ok: true, profileId: created.id, status: decision.status };
    },
  };
  return {
    integrations: { Core: { UploadFile: async () => ({ file_url: 'https://cdn.test/logo.png' }) } },
    entities,
    functions,
  };
}

test('dataset base cubre tenants small/medium/complex y entidades mínimas', () => {
  assert.equal(tenantDataset.schools.length, 3);
  assert.equal(tenantDataset.schools.some((s) => s.complexity === 'small'), true);
  assert.equal(tenantDataset.schools.some((s) => s.complexity === 'medium'), true);
  assert.equal(tenantDataset.schools.some((s) => s.complexity === 'complex'), true);

  const requiredCollections = [
    'userProfiles','classrooms','students','parentStudents','teacherClassrooms','attendance',
    'homework','diaryEntries','notices','events','paymentConcepts','chargeItems','discounts','officialDocuments',
  ];

  for (const collection of requiredCollections) {
    assert.equal(Array.isArray(tenantDataset[collection]), true, `${collection} should exist`);
    assert.equal(tenantDataset[collection].length > 0, true, `${collection} should have rows`);
  }
});

test('casos borde incluidos: pending/suspended, pagos overdue/current, low contrast logo', () => {
  assert.equal(tenantDataset.userProfiles.some((p) => p.status === 'PENDING'), true);
  assert.equal(tenantDataset.userProfiles.some((p) => p.status === 'SUSPENDED'), true);
  assert.equal(tenantDataset.chargeItems.some((c) => c.status === 'OVERDUE'), true);
  assert.equal(tenantDataset.chargeItems.some((c) => c.status === 'CURRENT'), true);
  assert.equal(tenantDataset.schools.some((s) => s.low_contrast_logo === true), true);
});

test('smoke: login por rol + rutas críticas + permisos denegados esperados', () => {
  const admin = { role: 'ADMIN', classroomIds: ['class-small-a'], studentIds: ['student-small-1'] };
  const teacher = { role: 'TEACHER', classroomIds: ['class-small-a'], studentIds: [] };
  const parent = { role: 'PARENT', classroomIds: ['class-small-a'], studentIds: ['student-small-1'] };

  const adminNotices = filterByRowLevel({ role: admin.role, entity: 'Notice', rows: tenantDataset.notices, classroomIds: admin.classroomIds, studentIds: admin.studentIds });
  const teacherAttendance = filterByRowLevel({ role: teacher.role, entity: 'Attendance', rows: tenantDataset.attendance, classroomIds: teacher.classroomIds, studentIds: teacher.studentIds });
  const parentCharges = filterByRowLevel({ role: parent.role, entity: 'ChargeItem', rows: tenantDataset.chargeItems, classroomIds: parent.classroomIds, studentIds: parent.studentIds });
  const deniedTeacherCharges = filterByRowLevel({ role: teacher.role, entity: 'ChargeItem', rows: tenantDataset.chargeItems, classroomIds: teacher.classroomIds, studentIds: teacher.studentIds });

  assert.deepEqual(adminNotices.map((r) => r.id), ['notice-small-school', 'notice-small-class']);
  assert.deepEqual(teacherAttendance.map((r) => r.id), ['att-small-1']);
  assert.deepEqual(parentCharges.map((r) => r.id), ['charge-overdue']);
  assert.deepEqual(deniedTeacherCharges, []);
});

test('smoke Lumi básico por rol', () => {
  const adminReq = buildCapabilityRequest({ intent: LUMI_INTENTS.ATTENDANCE_STATUS, prompt: 'asistencia', userProfile: { app_role: 'ADMIN', school_id: 'tenant-small' } });
  const teacherReq = buildCapabilityRequest({ intent: LUMI_INTENTS.PAYMENT_REMINDERS, prompt: 'recordatorios', userProfile: { app_role: 'TEACHER', school_id: 'tenant-small' } });
  const parentReq = buildCapabilityRequest({ intent: LUMI_INTENTS.HOMEWORK_LOOKUP, prompt: 'tarea', userProfile: { app_role: 'PARENT', school_id: 'tenant-small', linked_students: [{ id: 'student-small-1' }] }, inputs: { student_id: 'student-small-1' } });

  assert.equal(evaluateCapabilityAccess({ intent: LUMI_INTENTS.ATTENDANCE_STATUS, request: adminReq }).allowed, true);
  assert.equal(evaluateCapabilityAccess({ intent: LUMI_INTENTS.PAYMENT_REMINDERS, request: teacherReq }).allowed, false);
  assert.equal(evaluateCapabilityAccess({ intent: LUMI_INTENTS.HOMEWORK_LOOKUP, request: parentReq }).allowed, true);
});

test('verifica creación de tenant en test-data mode sin unknown error', async () => {
  const user = { id: 'owner-1', email: 'owner@test.dev', full_name: 'Owner Test' };
  const base44 = createBase44({}, user);

  const result = await completeOnboardingTenantCreation({
    base44,
    notificationService: { sendByEvent: async () => {} },
    logAuditEvent: async () => {},
    user,
    formData: { role: 'ADMIN', newSchoolName: 'Tenant Smoke', phone: '', isDemo: true },
    logoFile: null,
    themePreview: tenantDataset.schools[2].theme_settings,
    ownerEmail: user.email,
  });

  assert.equal(result.error?.code === ONBOARDING_ERROR_CODES.UNKNOWN, false);
  assert.equal(result.schoolId != null, true);
});
