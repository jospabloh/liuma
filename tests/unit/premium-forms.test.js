import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// Inputs, textareas and select triggers should share one premium focus
// treatment keyed off the tenant brand token (not the generic grey ring), so a
// focused field reads consistently in every school's palette.
for (const file of [
  'src/components/ui/input.jsx',
  'src/components/ui/textarea.jsx',
  'src/components/ui/select.jsx',
]) {
  test(`${file} focuses with the tenant brand ring`, () => {
    const src = read(file);
    assert.match(src, /(focus|focus-visible):border-brand/);
    assert.match(src, /ring-brand\/25/);
    assert.doesNotMatch(src, /#[0-9a-fA-F]{6}/); // no hardcoded hex
  });
}

// The Select menu uses brand-tinted item focus and a brand check, matching the
// rest of the navigation/active-state language.
test('Select items use brand-tinted focus and a brand check', () => {
  const src = read('src/components/ui/select.jsx');
  assert.match(src, /focus:bg-brand\/10/);
  assert.match(src, /focus:text-brand/);
  assert.match(src, /<Check className="h-4 w-4 text-brand"/);
});

// Dialogs get a premium modal treatment: a blurred scrim, soft corners and a
// strong elevation so they read as a focused layer above the page.
test('Dialog has a blurred scrim, rounded corners and strong elevation', () => {
  const src = read('src/components/ui/dialog.jsx');
  assert.match(src, /backdrop-blur-sm/);
  assert.match(src, /rounded-2xl/);
  assert.match(src, /shadow-2xl/);
});

// Buttons harmonize their radius with the new rounded-lg inputs.
test('Button radius harmonizes with form fields (rounded-lg)', () => {
  const src = read('src/components/ui/button.jsx');
  assert.match(src, /rounded-lg/);
  assert.doesNotMatch(src, /rounded-md/);
});
