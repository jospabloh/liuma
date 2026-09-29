// Consent is only worth something if (a) the notice it points to exists,
// (b) the version recorded is the one shown, and (c) a draft is never passed
// off as final (owner decision 2026-09-29; audit F26).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PRIVACY_NOTICE_IS_DRAFT,
  PRIVACY_NOTICE_URL,
  PRIVACY_NOTICE_VERSION,
  TERMS_URL,
  TERMS_VERSION,
} from '../../src/lib/consent/privacyNotice.js';
import { AVISO_PRIVACIDAD } from '../../src/lib/legal/avisoPrivacidad.js';
import { TERMINOS_SERVICIO } from '../../src/lib/legal/terminosServicio.js';
import { PLAN_CATALOG, PLAN_TIERS, TRIAL_DURATION_DAYS } from '../../src/lib/license/licenseModel.js';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const text = (doc) => JSON.stringify(doc);

test('the consent links point at in-app routes that App.jsx actually registers, signed in and out', () => {
  // It used to be an absolute URL to a page that did not exist.
  assert.equal(PRIVACY_NOTICE_URL, '/aviso-de-privacidad');
  assert.equal(TERMS_URL, '/terminos');
  const app = read('src/App.jsx');
  assert.match(app, /path=\{PRIVACY_NOTICE_URL\}/);
  assert.match(app, /path=\{TERMS_URL\}/);
  // {legalRoutes} appears in the remembered-user, signed-out and signed-in branches.
  assert.equal(app.match(/\{legalRoutes\}/g)?.length, 3);
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  assert.match(onboarding, /href=\{PRIVACY_NOTICE_URL\}/);
  assert.match(onboarding, /href=\{TERMS_URL\}/);
});

test('while the text is a draft, it says so on the page and in the code', () => {
  assert.equal(PRIVACY_NOTICE_IS_DRAFT, true);
  assert.match(PRIVACY_NOTICE_VERSION, /borrador/);
  assert.match(TERMS_VERSION, /borrador/);
  for (const file of ['src/lib/legal/avisoPrivacidad.js', 'src/lib/legal/terminosServicio.js']) {
    assert.match(read(file), /BORRADOR PENDIENTE DE REVISIÓN LEGAL/);
  }
  const page = read('src/components/legal/LegalDocumentPage.jsx');
  assert.match(page, /PRIVACY_NOTICE_IS_DRAFT && \(/);
  assert.match(page, /Borrador pendiente de revisión legal/);
});

test('the aviso covers what the LFPDPPP requires for minors\' sensitive data', () => {
  const t = text(AVISO_PRIVACIDAD);
  assert.match(t, /RESPONSABLE/, 'the school is the responsable');
  assert.match(t, /ENCARGADA/, 'ACACIA is the encargado');
  for (const needle of ['alergias', 'tipo de sangre', 'EXPRESO', 'Base44', 'Resend', 'Anthropic', 'ARCO', 'conservan', 'soporte@acaciaco.com.mx', 'revocar']) {
    assert.ok(t.includes(needle), `aviso must mention ${needle}`);
  }
});

test('the terms quote the trial and prices the app actually applies', () => {
  const t = text(TERMINOS_SERVICIO);
  assert.ok(t.includes(`${TRIAL_DURATION_DAYS} días naturales`));
  for (const tier of PLAN_TIERS) assert.ok(t.includes(PLAN_CATALOG[tier].price), `${tier} price`);
  assert.match(t, /SOLO LECTURA/);
  assert.match(t, /Mercado Pago/);
});

test('the server rejects any consent version but the one the client shows', () => {
  const fn = read('base44/functions/provisionOnboardingProfile/entry.ts');
  assert.match(fn, new RegExp(`const PRIVACY_NOTICE_VERSION = '${PRIVACY_NOTICE_VERSION}';`));
  assert.match(fn, new RegExp(`const TERMS_VERSION = '${TERMS_VERSION}';`));
  assert.match(fn, /consent\.noticeVersion !== PRIVACY_NOTICE_VERSION/);
});

test('ConsentRecord is append-only proof: only the service role writes, users read their own', () => {
  const schema = JSON.parse(read('base44/entities/ConsentRecord.jsonc').replace(/^\s*\/\/.*$/gm, ''));
  const serviceOnly = { user_condition: { role: '__service_role_only__' } };
  assert.deepEqual(schema.rls.create, serviceOnly);
  assert.deepEqual(schema.rls.update, serviceOnly);
  assert.deepEqual(schema.rls.delete, serviceOnly);
  assert.deepEqual(schema.rls.read, { $or: [{ user_condition: { role: 'admin' } }, { 'data.user_id': '{{user.id}}' }] });
  for (const f of ['user_id', 'school_id', 'notice_version', 'terms_version', 'accepted_sensitive_minor_data', 'accepted_at']) {
    assert.ok(schema.properties[f], `ConsentRecord.${f}`);
  }
});
