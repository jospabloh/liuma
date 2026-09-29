// Onboarding end to end, against a fake backend whose CLIENT side has the
// deployed RLS (School / SchoolSubscription / ConsentRecord / other people's
// profiles are all 403 from the browser) and whose SERVER side runs the real
// provisioning algorithm. The previous suite gave the client full write access
// to those entities, so it stayed green while no school could sign up in
// production (audit F03).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ONBOARDING_ERROR_CODES,
  buildSchoolPayload,
  captureOnboardingFailure,
  completeOnboardingTenantCreation,
  extractBackendErrorDetails,
  mapOnboardingError,
  validateOnboardingPayload,
} from '../../src/lib/onboardingTenantCreation.js';
import { DEFAULT_THEME } from '../../src/lib/tenantTheme.js';
import { isValidJoinCode, formatJoinCode } from '../../src/lib/onboarding/joinCode.js';
import { PRIVACY_NOTICE_VERSION, TERMS_VERSION } from '../../src/lib/consent/privacyNotice.js';
import { TRIAL_DURATION_DAYS } from '../../src/lib/license/licenseModel.js';
import { createOnboardingBackend, FULL_CONSENT } from '../fixtures/onboarding-backend.js';

const founder = { id: 'user-founder', email: 'directora@example.com', full_name: 'Directora' };
const parent = { id: 'user-parent', email: 'mama@example.com', full_name: 'Mamá' };
const themePreview = { palette: { primary: '#111111', secondary: '#222222', accent: '#333333', neutral: '#444444' }, source: 'logo' };
const noop = { sendByEvent: async () => {} };

function onboard(client, user, formData, extra = {}) {
  return completeOnboardingTenantCreation({
    base44: client,
    notificationService: noop,
    logAuditEvent: async () => {},
    user,
    formData,
    logoFile: null,
    themePreview,
    consent: FULL_CONSENT,
    ...extra,
  });
}

test('validates required fields and flags a malformed school code before any backend call', () => {
  assert.deepEqual(
    validateOnboardingPayload({ formData: { role: 'ADMIN', newSchoolName: '   ' }, user: founder }),
    { valid: false, code: ONBOARDING_ERROR_CODES.VALIDATION, field: 'newSchoolName' },
  );
  assert.deepEqual(
    validateOnboardingPayload({ formData: { role: 'TEACHER', schoolCode: '' }, user: parent }),
    { valid: false, code: ONBOARDING_ERROR_CODES.VALIDATION, field: 'schoolCode' },
  );
  // "12345" is neither a join code nor a legacy id — say so next to the field.
  assert.deepEqual(
    validateOnboardingPayload({ formData: { role: 'PARENT', schoolCode: '12345' }, user: parent }),
    { valid: false, code: ONBOARDING_ERROR_CODES.INVALID_SCHOOL_CODE, field: 'schoolCode' },
  );
  assert.equal(validateOnboardingPayload({ formData: { role: 'PARENT', schoolCode: 'abcd-efgh' }, user: parent }).valid, true);
  assert.equal(validateOnboardingPayload({ formData: { role: 'PARENT', schoolCode: '696e9b34b4402eca67ec8612' }, user: parent }).valid, true);
});

test('a founder signs up through the server path alone: school, trial, consent and ACTIVE ADMIN profile', async () => {
  const { client, sr, invokeCalls } = createOnboardingBackend({}, founder);

  const result = await onboard(client, founder, { role: 'ADMIN', newSchoolName: '  Colegio   Nuevo ', phone: ' 449 000 0000 ' });

  // The only thing the browser did was call the function.
  assert.deepEqual(invokeCalls.map((c) => c.name), ['provisionOnboardingProfile']);

  const [school] = sr.entities.School.rows;
  assert.equal(result.schoolId, school.id);
  assert.equal(result.status, 'ACTIVE');
  assert.equal(school.name, 'Colegio Nuevo');
  // Founder identity is stamped from the authenticated user, not the form.
  assert.equal(school.created_by_user_id, founder.id);
  assert.ok(isValidJoinCode(school.join_code), `join_code ${school.join_code} must be a short code`);
  assert.equal(school.is_demo, false);
  assert.deepEqual(school.theme_settings.palette, themePreview.palette);

  const [sub] = sr.entities.SchoolSubscription.rows;
  assert.equal(sub.school_id, school.id);
  assert.equal(sub.subscription_status, 'trial');
  const days = (Date.parse(sub.trial_end_date) - Date.parse(sub.trial_start_date)) / 86_400_000;
  assert.equal(days, TRIAL_DURATION_DAYS);
  // Server clock, not the browser's.
  assert.equal(sub.trial_start_date, '2026-09-29T15:00:00.000Z');

  const [consent] = sr.entities.ConsentRecord.rows;
  assert.equal(consent.user_id, founder.id);
  assert.equal(consent.school_id, school.id);
  assert.equal(consent.notice_version, PRIVACY_NOTICE_VERSION);
  assert.equal(consent.terms_version, TERMS_VERSION);
  assert.equal(consent.accepted_sensitive_minor_data, true);

  const [profile] = sr.entities.UserProfile.rows;
  assert.deepEqual(
    { user_id: profile.user_id, school_id: profile.school_id, app_role: profile.app_role, status: profile.status, phone: profile.phone },
    { user_id: founder.id, school_id: school.id, app_role: 'ADMIN', status: 'ACTIVE', phone: '449 000 0000' },
  );
  assert.equal('is_super_admin' in profile, false);
});

