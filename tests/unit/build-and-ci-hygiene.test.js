import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import viteConfig, { vendorChunkFor } from '../../vite.config.js';

// Sales-readiness pass (2026-09-29, F38/F40). Each assertion below guards a
// way the build or CI used to look healthier than it was.

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// Vite's oversized-chunk warning was hidden by `logLevel: 'error'`, which is
// how an ~800 KB main chunk reached every parent's phone unnoticed.
test('vite build does not silence its own warnings', () => {
  assert.notEqual(viteConfig.logLevel, 'error');
  assert.notEqual(viteConfig.logLevel, 'silent');
  const limit = viteConfig.build?.chunkSizeWarningLimit ?? 500;
  assert.ok(limit <= 500, `chunkSizeWarningLimit raised to ${limit} KB; split the chunk instead`);
});

test('long-lived vendor code gets a stable chunk of its own', () => {
  assert.equal(viteConfig.build.rollupOptions.output.manualChunks, vendorChunkFor);
  assert.equal(vendorChunkFor('/app/node_modules/react-dom/cjs/react-dom.production.min.js'), 'vendor-react');
  assert.equal(vendorChunkFor('/app/node_modules/react/index.js'), 'vendor-react');
  assert.equal(vendorChunkFor('/app/node_modules/react-router/dist/index.mjs'), 'vendor-router');
  assert.equal(vendorChunkFor('/app/node_modules/@tanstack/query-core/build/modern/index.js'), 'vendor-query');
  assert.equal(vendorChunkFor('/app/node_modules/framer-motion/dist/es/index.mjs'), 'vendor-motion');
  // Windows-style ids resolve the same way.
  assert.equal(vendorChunkFor('C:\\app\\node_modules\\react\\index.js'), 'vendor-react');
});

// A package whose name merely starts like a vendor one must not be swept in.
test('vendor matching is by exact package name', () => {
  assert.equal(vendorChunkFor('/app/node_modules/react-markdown/index.js'), undefined);
  assert.equal(vendorChunkFor('/app/node_modules/react-day-picker/dist/index.js'), undefined);
  assert.equal(vendorChunkFor('/app/src/lib/react/whatever.js'), undefined);
});

// Libraries only some pages need must never be pinned into an eagerly loaded
// vendor chunk: that would put them back on the login screen's critical path.
test('lazy-only libraries are left out of the vendor buckets', () => {
  for (const pkg of ['jspdf', 'html2canvas', 'react-markdown', 'recharts']) {
    assert.equal(vendorChunkFor(`/app/node_modules/${pkg}/dist/index.js`), undefined, pkg);
  }
});

// `eslint --quiet` hid every warning, and the file globs skipped src/lib,
// src/hooks, src/api, App.jsx and main.jsx entirely.
test('lint covers all of src/ and does not hide warnings', async () => {
  const pkg = JSON.parse(read('package.json'));
  assert.doesNotMatch(pkg.scripts.lint, /--quiet/);

  const { default: eslintConfig } = await import('../../eslint.config.js');
  const main = eslintConfig[0];
  assert.deepEqual(main.files, ['src/**/*.{js,mjs,cjs,jsx}']);
  assert.ok(!main.ignores.some((g) => g.startsWith('src/lib')), 'src/lib must be linted');
  assert.equal(main.rules['react-hooks/exhaustive-deps'], 'warn');
});

// Nothing in CI looked at the deployed Deno functions before.
test('Deno CI lints and type-checks base44/functions', () => {
  const ci = read('.github/workflows/ci-deno.yml');
  assert.match(ci, /deno lint [^\n]*base44\/functions/);
  assert.match(ci, /deno check [^\n]*base44\/functions\/\*\/entry\.ts/);
});

