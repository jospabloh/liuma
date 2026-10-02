import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  PRIVACY_NOTICE_URL,
  PRIVACY_NOTICE_PATH,
  PRIVACY_NOTICE_VERSION,
  PRIVACY_NOTICE_STATUS,
  SERVICE_TERMS_PATH,
  SERVICE_TERMS_VERSION,
} from '../../src/lib/consent/privacyNotice.js';
import {
  PRIVACY_NOTICE,
  SERVICE_TERMS,
  DATA_PROCESSORS,
  processorNames,
  legalDocumentText,
} from '../../src/lib/legal/legalDocs.js';
import { TRIAL_DURATION_DAYS, PLAN_TIERS, PLAN_CATALOG } from '../../src/lib/license/licenseModel.js';
import { HELP_SECTIONS, filterHelpSections, normalizeForSearch } from '../../src/lib/help/helpContent.js';
import { ROUTE_ACCESS, canAccessRoute } from '../../src/lib/authorization/routeAccess.js';
import { getDestinations, ROLES } from '../../src/components/nav/navRegistry.js';

const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

// Everything a reader sees, tables and processor cards included.
const docText = legalDocumentText;

// ── The consent link must land on a page that exists ─────────────────────────
// The audit's critical finding: the LFPDPPP checkbox linked to a URL that fell
// through to PageNotFound, so parents "consented" to a notice nobody could read.

test('the onboarding consent link points at the in-app privacy route', () => {
  assert.equal(PRIVACY_NOTICE_URL, PRIVACY_NOTICE_PATH);
  assert.equal(PRIVACY_NOTICE.path, PRIVACY_NOTICE_PATH);
  assert.match(PRIVACY_NOTICE_PATH, /^\/[a-z-]+$/, 'relative path, so it works on base44.app and any custom domain');
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  assert.match(onboarding, /href=\{PRIVACY_NOTICE_URL\}/, 'the checkbox link must use the shared constant');
});

test('App.jsx mounts the legal pages publicly, before the auth/profile gate', () => {
  const app = read('src/App.jsx');
  assert.match(app, /PUBLIC_LEGAL_DOCS = \[PRIVACY_NOTICE, SERVICE_TERMS\]/);
  const legalRoutes = app.indexOf('PUBLIC_LEGAL_DOCS.map');
  const authCatchAll = app.indexOf('<Route path="*" element={<AuthenticatedApp />} />');
  assert.ok(legalRoutes > 0 && authCatchAll > 0, 'both route blocks present');
  assert.ok(legalRoutes < authCatchAll, 'legal routes must match before the authenticated catch-all');
  // A GuardedRoute would deny a user with no profile — exactly who reads this.
  assert.equal(ROUTE_ACCESS.AvisoPrivacidad, undefined);
  const pagesConfig = read('src/pages.config.js');
  assert.doesNotMatch(pagesConfig, /aviso-de-privacidad|LegalDocumentPage/);
});

// ── Final status, pinned by the version string ───────────────────────────────

test('the legal texts are vigente, and the page shows the date they took effect', () => {
  assert.equal(PRIVACY_NOTICE_STATUS, 'vigente');
  // The version is what onboarding shows next to the checkbox and what every
  // consent row pins: a consent given to the 2026-09-29 draft stays identifiable.
  assert.doesNotMatch(PRIVACY_NOTICE_VERSION, /borrador/);
  assert.doesNotMatch(SERVICE_TERMS_VERSION, /borrador/);
  assert.notEqual(PRIVACY_NOTICE_VERSION, '2026-09-29-borrador');
  const page = read('src/components/legal/LegalDocumentPage.jsx');
  assert.doesNotMatch(page, /isDraft|reviewNotes|BORRADOR/);
  assert.match(page, /Vigente desde el \{doc\.effectiveDate\}/);
  assert.equal(PRIVACY_NOTICE.effectiveDate, '2 de octubre de 2026');
  assert.equal(SERVICE_TERMS.effectiveDate, '2 de octubre de 2026');
  assert.equal(PRIVACY_NOTICE.reviewNotes, undefined);
  assert.equal(SERVICE_TERMS.reviewNotes, undefined);
});

// ── What the privacy notice has to say ───────────────────────────────────────

test('the privacy notice covers what a Mexican school compliance review asks for', () => {
  const text = normalizeForSearch(docText(PRIVACY_NOTICE));
  const required = {
    'school as responsable': /la escuela.*es la responsable/,
    'ACACIA as encargado': /encargado/,
    'minors': /menores de edad/,
    'sensitive health data': /tipo de sangre.*alergias.*notas medicas/,
    'express consent': /consentimiento expreso/,
    'ARCO rights': /arco/,
    'retention': /conserv/,
    'AI assistant disclosure': /lumi/,
    'no advertising / no sale': /no (vendemos|usa los datos para publicidad)/,
  };
  for (const [what, pattern] of Object.entries(required)) {
    assert.match(text, pattern, `notice must cover: ${what}`);
  }
});

