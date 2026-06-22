import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// The premium table treatment is a theme-aware component utility: sticky
// uppercase header, zebra striping and a brand hover — keyed off theme tokens,
// not hardcoded greys.
test('.ui-table is defined and theme-aware', () => {
  const css = read('src/index.css');
  assert.match(css, /\.ui-table\b/);
  assert.match(css, /\.ui-table thead th[\s\S]*position: sticky/);
  assert.match(css, /\.ui-table tbody tr:nth-child\(even\)/); // zebra
  assert.match(css, /\.ui-table tbody tr:hover[\s\S]*hsl\(var\(--accent\)/); // brand-ish hover
});

// Native form fields share the tenant-brand focus ring (matching Input/Select).
test('.ui-field focuses with the tenant brand ring', () => {
  const css = read('src/index.css');
  assert.match(css, /\.ui-field:focus[\s\S]*rgb\(var\(--tenant-primary-rgb\)\)/);
  assert.doesNotMatch(css.match(/\.ui-field[\s\S]*?\}/)?.[0] ?? '', /#[0-9a-fA-F]{6}/);
});

// The governance matrix (PermisosRoles) adopts the premium table + native
// field treatment and tints its checkboxes with the brand.
test('PermisosRoles adopts the premium table/field/checkbox treatment', () => {
  const src = read('src/pages/PermisosRoles.jsx');
  assert.match(src, /className="ui-table min-w-full"/);
  assert.match(src, /className="ui-field"/);
  assert.match(src, /accent-brand/);
  // The old hardcoded native-select class is fully replaced.
  assert.doesNotMatch(src, /h-10 rounded-md border border-border px-3 text-sm/);
});

// The audit log is genuinely tabular; it now renders as a compact .ui-table
// with the JSON context tucked behind a collapsible cell.
test('AuditoriaAdmin renders the audit log as a premium table', () => {
  const src = read('src/pages/AuditoriaAdmin.jsx');
  assert.match(src, /className="ui-table/);
  assert.match(src, /<details>/); // context is collapsible, keeping rows compact
  assert.match(src, /colSpan=\{7\}/); // empty state spans the table
});

// Remaining hand-styled native selects (Reportes filters) adopt .ui-field.
test('Reportes filters adopt the .ui-field native control', () => {
  const src = read('src/pages/Reportes.jsx');
  assert.match(src, /className="ui-field"/);
  assert.doesNotMatch(src, /bg-card border border-border rounded-lg px-3 py-2 text-sm/);
});
