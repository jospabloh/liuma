import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// Icon-only buttons have no visible text, so they need an aria-label for
// screen-reader users. These are the icon-only controls flagged by the
// navigation/accessibility audit.
const ICON_BUTTON_LABELS = [
  ['src/components/ui/PageHeader.jsx', 'Volver'],
  ['src/pages/Avisos.jsx', 'Filtrar avisos'],
  ['src/pages/CalendarioEscolar.jsx', 'Eliminar evento'],
  ['src/pages/CalendarioEscolar.jsx', 'Mes anterior'],
  ['src/pages/CalendarioEscolar.jsx', 'Mes siguiente'],
  ['src/pages/Bitacora.jsx', 'Día anterior'],
  ['src/pages/Bitacora.jsx', 'Día siguiente'],
  ['src/pages/PedidosUniformes.jsx', 'Quitar artículo'],
  ['src/pages/ContactosEmergencia.jsx', 'Eliminar contacto'],
];

for (const [file, label] of ICON_BUTTON_LABELS) {
  test(`${file} labels its icon-only button "${label}"`, () => {
    const source = read(file);
    assert.match(source, new RegExp(`aria-label="${label}"`));
  });
}

// The PageHeader back button is the primary orientation control on every deep
// page; it must be labeled.
test('PageHeader back button is labeled before its ArrowLeft icon', () => {
  const source = read('src/components/ui/PageHeader.jsx');
  assert.match(source, /aria-label="Volver"[\s\S]*ArrowLeft/);
});

// EmptyState must respect prefers-reduced-motion like the rest of the app's
// animated chrome.
test('EmptyState honors reduced motion', () => {
  const source = read('src/components/ui/EmptyState.jsx');
  assert.match(source, /useReducedMotion/);
  assert.match(source, /initial=\{reduceMotion \? false :/);
});
