// v1.9.0 — 44px for a finger, measured, not guessed.
//
// scripts/touch-targets-scan.mjs walks the main screens of each role at 320
// and 390 px in Chromium with a coarse pointer (mocked backend) and hit-tests
// every interactive element under 44x44. Its first run found: the corner
// theme switcher (42px, on every screen), sonner's toast close (42px: the
// ::after started from the padding box), the Layout footer link (16px tall,
// on every screen), Reportes' four "Ver detalle" (20px) and Ayuda's footer
// links. The calendar's day cells were ~37px wide at 320. These pin the fixes
// the second run passed with; re-run the scan after moving any of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('the shared theme switcher is 44px by default, sized by CSS variables', () => {
  const src = read('src/components/ThemeSwitcher.jsx');
  // Canonical file (jospabloh/acacia-app-standard shared/theme): change it
  // there and copy it here byte for byte.
  assert.match(src, /const SLOT = 'var\(--theme-switcher-slot, 44px\)';/);
  assert.match(src, /const SIZE = 'var\(--theme-switcher-size, 44px\)';/);
  assert.match(src, /'absolute -inset-px flex items-center justify-center rounded-full/, 'the bubble covers the 1px border: inset-0 left it at 42');
  assert.doesNotMatch(src, /\bh-10\b/);
  // LIUMA keeps the smaller look only under a mouse.
  assert.match(read('src/index.css'), /@media \(pointer: fine\) \{\s*:root \{ --theme-switcher-size: 40px; --theme-switcher-slot: 34px; \}/);
});

test('toast close buttons give a finger 44px', () => {
  // sonner (the mounted toaster): 20px drawn, 18px padding box + 2 × 13px.
  assert.match(read('src/components/ui/sonner.jsx'), /after:absolute after:-inset-\[13px\]/);
  assert.equal(20 - 2 + 2 * 13, 44);
  // The shadcn toast (not mounted): 44px and visible on touch, not hover-only.
  const toast = read('src/components/ui/toast.jsx');
  assert.match(toast, /coarse:h-11 coarse:w-11 coarse:opacity-100/);
  assert.match(toast, /inline-flex h-8 coarse:h-11 shrink-0/);
});

test('links and toggles the scan caught are 44px tall on touch', () => {
  assert.match(read('src/Layout.jsx'), /className="inline-flex items-center coarse:min-h-11 coarse:px-2 [^"]*underline"\s*>\s*creado con cariño/);
  const reportes = read('src/pages/Reportes.jsx');
  assert.equal((reportes.match(/aria-expanded=\{openPanel === '\w+'\} className="[^"]*flex items-center gap-1 coarse:min-h-11"/g) || []).length, 4);
  const ayuda = read('src/pages/Ayuda.jsx');
  assert.equal((ayuda.match(/className="underline coarse:inline-flex coarse:min-h-11 coarse:items-center"/g) || []).length, 4);
});

test('the scan exists, mocks every request and fails under 44px', () => {
  const scan = read('scripts/touch-targets-scan.mjs');
  assert.match(scan, /const MIN = 44;/);
  assert.match(scan, /url\.pathname\.startsWith\('\/api\/'\)/, 'nothing reaches Base44');
  assert.match(scan, /isMobile: true, hasTouch: true/, 'coarse pointer, so coarse: variants apply');
  assert.match(scan, /process\.exit\(failing\.length \? 1 : 0\)/);
  for (const role of ['ADMIN', 'TEACHER', 'PARENT']) assert.match(scan, new RegExp(`${role}: \\['Home'`));
});