test('the client cannot smuggle founder identity, a join code or the demo flag into the new school', async () => {
  const { client, sr } = createOnboardingBackend({}, founder);
  await client.functions.invoke('provisionOnboardingProfile', {
    role: 'ADMIN',
    consent: { general: true, sensitive: true, noticeVersion: PRIVACY_NOTICE_VERSION },
    newSchool: {
      name: 'Colegio',
      created_by_user_id: 'someone-else',
      join_code: 'AAAAAAAA',
      is_demo: true,
      theme_settings: { palette: { primary: 'javascript:alert(1)' } },
      logo_url: 'http://insecure.example/logo.png',
    },
  });
  const [school] = sr.entities.School.rows;
  assert.equal(school.created_by_user_id, founder.id);
  assert.notEqual(school.join_code, 'AAAAAAAA');
  assert.equal(school.is_demo, false);
  assert.equal(school.theme_settings, undefined, 'an invalid palette is dropped, not stored');
  assert.equal(school.logo_url, undefined, 'only https logo URLs are stored');
});

test('buildSchoolPayload sends only name, theme and logo — never identity or demo flags', () => {
  assert.deepEqual(
    buildSchoolPayload({ formData: { newSchoolName: ' Colegio Demo ', isDemo: true }, logoUrl: null, themePreview: null }),
    { name: 'Colegio Demo', theme_settings: DEFAULT_THEME },
  );
});

test('a parent joins with the short code (any case, with or without the dash) and lands PENDING', async () => {
  const school = { id: 'school-1', name: 'Colegio Montessori', created_by_user_id: 'x', join_code: 'ABCDEFGH' };
  const { client, sr } = createOnboardingBackend({ schools: [school] }, parent);

  const result = await onboard(client, parent, { role: 'PARENT', schoolCode: 'abcd-efgh' });

  assert.equal(result.schoolId, 'school-1');
  assert.equal(result.status, 'PENDING');
  const [profile] = sr.entities.UserProfile.rows;
  assert.equal(profile.app_role, 'PARENT');
  assert.equal(profile.status, 'PENDING');
  assert.equal(sr.entities.ConsentRecord.rows[0].app_role, 'PARENT');
  // Joining never creates a school or a subscription.
  assert.equal(sr.entities.School.createCalls.length, 0);
  assert.equal(sr.entities.SchoolSubscription.createCalls.length, 0);
});

test('a code handed out before join_code existed (the raw school id) still works', async () => {
  const school = { id: '696e9b34b4402eca67ec8612', name: 'MUNDO GURI' };
  const { client, sr } = createOnboardingBackend({ schools: [school] }, parent);
  const result = await onboard(client, parent, { role: 'TEACHER', schoolCode: '696e9b34b4402eca67ec8612' });
  assert.equal(result.schoolId, school.id);
  assert.equal(sr.entities.UserProfile.rows[0].status, 'PENDING');
});

test('an unknown code is reported against the code field, and nothing is written', async () => {
  const { client, sr } = createOnboardingBackend({ schools: [{ id: 's', join_code: 'ABCDEFGH' }] }, parent);
  const error = await onboard(client, parent, { role: 'PARENT', schoolCode: 'ZZZZ-ZZZZ' }).catch((e) => e);
  assert.deepEqual(mapOnboardingError(error), {
    code: ONBOARDING_ERROR_CODES.INVALID_SCHOOL_CODE,
    message: 'Código de escuela inválido. Verifica con tu administrador.',
    field: 'schoolCode',
  });
  assert.equal(sr.entities.UserProfile.rows.length, 0);
  assert.equal(sr.entities.ConsentRecord.rows.length, 0);
});

test('without complete consent there is no onboarding — and no consent means no profile', async () => {
  const { client, sr } = createOnboardingBackend({}, founder);
  const error = await onboard(client, founder, { role: 'ADMIN', newSchoolName: 'Colegio' }, {
    consent: { acceptances: { general: true, sensitive: false }, noticeVersion: PRIVACY_NOTICE_VERSION },
  }).catch((e) => e);
  assert.equal(mapOnboardingError(error).code, ONBOARDING_ERROR_CODES.CONSENT_REQUIRED);
  assert.equal(mapOnboardingError(error).field, 'consent');
  assert.equal(sr.entities.School.rows.length, 0);
  assert.equal(sr.entities.UserProfile.rows.length, 0);
});

test('a browser showing an older notice is asked to reload instead of recording the wrong version', async () => {
  const { client, sr } = createOnboardingBackend({}, founder);
  const error = await onboard(client, founder, { role: 'ADMIN', newSchoolName: 'Colegio' }, {
    consent: { acceptances: { general: true, sensitive: true }, noticeVersion: '2026-06-18' },
  }).catch((e) => e);
  assert.equal(mapOnboardingError(error).code, ONBOARDING_ERROR_CODES.CONSENT_STALE);
  assert.equal(sr.entities.ConsentRecord.rows.length, 0);
});

