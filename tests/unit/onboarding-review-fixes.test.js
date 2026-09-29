// Guards for the defects the adversarial review of the onboarding / license
// package found (2026-09-29). Each one passed the original suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unwrapFunctionResponse } from '../../src/lib/functionResponse.js';
import {
  INVITE_CODE_STORAGE_KEY,
  forgetInviteCode,
  readRememberedInviteCode,
  rememberInviteCode,
} from '../../src/lib/onboarding/joinCode.js';
import { completeOnboardingTenantCreation } from '../../src/lib/onboardingTenantCreation.js';
import { licenseNoticeCopy } from '../../src/lib/license/licenseNoticeCopy.js';
import { createOnboardingBackend, FULL_CONSENT } from '../fixtures/onboarding-backend.js';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const code = (p) => read(p).replace(/^\s*\/\/.*$/gm, '');

test('functions.invoke resolves to the axios response: call sites read the body from .data', () => {
  // The SDK's functions client is built with interceptResponses:false.
  const body = { ok: true, subscription: { subscription_status: 'active' } };
  assert.deepEqual(unwrapFunctionResponse({ data: body, status: 200, headers: {} }), body);
  // A bare body (a future SDK, or a test double) passes through untouched.
  assert.deepEqual(unwrapFunctionResponse(body), body);
  assert.equal(unwrapFunctionResponse(undefined), undefined);

  // Without the unwrap every school read `result.subscription` as undefined →
  // "no license" → read-only; onboarding lost its schoolId; export always failed.
  for (const [file, fn] of [
    ['src/hooks/useSubscription.js', 'getMySubscription'],
    ['src/lib/onboardingTenantCreation.js', 'provisionOnboardingProfile'],
    ['src/pages/PermisosRoles.jsx', 'exportSchoolData'],
  ]) {
    // Since integration: invokeFunction (src/lib/functionResponse.js) is the one wrapper.
    assert.match(code(file), new RegExp(`invokeFunction\\(base44, '${fn}'`), `${file} unwraps ${fn}`);
  }
});

test('the SDK really does skip response unwrapping for functions (so the helper is not decoration)', () => {
  let client;
  try {
    client = read('node_modules/@base44/sdk/dist/client.js');
  } catch {
    return; // SDK not installed in this environment
  }
  const functionsClient = client.slice(client.indexOf('const functionsAxiosClient'), client.indexOf('const serviceRoleHeaders'));
  assert.match(functionsClient, /interceptResponses: false/);
});

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

test('an invitation code survives the sign-in redirect (which drops the query string)', () => {
  const storage = memoryStorage();
  assert.equal(rememberInviteCode('?codigo=abcd-efgh', storage), 'ABCD-EFGH');
  assert.equal(storage.map.get(INVITE_CODE_STORAGE_KEY), 'ABCD-EFGH');
  // Later loads without ?codigo= don't wipe it…
  assert.equal(rememberInviteCode('', storage), '');
  assert.equal(readRememberedInviteCode(storage), 'ABCD-EFGH');
  // …onboarding success does.
  forgetInviteCode(storage);
  assert.equal(readRememberedInviteCode(storage), '');
  // Blocked storage never throws.
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(rememberInviteCode('?codigo=ABCDEFGH', broken), 'ABCD-EFGH');
  assert.equal(readRememberedInviteCode(broken), '');
  forgetInviteCode(broken);

  assert.match(code('src/main.jsx'), /rememberInviteCode\(window\.location\.search\)/);
  const ui = code('src/components/onboarding/Onboarding.jsx');
  assert.match(ui, /readRememberedInviteCode\(\)/);
  assert.match(ui, /forgetInviteCode\(\)/);
});

test('a legacy school id typed into the (upper-casing) form still resolves', async () => {
  const school = { id: '696e9b34b4402eca67ec8612', name: 'Colegio', created_by_user_id: 'x' };
  const parent = { id: 'user-parent', email: 'p@example.com', full_name: 'P' };
  const { client } = createOnboardingBackend({ schools: [school] }, parent);
  const result = await completeOnboardingTenantCreation({
    base44: client,
    notificationService: { sendByEvent: async () => {} },
    logAuditEvent: async () => {},
    user: parent,
    formData: { role: 'PARENT', schoolCode: '696E9B34B4402ECA67EC8612' },
    logoFile: null,
    themePreview: null,
    consent: FULL_CONSENT,
  });
  assert.equal(result.schoolId, school.id);
  assert.match(read('base44/functions/provisionOnboardingProfile/entry.ts'), /String\(rawCode \|\| ''\)\.trim\(\)\.toLowerCase\(\)/);
});

test('onboarding errors without an inline slot fall back to the form-level alert', () => {
  const ui = code('src/components/onboarding/Onboarding.jsx');
  assert.match(ui, /\['schoolCode', 'newSchoolName', 'consent'\]\.includes\(mappedError\.field\) \? mappedError\.field : 'submit'/);
});

test('teachers and parents are never told to renew or pay themselves', () => {
  for (const kind of ['renewal_upcoming', 'active_overdue', 'trial_ending', 'read_only', 'missing']) {
    const copy = licenseNoticeCopy({ kind, daysLeft: 3, effective: { reason: kind } }, { isAdmin: false });
    assert.equal(copy.showPay, false, kind);
    assert.match(copy.body, /dirección de tu escuela/, kind);
    assert.doesNotMatch(copy.body, /^Renueva|Si ya pagaste/, kind);
  }
});

test('the school palette is read through getMySubscription, not the platform-only School entity', () => {
  const runtime = code('src/components/theme/TenantThemeRuntime.jsx');
  assert.doesNotMatch(runtime, /entities\.School/);
  assert.match(runtime, /useSubscription\(\)/);
});

test('the privacy notice lists what the entities actually hold, and Lumi as an AI use by families too', async () => {
  // Single legal source since integration: P11's legalDocs.js.
  const { PRIVACY_NOTICE } = await import('../../src/lib/legal/legalDocs.js');
  const text = JSON.stringify(PRIVACY_NOTICE);
  for (const needle of ['domicilio', 'ocupación', 'Contactos de emergencia', 'dirección IP', 'Lumi', 'bitácora diaria', 'su motivo', 'medidas']) {
    assert.ok(text.includes(needle), `aviso mentions ${needle}`);
  }
  assert.doesNotMatch(text, /cuando el personal decide usarlas|por el personal/, 'families use Lumi too');
});
