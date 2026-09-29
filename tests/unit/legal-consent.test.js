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
// One source for both texts since integration (P6 and P11 each wrote one):
// src/lib/legal/legalDocs.js, P11's reviewed version.
import { PRIVACY_NOTICE as AVISO_PRIVACIDAD, SERVICE_TERMS as TERMINOS_SERVICIO } from '../../src/lib/legal/legalDocs.js';
import { PLAN_CATALOG, PLAN_TIERS, TRIAL_DURATION_DAYS } from '../../src/lib/license/licenseModel.js';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const text = (doc) => JSON.stringify(doc);

test('the consent links point at in-app routes that App.jsx actually registers, signed in and out', () => {
  // It used to be an absolute URL to a page that did not exist.
  assert.equal(PRIVACY_NOTICE_URL, '/aviso-de-privacidad');
  assert.equal(TERMS_URL, '/terminos');
  assert.equal(AVISO_PRIVACIDAD.path, PRIVACY_NOTICE_URL);
  assert.equal(TERMINOS_SERVICIO.path, TERMS_URL);
  // Mounted once, in App's top-level <Routes>, BEFORE AuthenticatedApp — so
  // they answer signed in, signed out and for a remembered user alike.
  const app = read('src/App.jsx');
  assert.match(app, /const PUBLIC_LEGAL_DOCS = \[PRIVACY_NOTICE, SERVICE_TERMS\];/);
  const legalAt = app.indexOf('PUBLIC_LEGAL_DOCS.map(');
  const catchAllAt = app.indexOf('<Route path="*" element={<AuthenticatedApp />} />');
  assert.ok(legalAt > 0 && catchAllAt > legalAt, 'legal routes come before the authenticated catch-all');
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  assert.match(onboarding, /href=\{PRIVACY_NOTICE_URL\}/);
  assert.match(onboarding, /href=\{TERMS_URL\}/);
});

test('while the text is a draft, it says so on the page and in the code', () => {
  assert.equal(PRIVACY_NOTICE_IS_DRAFT, true);
  assert.match(PRIVACY_NOTICE_VERSION, /borrador/);
  assert.match(TERMS_VERSION, /borrador/);
  assert.match(read('src/lib/legal/legalDocs.js'), /BORRADOR PENDIENTE DE REVISIÓN LEGAL/);
  assert.equal(AVISO_PRIVACIDAD.isDraft, true);
  assert.equal(TERMINOS_SERVICIO.isDraft, true);
  const page = read('src/components/legal/LegalDocumentPage.jsx');
  assert.match(page, /doc\.isDraft && \(/);
  assert.match(page, /BORRADOR pendiente de revisión legal/);
});

test('the aviso covers what the LFPDPPP requires for minors\' sensitive data', () => {
  const t = text(AVISO_PRIVACIDAD);
  assert.match(t, /es la responsable/, 'the school is the responsable');
  assert.match(t, /actúa como encargado/, 'ACACIA is the encargado');
  // Resend is deliberately NOT listed: LIUMA never calls it (P11 review; see
  // tests/unit/help-and-legal.test.js for the "name only what the code uses" rule).
  for (const needle of ['alergias', 'tipo de sangre', 'consentimiento expreso', 'Base44', 'Anthropic', 'ARCO', 'conservan', 'contacto@acaciaco.com.mx', 'revocar']) {
    assert.ok(t.includes(needle), `aviso must mention ${needle}`);
  }
});

test('the terms quote the trial and prices the app actually applies', () => {
  const t = text(TERMINOS_SERVICIO);
  assert.ok(t.includes(`${TRIAL_DURATION_DAYS} días naturales`));
  for (const tier of PLAN_TIERS) assert.ok(t.includes(PLAN_CATALOG[tier].price), `${tier} price`);
  assert.match(t, /solo lectura/);
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
