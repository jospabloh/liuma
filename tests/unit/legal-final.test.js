// The legal texts went from BORRADOR to vigente on 2026-10-02 (owner decision;
// research in docs/legal-research-2026-10.md). What makes a final text worth
// more than the draft is that it can be held to what it says, so these tests
// pin the things a reader — or the Secretaría Anticorrupción y Buen Gobierno —
// would check first: who ACACIA is, which version a consent recorded, that
// every kind of data LIUMA stores is disclosed, and that nothing it promises
// contradicts what its own providers publish.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  PRIVACY_NOTICE_STATUS,
  PRIVACY_NOTICE_VERSION,
  SERVICE_TERMS_VERSION,
  TERMS_VERSION,
} from '../../src/lib/consent/privacyNotice.js';
import {
  ACACIA_LEGAL_IDENTITY,
  ACCOUNT_DELETION_LABEL,
  AI_MODEL_PROVIDERS,
  ARCO_RESPONSE_DAYS,
  BASE44_AI_TRAINING_EXCLUDED,
  DATA_PROCESSORS,
  ENTITY_DATA_CATEGORIES,
  LEGAL_DOCUMENTS,
  LEGAL_EFFECTIVE_DATE,
  PRIVACY_NOTICE,
  RETENTION_TABLE,
  SERVICE_TERMS,
  legalDocumentText,
} from '../../src/lib/legal/legalDocs.js';

const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const aviso = legalDocumentText(PRIVACY_NOTICE);
const terminos = legalDocumentText(SERVICE_TERMS);

// ── No draft left ─────────────────────────────────────────────────────────────

test('no BORRADOR survives in the legal texts, their page, their versions or their docs', () => {
  assert.equal(PRIVACY_NOTICE_STATUS, 'vigente');
  for (const doc of LEGAL_DOCUMENTS) {
    assert.doesNotMatch(legalDocumentText(doc), /borrador|pendiente de revisi[oó]n legal/i, doc.id);
    assert.equal(doc.status, 'vigente', doc.id);
    assert.equal(doc.effectiveDate, '2 de octubre de 2026', doc.id);
  }
  for (const file of [
    'src/lib/legal/legalDocs.js',
    'src/lib/consent/privacyNotice.js',
    'src/components/legal/LegalDocumentPage.jsx',
    'docs/aviso-de-privacidad.md',
  ]) {
    assert.doesNotMatch(read(file), /borrador/i, file);
  }
  assert.equal(LEGAL_EFFECTIVE_DATE, '2 de octubre de 2026');
});

// ── Versions: client, server and the two documents agree ─────────────────────

test('the notice and terms versions are equal, dated, and mirrored by the server', () => {
  assert.equal(PRIVACY_NOTICE_VERSION, '2026-10-02');
  assert.equal(SERVICE_TERMS_VERSION, PRIVACY_NOTICE_VERSION);
  assert.equal(TERMS_VERSION, SERVICE_TERMS_VERSION);
  assert.equal(PRIVACY_NOTICE.version, PRIVACY_NOTICE_VERSION);
  assert.equal(SERVICE_TERMS.version, SERVICE_TERMS_VERSION);
  // provisionOnboardingProfile rejects any other version: if the server kept
  // the draft's version, every new onboarding would fail with 409.
  const fn = read('base44/functions/provisionOnboardingProfile/entry.ts');
  assert.match(fn, new RegExp(`const PRIVACY_NOTICE_VERSION = '${PRIVACY_NOTICE_VERSION}';`));
  assert.match(fn, new RegExp(`const TERMS_VERSION = '${TERMS_VERSION}';`));
  // Each document states its own version and date to the reader.
  assert.ok(aviso.includes(`Versión ${PRIVACY_NOTICE_VERSION}`));
  assert.ok(terminos.includes(`Versión ${SERVICE_TERMS_VERSION}`));
});

// ── Identity ─────────────────────────────────────────────────────────────────