test('if the ConsentRecord cannot be persisted, onboarding fails before the profile (the commit point)', async () => {
  const { client, sr } = createOnboardingBackend({}, founder);
  sr.entities.ConsentRecord.failCreate = new Error('entity unavailable');
  await assert.rejects(onboard(client, founder, { role: 'ADMIN', newSchoolName: 'Colegio' }));
  assert.equal(sr.entities.UserProfile.rows.length, 0, 'no profile without proof of consent');
});

test('retrying an interrupted signup reuses the school and its trial instead of duplicating them', async () => {
  const { client, sr } = createOnboardingBackend({}, founder);
  sr.entities.ConsentRecord.failCreate = new Error('transient');
  await onboard(client, founder, { role: 'ADMIN', newSchoolName: 'Colegio Retry' }).catch(() => {});
  assert.equal(sr.entities.School.rows.length, 1);
  assert.equal(sr.entities.SchoolSubscription.rows.length, 1);

  sr.entities.ConsentRecord.failCreate = null;
  const result = await onboard(client, founder, { role: 'ADMIN', newSchoolName: 'Colegio Retry' });
  assert.equal(sr.entities.School.rows.length, 1);
  assert.equal(sr.entities.SchoolSubscription.rows.length, 1);
  assert.equal(result.schoolId, sr.entities.School.rows[0].id);
  assert.equal(result.status, 'ACTIVE');
});

test('one account, one school: a user with a profile elsewhere cannot onboard again', async () => {
  const seed = {
    schools: [{ id: 'a', join_code: 'ABCDEFGH' }, { id: 'b', join_code: 'HGFEDCBA' }],
    profiles: [{ id: 'p1', user_id: parent.id, school_id: 'a', app_role: 'PARENT', status: 'ACTIVE' }],
  };
  const { client, sr } = createOnboardingBackend(seed, parent);
  const joinOther = await onboard(client, parent, { role: 'PARENT', schoolCode: 'HGFE-DCBA' }).catch((e) => e);
  assert.equal(mapOnboardingError(joinOther).code, ONBOARDING_ERROR_CODES.ALREADY_ONBOARDED);
  const found = await onboard(client, parent, { role: 'ADMIN', newSchoolName: 'Otra' }).catch((e) => e);
  assert.equal(mapOnboardingError(found).code, ONBOARDING_ERROR_CODES.ALREADY_ONBOARDED);
  assert.equal(sr.entities.School.rows.length, 2);
});

test('a failing pending-user notice never turns a completed signup into an error', async () => {
  const school = { id: 'school-1', name: 'Colegio', join_code: 'ABCDEFGH' };
  const { client } = createOnboardingBackend({ schools: [school] }, parent);
  // client.entities.UserProfile / User are RLS-denied for a PENDING joiner.
  const result = await onboard(client, parent, { role: 'PARENT', schoolCode: 'ABCDEFGH' });
  assert.equal(result.status, 'PENDING');
});

test('the join code shown to admins formats as ABCD-EFGH', () => {
  assert.equal(formatJoinCode('abcdefgh'), 'ABCD-EFGH');
});

test('captures backend details and maps a duplicate failure explicitly', () => {
  const error = { status: 409, data: { code: 'duplicate_key', message: 'School already exists' } };
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
  assert.equal(captureOnboardingFailure({ error, requestPayload: { role: 'ADMIN' }, phase: 'x' }).errorCode, 'duplicate_key');
});

test('a 409 from the server is not blindly "duplicate school" — known codes win over the status', () => {
  assert.equal(mapOnboardingError({ status: 409, data: { code: 'ALREADY_ONBOARDED' } }).code, ONBOARDING_ERROR_CODES.ALREADY_ONBOARDED);
  assert.equal(mapOnboardingError({ status: 409, data: { code: 'CONSENT_VERSION_MISMATCH' } }).code, ONBOARDING_ERROR_CODES.CONSENT_STALE);
  assert.equal(mapOnboardingError({ status: 403, data: { code: 'ADMIN_NOT_ALLOWED' } }).code, ONBOARDING_ERROR_CODES.FORBIDDEN);
});

test('captures correlation ids and validation failures for operational logs', () => {
  const error = {
    response: { status: 500, data: { error_code: 'tenant_write_failed', message: 'Write failed' }, headers: { 'x-correlation-id': 'corr-123' } },
  };
  const failure = captureOnboardingFailure({ error, requestPayload: {}, phase: 'onboarding_tenant_creation', correlationId: 'c' });
  assert.equal(failure.correlationId, 'corr-123');
  assert.equal(failure.errorCode, 'tenant_write_failed');
  assert.equal(mapOnboardingError({ status: 400, data: { code: 'validation_failed', message: 'required field missing' } }).code, ONBOARDING_ERROR_CODES.VALIDATION);
});
