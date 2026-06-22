import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}
function exists(path) {
  try { fs.accessSync(new URL(`../../${path}`, import.meta.url)); return true; } catch { return false; }
}

// The dev-only harness files exist and the npm entry points are wired.
test('preview harness files and scripts are present', () => {
  assert.ok(exists('preview.html'), 'preview.html');
  assert.ok(exists('src/preview/main.jsx'), 'src/preview/main.jsx');
  assert.ok(exists('src/preview/Gallery.jsx'), 'src/preview/Gallery.jsx');
  assert.ok(exists('scripts/capture-preview.mjs'), 'capture script');
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['preview:shots'], /PREVIEW=1 vite build/);
  assert.ok(pkg.devDependencies.playwright, 'playwright devDependency');
});

// The harness must never leak into the production build: the second entry is
// gated behind PREVIEW, so a normal `vite build` is byte-for-byte unchanged.
test('preview entry is gated behind PREVIEW in vite config', () => {
  const cfg = read('vite.config.js');
  assert.match(cfg, /process\.env\.PREVIEW/);
  assert.match(cfg, /preview\.html/);
});

// SideNav can only be rendered headless because the raw context is exported for
// the harness to mock (the app still uses NavProvider/useNav).
test('NavContext is exported for the harness to mock', () => {
  const src = read('src/components/nav/NavContext.jsx');
  assert.match(src, /export const NavContext = createContext/);
});

// The harness renders the REAL components (not re-implementations).
test('Gallery imports the real premium components', () => {
  const src = read('src/preview/Gallery.jsx');
  for (const imp of [
    "@/components/nav/SideNav",
    "@/components/ui/BigTile",
    "@/components/ui/EmptyState",
    "@/components/ui/LoadingScreen",
    "@/components/ui/dialog",
  ]) {
    assert.ok(src.includes(imp), `Gallery imports ${imp}`);
  }
});