test('ACACIA is identified as the persona moral on its Constancia de Situación Fiscal', () => {
  assert.deepEqual({ ...ACACIA_LEGAL_IDENTITY }, {
    legalName: 'ACACIA CONSULTORIA EN INFORMATICA Y COMPUTO, S.A. de C.V.',
    tradeName: 'ACACIA',
    rfc: 'ACI1902061S9',
    address: 'Calle Arroyo El Molino 1001, Int. 102, Col. San Telmo, C.P. 20115, Aguascalientes, Aguascalientes, México',
    email: 'contacto@acaciaco.com.mx',
    website: 'https://acaciaco.com.mx',
  });
  assert.ok(Object.isFrozen(ACACIA_LEGAL_IDENTITY));
  // LFPDPPP art. 15 I: identity and domicile, in both documents.
  for (const text of [aviso, terminos]) {
    for (const value of Object.values(ACACIA_LEGAL_IDENTITY)) assert.ok(text.includes(value), value);
  }
  // Typed once: every mention reads the constant, so a change of address is a
  // one-line edit and cannot leave a stale copy in some paragraph.
  const src = read('src/lib/legal/legalDocs.js');
  for (const value of [ACACIA_LEGAL_IDENTITY.rfc, ACACIA_LEGAL_IDENTITY.address, ACACIA_LEGAL_IDENTITY.website]) {
    assert.equal(src.split(value).length - 1, 1, `${value} must appear once in legalDocs.js`);
  }
});

test('no natural person\'s RFC or CURP is published in any legal text', () => {
  // Persona física RFC = 4 letters + 6 digits + 3 (a persona moral has 3 letters).
  const personRfc = /\b[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}\b/;
  const curp = /\b[A-Z]{4}\d{6}[HMX][A-Z]{5}[A-Z0-9]\d\b/;
  const sources = [
    aviso,
    terminos,
    read('src/lib/legal/legalDocs.js'),
    read('docs/legal-research-2026-10.md'),
    read('docs/aviso-de-privacidad.md'),
  ];
  for (const text of sources) {
    assert.doesNotMatch(text, personRfc);
    assert.doesNotMatch(text, curp);
  }
});

// ── Every entity is disclosed ─────────────────────────────────────────────────

test('every entity in base44/entities has a data category, and the notice names it', () => {
  const entities = fs.readdirSync(new URL('../../base44/entities/', import.meta.url))
    .filter((f) => f.endsWith('.jsonc'))
    .map((f) => f.replace(/\.jsonc$/, ''))
    .sort();
  assert.deepEqual(Object.keys(ENTITY_DATA_CATEGORIES).sort(), entities,
    'add the new entity to ENTITY_DATA_CATEGORIES and describe it in the Aviso de Privacidad');
  for (const [entity, phrase] of Object.entries(ENTITY_DATA_CATEGORIES)) {
    assert.ok(aviso.includes(phrase), `${entity}: the notice must mention "${phrase}"`);
  }
});

test('the sensitive fields of Student are named as sensitive, with the parents\' express consent', () => {
  const student = JSON.parse(read('base44/entities/Student.jsonc').replace(/^\s*\/\/.*$/gm, ''));
  for (const field of ['blood_type', 'allergies', 'medical_notes']) assert.ok(student.properties[field], field);
  assert.match(aviso, /Datos sensibles de los alumnos: tipo de sangre, alergias y notas médicas/);
  assert.match(aviso, /consentimiento expreso y por escrito de la madre, padre o tutor/);
  assert.match(aviso, /art\. 8 de la Ley/);
});

// ── Retention, ARCO, deletion ────────────────────────────────────────────────

test('retention is a concrete table: days, a legal basis, and the fiscal five years', () => {
  assert.ok(RETENTION_TABLE.length >= 6);
  for (const row of RETENTION_TABLE) {
    assert.ok(row.data && row.period && row.basis, row.data);
    assert.ok(row.days === null || (Number.isInteger(row.days) && row.days > 0), row.data);
  }
  const fiscal = RETENTION_TABLE.find((r) => /Código Fiscal de la Federación, art\. 30/.test(r.basis));
  assert.equal(fiscal?.days, 1825);
  assert.ok(RETENTION_TABLE.some((r) => /72 meses/.test(r.period) && r.days === 6 * 365), '72-month cap, art. 10');
  assert.ok(RETENTION_TABLE.some((r) => /Lumi/.test(r.data)), 'Lumi conversations have a period');
  assert.ok(RETENTION_TABLE.some((r) => /respaldo/i.test(r.data)), 'backups are covered');
  assert.ok(PRIVACY_NOTICE.sections.find((s) => s.id === 'conservacion').table, 'the page renders the table');
});

