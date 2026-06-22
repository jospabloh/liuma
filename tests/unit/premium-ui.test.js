import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// The Card primitive is the app-wide surface; it should use the shared,
// theme-aware elevation rather than the flat default drop shadow.
test('Card uses the premium ui-elevation surface', () => {
  const src = read('src/components/ui/card.jsx');
  assert.match(src, /ui-elevation/);
  assert.doesNotMatch(src, /text-card-foreground shadow"/); // not the flat default
});

// The elevation utilities exist and are keyed off the theme foreground (so they
// adapt to light/dark) rather than a hardcoded grey.
test('elevation utilities are defined and theme-aware', () => {
  const css = read('src/index.css');
  assert.match(css, /\.ui-elevation\s*\{/);
  assert.match(css, /hsl\(var\(--foreground\)/);
});

// PageHeader gained an optional eyebrow (context label) without dropping the
// accessibility-critical controls the rest of the app relies on.
test('PageHeader supports an eyebrow and keeps its a11y controls', () => {
  const src = read('src/components/ui/PageHeader.jsx');
  assert.match(src, /eyebrow/);
  assert.match(src, /aria-label="Volver"/);
  assert.match(src, /aria-label="Buscar"/);
  assert.match(src, /onClick=\{openPalette\}/);
});

// The eyebrow tints with the tenant brand token, never a hardcoded hex.
test('PageHeader eyebrow rides the tenant brand token', () => {
  const src = read('src/components/ui/PageHeader.jsx');
  assert.match(src, /text-brand/);
  assert.doesNotMatch(src, /#[0-9a-fA-F]{6}/);
});
