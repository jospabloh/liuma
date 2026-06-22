import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// The loading screen is one of the first things a user sees; it must ride the
// tenant brand token, not a hardcoded violet/indigo mark.
test('LoadingScreen is on-brand (no hardcoded hues, uses brand + theme surfaces)', () => {
  const src = read('src/components/ui/LoadingScreen.jsx');
  assert.match(src, /bg-brand/);
  assert.match(src, /text-brand/);
  assert.match(src, /bg-background/);
  assert.doesNotMatch(src, /violet|indigo|slate-/); // no hardcoded palette
});

// LoadingScreen respects reduced motion for the spinner.
test('LoadingScreen honors reduced motion', () => {
  const src = read('src/components/ui/LoadingScreen.jsx');
  assert.match(src, /useReducedMotion/);
  assert.match(src, /reduceMotion \? undefined : \{ rotate: 360 \}/);
});

// EmptyState uses the brand-tinted icon chip language shared with the nav rail
// and the home tiles.
test('EmptyState uses a brand-tinted icon chip', () => {
  const src = read('src/components/ui/EmptyState.jsx');
  assert.match(src, /bg-brand\/10/);
  assert.match(src, /text-brand/);
});

// Skeletons use the premium shimmer, defined as a theme-aware utility.
test('Skeleton uses the ui-shimmer utility', () => {
  const skeleton = read('src/components/ui/skeleton.jsx');
  assert.match(skeleton, /ui-shimmer/);
  const css = read('src/index.css');
  assert.match(css, /@keyframes ui-shimmer/);
  assert.match(css, /\.ui-shimmer::after/);
  assert.match(css, /hsl\(var\(--foreground\)/); // theme-aware, not hardcoded
});