test('ARCO: 20 business days, the contact, revocation and the in-app account deletion', () => {
  assert.equal(ARCO_RESPONSE_DAYS, 20);
  assert.match(aviso, /20 días hábiles/);
  assert.match(aviso, /revocar en cualquier momento tu consentimiento/);
  assert.ok(aviso.includes(`"${ACCOUNT_DELETION_LABEL}"`));
  assert.ok(terminos.includes(`"${ACCOUNT_DELETION_LABEL}"`));
  assert.match(aviso, /Secretaría Anticorrupción y Buen Gobierno/);
  assert.doesNotMatch(aviso + terminos, /\bINAI\b/, 'the INAI no longer exists (LFPDPPP 2025, transitorio Cuarto)');
});

// ── Providers and AI ─────────────────────────────────────────────────────────

test('the AI providers Base44 publishes are named, and the US transfer is disclosed', () => {
  for (const { name, models } of AI_MODEL_PROVIDERS) {
    assert.ok(DATA_PROCESSORS.some((p) => p.name === name), `${name} is a listed processor`);
    assert.ok(aviso.includes(`${name} (${models})`), `${name} named with its model in the Lumi section`);
  }
  assert.match(aviso, /Estados Unidos/);
  assert.match(aviso, /SOC 2 Tipo II/);
  assert.match(aviso, /ISO\/IEC 27001/);
  // Lumi runs on "automatic": Base44, not LIUMA, chooses the model. If someone
  // pins a single model, the notice can (and should) name only that provider.
  const lumi = JSON.parse(read('base44/agents/lumi.jsonc').replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(lumi.model, 'automatic', 'model pinned: update AI_MODEL_PROVIDERS and this test');
});

test('the notice never promises "no AI training" unless Base44\'s exclusion is in place', () => {
  // Base44's own docs: outside Enterprise, app data "can be used to train AI
  // models". The draft promised the opposite; a final text cannot.
  if (BASE44_AI_TRAINING_EXCLUDED) {
    assert.match(aviso, /Base44 no usa los datos de LIUMA para entrenar/);
  } else {
    assert.match(aviso, /Base44 informa públicamente que, salvo en su plan Enterprise, puede usar los datos/);
    assert.doesNotMatch(aviso, /no autoriza al proveedor a usar esa información para fines propios ni para entrenar/);
    assert.doesNotMatch(aviso, /Base44 no usa los datos de LIUMA para entrenar/);
  }
});

// ── Terms: liability and jurisdiction ────────────────────────────────────────

test('the liability cap carves out what Mexican law does not let a contract waive', () => {
  const clause = SERVICE_TERMS.sections.find((s) => s.id === 'responsabilidad').items.join('\n');
  assert.match(clause, /doce meses/);
  assert.match(clause, /dolo o culpa grave/);
  assert.match(clause, /art\. 2106/);
  assert.match(clause, /protección de datos personales/);
  assert.match(clause, /no son renunciables/);
  assert.match(clause, /Ley Federal de Protección al Consumidor/);
  assert.match(clause, /daño moral/);
});

test('Mexican law and the courts of Aguascalientes, Ags.', () => {
  const clause = SERVICE_TERMS.sections.find((s) => s.id === 'jurisdiccion').paragraphs.join('\n');
  assert.match(clause, /leyes de los Estados Unidos Mexicanos/);
  assert.match(clause, /tribunales competentes de la ciudad de Aguascalientes, Aguascalientes/);
  assert.match(clause, /Código de Comercio, art\. 1093/);
});
