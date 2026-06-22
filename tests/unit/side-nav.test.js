import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ROLES, getGroupedDestinations, getDestinations, isActivePath, pageUrl,
} from '../../src/components/nav/navRegistry.js';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// The desktop rail must reuse the single navigation source of truth, not
// duplicate the destination list.
test('SideNav reads destinations from navRegistry', () => {
  const src = read('src/components/nav/SideNav.jsx');
  assert.match(src, /getGroupedDestinations/);
  assert.match(src, /isActivePath/);
  assert.match(src, /from '\.\/navRegistry'/);
});

// Switching sections must be client-side (no reload), so it preserves router
// state and the React Query cache — the same property the 404 page guards.
test('SideNav navigates with client-side <Link>, never a hard reload', () => {
  const src = read('src/components/nav/SideNav.jsx');
  assert.match(src, /import \{ Link/);
  assert.match(src, /<Link\s+to=\{pageUrl/);
  assert.doesNotMatch(src, /window\.location\.href\s*=/);
});

// The active item carries an accent indicator and aria-current, mirroring the
// bottom bar's brand indicator.
test('SideNav marks the active item with an accent border and aria-current', () => {
  const src = read('src/components/nav/SideNav.jsx');
  assert.match(src, /border-brand/);
  assert.match(src, /aria-current=\{.*'page'/);
});

// The rail is desktop-only; the BottomNav stays the mobile surface.
test('SideNav is desktop-only (md+) and hidden on mobile', () => {
  const src = read('src/components/nav/SideNav.jsx');
  assert.match(src, /hidden/);
  assert.match(src, /md:flex/);
});

// It must hide before a role resolves, so it stays off login/onboarding —
// exactly like the bottom bar.
test('SideNav hides until a role is available', () => {
  const src = read('src/components/nav/SideNav.jsx');
  assert.match(src, /if \(!role\) return null/);
});

// Layout mounts the rail and offsets content so the fixed rail never covers it.
test('Layout mounts SideNav and offsets desktop content', () => {
  const src = read('src/Layout.jsx');
  assert.match(src, /import SideNav from '@\/components\/nav\/SideNav'/);
  assert.match(src, /<SideNav \/>/);
  assert.match(src, /md:pl-64/);
});

// Sanity: every destination the rail will render resolves to a real URL and
// the active check is exact (no prefix false-positives).
test('rail destinations resolve to valid URLs and exact active matches', () => {
  for (const role of [ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT]) {
    const grouped = getGroupedDestinations(role);
    const flat = grouped.flatMap((g) => g.items);
    assert.deepEqual(flat.map((d) => d.page), getDestinations(role).map((d) => d.page));
    for (const dest of flat) {
      assert.equal(isActivePath(pageUrl(dest.page), dest.page), true);
      assert.equal(isActivePath('/Home', dest.page), dest.page === 'Home');
    }
  }
});
