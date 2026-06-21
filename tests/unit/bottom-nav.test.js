import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ROLES, getAvisosPage, getPrimaryTabs, getDestinations, getGroupedDestinations,
  pageUrl, isActivePath,
} from '../../src/components/nav/navRegistry.js';
import { createPageUrl } from '../../src/utils/index.ts';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('Avisos tab resolves to the role-appropriate notices page', () => {
  assert.equal(getAvisosPage(ROLES.ADMIN), 'AvisosAdmin');
  assert.equal(getAvisosPage(ROLES.TEACHER), 'AvisosMaestro');
  assert.equal(getAvisosPage(ROLES.PARENT), 'Avisos');
  assert.equal(getAvisosPage(undefined), 'Avisos'); // safe default
});

test('the bottom bar is always exactly four tabs ending in the palette', () => {
  for (const role of [ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT, undefined]) {
    const tabs = getPrimaryTabs(role);
    assert.equal(tabs.length, 4);
    assert.deepEqual(tabs.slice(0, 2).map((t) => t.page), ['Home', 'OperacionDiaria']);
    assert.equal(tabs[3].action, 'palette');
    assert.equal(tabs[3].page, undefined); // the menu tab navigates nowhere; it opens the palette
  }
});

test('each role has a non-empty destination list; unknown roles fall back to parent', () => {
  assert.ok(getDestinations(ROLES.ADMIN).length >= 10);
  assert.ok(getDestinations(ROLES.TEACHER).length >= 5);
  assert.ok(getDestinations(ROLES.PARENT).length >= 8);
  assert.deepEqual(getDestinations('NOPE'), getDestinations(ROLES.PARENT));
});

test('grouping preserves order and loses no destinations', () => {
  const flat = getDestinations(ROLES.ADMIN);
  const grouped = getGroupedDestinations(ROLES.ADMIN);
  const regrouped = grouped.flatMap((g) => g.items);
  assert.deepEqual(regrouped.map((d) => d.page), flat.map((d) => d.page));
  // group headings are unique
  const headings = grouped.map((g) => g.group);
  assert.equal(new Set(headings).size, headings.length);
});

test('pageUrl matches the app-wide createPageUrl', () => {
  for (const dest of getDestinations(ROLES.ADMIN)) {
    assert.equal(pageUrl(dest.page), createPageUrl(dest.page));
  }
});

test('isActivePath highlights only the matching route', () => {
  assert.equal(isActivePath('/OperacionDiaria', 'OperacionDiaria'), true);
  assert.equal(isActivePath('/OperacionDiaria/', 'OperacionDiaria'), true);
  assert.equal(isActivePath('/Home', 'OperacionDiaria'), false);
  assert.equal(isActivePath('', 'Home'), false);
});

test('Layout mounts the persistent bottom nav', () => {
  const src = read('src/Layout.jsx');
  assert.match(src, /import BottomNav from '@\/components\/nav\/BottomNav'/);
  assert.match(src, /<BottomNav \/>/);
});

test('BottomNav wires the palette, the ⌘K shortcut, and hides without a role', () => {
  const src = read('src/components/nav/BottomNav.jsx');
  assert.match(src, /e\.metaKey \|\| e\.ctrlKey/);
  assert.match(src, /key\.toLowerCase\(\) === 'k'/);
  assert.match(src, /if \(!role\) return null/);
  assert.match(src, /md:hidden/); // mobile-only bar
  assert.match(src, /<CommandPalette/);
});

test('CommandPalette uses cmdk and navigates on select', () => {
  const src = read('src/components/nav/CommandPalette.jsx');
  assert.match(src, /CommandDialog/);
  assert.match(src, /useNavigate/);
  assert.match(src, /getGroupedDestinations/);
});
