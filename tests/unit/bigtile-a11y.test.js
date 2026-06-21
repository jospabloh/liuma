import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// BigTile is the primary navigation control on every home dashboard
// (parent/teacher/admin). When rendered as a custom button it must be
// operable by keyboard, matching the day-cell pattern in CalendarioEscolar.
test('BigTile button branch is keyboard operable', () => {
  const source = read('src/components/ui/BigTile.jsx');

  // The role="button" element carries an onKeyDown handler.
  assert.match(source, /role="button"/);
  assert.match(source, /onKeyDown=\{handleKeyDown\}/);

  // Enter and Space activate it and the default scroll/submit is prevented.
  assert.match(source, /event\.key === 'Enter'/);
  assert.match(source, /event\.key === ' '/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /onClick\?\.\(event\)/);
});

test('BigTile exposes an accessible name and a visible focus ring', () => {
  const source = read('src/components/ui/BigTile.jsx');

  // Both the link and button branches get an aria-label from the computed
  // accessible name (title, plus pending count when a badge is present).
  const ariaLabels = source.match(/aria-label=\{accessibleName\}/g) || [];
  assert.ok(ariaLabels.length >= 2, 'both link and button branches label themselves');

  // Keyboard focus is visible via a focus-visible ring.
  assert.match(source, /focus-visible:ring-2/);
  assert.match(source, /focus-visible:ring-brand/);
});

test('BigTile folds the badge count into the accessible name', () => {
  const source = read('src/components/ui/BigTile.jsx');

  // Screen-reader users hear the pending count, not just the title.
  assert.match(source, /const accessibleName = hasBadge/);
  assert.match(source, /\$\{badge\} pendientes/);
});
