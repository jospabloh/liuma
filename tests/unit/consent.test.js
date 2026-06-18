import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRIVACY_NOTICE_VERSION,
  CONSENT_SCOPES,
  consentIsComplete,
  sensitiveConsentLabel,
  buildConsentRecordPayload,
} from '../../src/lib/consent/privacyNotice.js';

test('onboarding requires both general and sensitive consent', () => {
  assert.equal(consentIsComplete({ general: true, sensitive: true }), true);
  assert.equal(consentIsComplete({ general: true, sensitive: false }), false);
  assert.equal(consentIsComplete({ general: false, sensitive: true }), false);
  assert.equal(consentIsComplete({}), false);
});

test('sensitive-consent wording differs for parents vs staff', () => {
  assert.match(sensitiveConsentLabel('PARENT'), /mi\(s\) hijo\(s\)/);
  assert.match(sensitiveConsentLabel('TEACHER'), /Me comprometo/);
  assert.match(sensitiveConsentLabel('ADMIN'), /Me comprometo/);
});

test('consent record pins the notice version, scopes, and timestamp', () => {
  const at = new Date('2026-06-18T12:00:00Z');
  const payload = buildConsentRecordPayload({
    user: { id: 'user-1' },
    schoolId: 'school-1',
    role: 'PARENT',
    acceptances: { general: true, sensitive: true },
    at,
    userAgent: 'jest',
  });

  assert.equal(payload.user_id, 'user-1');
  assert.equal(payload.school_id, 'school-1');
  assert.equal(payload.app_role, 'PARENT');
  assert.equal(payload.notice_version, PRIVACY_NOTICE_VERSION);
  assert.equal(payload.accepted_general, true);
  assert.equal(payload.accepted_sensitive_minor_data, true);
  assert.deepEqual(payload.accepted_scopes, [CONSENT_SCOPES.GENERAL, CONSENT_SCOPES.SENSITIVE_MINOR]);
  assert.equal(payload.accepted_at, '2026-06-18T12:00:00.000Z');
  assert.equal(payload.user_agent, 'jest');
});

test('partial acceptance is reflected in the stored scopes', () => {
  const payload = buildConsentRecordPayload({
    user: { id: 'u' },
    schoolId: 's',
    role: 'TEACHER',
    acceptances: { general: true, sensitive: false },
  });
  assert.deepEqual(payload.accepted_scopes, [CONSENT_SCOPES.GENERAL]);
  assert.equal(payload.accepted_sensitive_minor_data, false);
});