test('every data processor is named, including the AI provider', () => {
  const names = processorNames();
  for (const expected of ['Base44', 'Anthropic']) {
    assert.ok(names.includes(expected), `${expected} must be disclosed`);
  }
  // Name only processors LIUMA actually uses. Every email goes through Base44's
  // Core.SendEmail; if a function ever calls Resend directly, it must be named.
  const functionsDir = new URL('../../base44/functions/', import.meta.url);
  const usesResend = fs.readdirSync(functionsDir).some((fn) => {
    const entry = new URL(`${fn}/entry.ts`, functionsDir);
    return fs.existsSync(entry) && /api\.resend\.com|from ['"](npm:)?resend/.test(fs.readFileSync(entry, 'utf8'));
  });
  assert.equal(names.includes('Resend'), usesResend, 'Resend is named if and only if a function calls it');
  assert.ok(PRIVACY_NOTICE.sections.some((s) => s.processors), 'a section must render the processor list');
  for (const p of DATA_PROCESSORS) assert.ok(p.role && p.location, `${p.name} needs a purpose and a location`);
});

// ── Terms agree with the app's own commercial model ──────────────────────────

test('the service terms quote the trial length and plans from licenseModel', () => {
  const text = docText(SERVICE_TERMS);
  assert.match(text, new RegExp(`${TRIAL_DURATION_DAYS} días`));
  for (const tier of PLAN_TIERS) {
    assert.ok(text.includes(PLAN_CATALOG[tier].label), `${tier} listed`);
    assert.ok(text.includes(PLAN_CATALOG[tier].price), `${tier} price matches the catalog`);
  }
  assert.match(text, /Mercado Pago/);
  assert.doesNotMatch(text, /Stripe/);
});

test('the terms promise read-only, not deletion, when a license is unpaid', () => {
  const text = normalizeForSearch(docText(SERVICE_TERMS));
  assert.match(text, /solo lectura/);
  assert.match(text, /descargar/);
  assert.match(text, /no existe una licencia activa/, 'missing subscription fails closed (owner decision 2026-09-29)');
});

// ── In-app help (Ayuda) ──────────────────────────────────────────────────────

test('Ayuda is a route every role can open and is in every role\'s menu', () => {
  for (const role of [ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT]) {
    assert.equal(canAccessRoute({ role, routeName: 'Ayuda' }), true, role);
    assert.ok(getDestinations(role).some((d) => d.page === 'Ayuda'), `${role} nav lists Ayuda`);
  }
  assert.match(read('src/pages.config.js'), /"Ayuda": Ayuda/);
});

test('help never sends a reader to a page their role cannot open', () => {
  for (const section of HELP_SECTIONS) {
    for (const role of section.roles) {
      for (const page of section.pages) {
        assert.equal(
          canAccessRoute({ role, routeName: page }), true,
          `"${section.title}" points ${role} at /${page}, which routeAccess denies`,
        );
      }
    }
  }
});

test('help has first steps and a quick guide for each role', () => {
  for (const role of [ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT]) {
    const titles = filterHelpSections({ role }).map((s) => s.title);
    assert.ok(titles.some((t) => /^Primeros pasos/.test(t)), `${role} gets primeros pasos`);
    assert.ok(titles.some((t) => /^Guía rápida/.test(t)), `${role} gets a quick guide`);
  }
  // A parent does not see the director's setup steps.
  assert.ok(!filterHelpSections({ role: ROLES.PARENT }).some((s) => s.id === 'primeros-pasos-direccion'));
});

test('help search ignores accents and case and requires every word', () => {
  const hits = filterHelpSections({ role: ROLES.TEACHER, query: 'BITACORA' });
  assert.ok(hits.some((s) => s.id === 'guia-maestro'));
  assert.equal(filterHelpSections({ role: ROLES.TEACHER, query: 'bitacora zzzz' }).length, 0);
});

test('help and manual no longer describe the removed school switcher', () => {
  const help = normalizeForSearch(JSON.stringify(HELP_SECTIONS));
  assert.doesNotMatch(help, /unirme a otra escuela|cambiar de escuela/);
  const manual = read('USER_MANUAL.md');
  assert.doesNotMatch(manual, /Unirme a otra escuela/);
  assert.match(manual, /## 2c\. Una cuenta, una escuela/);
  assert.match(manual, /## 0\. Primeros pasos/);
  // The manual must not claim consent is stored in an entity that does not exist.
  assert.doesNotMatch(manual, /se registra \(`ConsentRecord`/);
  // Nor claim a notification-preferences screen that does not exist.
  assert.doesNotMatch(manual, /preferencias de canal se administran/);
});

// ── docs/authorization-matrix.md cannot drift from ROUTE_ACCESS ──────────────

test('the documented route matrix matches ROUTE_ACCESS exactly', () => {
  const doc = read('docs/authorization-matrix.md');
  const documented = {};
  for (const line of doc.split('\n')) {
    const m = line.match(/^\| \/([A-Za-z]+) \| (✓|—) \| (✓|—) \| (✓|—) \|/);
    if (!m) continue;
    const [, route, a, t, p] = m;
    assert.equal(documented[route], undefined, `/${route} listed twice`);
    documented[route] = [['ADMIN', a], ['TEACHER', t], ['PARENT', p]].filter(([, v]) => v === '✓').map(([r]) => r);
  }
  assert.deepEqual(Object.keys(documented).sort(), Object.keys(ROUTE_ACCESS).sort(), 'same set of routes');
  for (const [route, roles] of Object.entries(ROUTE_ACCESS)) {
    assert.deepEqual(documented[route], [...roles].sort((x, y) => ['ADMIN', 'TEACHER', 'PARENT'].indexOf(x) - ['ADMIN', 'TEACHER', 'PARENT'].indexOf(y)), `/${route} roles`);
  }
  assert.match(doc, new RegExp(`\\| ${PRIVACY_NOTICE_PATH} \\|`), 'public privacy route documented');
  assert.match(doc, new RegExp(`\\| ${SERVICE_TERMS_PATH} \\|`), 'public terms route documented');
});
