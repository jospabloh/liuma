import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('admin payments tile always links to setup and charge management', () => {
  const adminHome = read('src/components/home/AdminHome.jsx');

  assert.match(adminHome, /title="Pagos"[\s\S]*href=\{createPageUrl\('PagosAdmin'\)\}/);
  assert.doesNotMatch(adminHome, /Bloqueado: define conceptos base/);
  assert.doesNotMatch(adminHome, /paymentReady \?/);
});

test('footer copy is Spanish and uses a visible heart character', () => {
  const layout = read('src/Layout.jsx');

  assert.match(layout, /creado con cariño ❤ por ACACIA Consultoría/);
  assert.doesNotMatch(layout, /crafted with care|&lt;3|<3/);
});

test('absence request pages resolve school context from profiles instead of user.data', () => {
  const adminAbsences = read('src/pages/GestionAusencias.jsx');
  const parentAbsenceRequest = read('src/pages/SolicitarAusencia.jsx');

  assert.match(adminAbsences, /UserProfile\.filter\(\{ user_id: user\.id \}\)/);
  assert.doesNotMatch(adminAbsences, /user\??\.data|user\.data/);
  assert.match(parentAbsenceRequest, /student\?\.school_id \|\| userProfile\?\.school_id/);
  assert.doesNotMatch(parentAbsenceRequest, /school_id: user\.data\.school_id/);
});
