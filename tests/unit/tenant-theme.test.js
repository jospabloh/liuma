import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPaletteFromImageData, DEFAULT_THEME, ensureAccessiblePair } from '../../src/lib/tenantTheme.js';

test('extracts multicolor logo palette with at least 4 colors', () => {
  const data = new Uint8ClampedArray([
    220, 40, 40, 255, 220, 40, 40, 255,
    40, 120, 220, 255, 40, 120, 220, 255,
    40, 180, 90, 255, 40, 180, 90, 255,
    240, 180, 20, 255, 240, 180, 20, 255,
  ]);
  const theme = extractPaletteFromImageData(data, { targetCount: 4, minCount: 2 });
  assert.equal(theme.quality, 'high');
  assert.ok(theme.palette.primary);
  assert.ok(theme.palette.secondary);
  assert.ok(theme.palette.accent);
  assert.ok(theme.palette.neutral);
});

test('falls back when logo quality is monochrome/low-signal', () => {
  const data = new Uint8ClampedArray(Array(40).fill(250));
  const theme = extractPaletteFromImageData(data, { targetCount: 4, minCount: 2 });
  assert.equal(theme.quality, 'failed');
  assert.deepEqual(theme.palette, DEFAULT_THEME.palette);
});

test('auto-corrects contrast for button text/background pairs', () => {
  const pair = ensureAccessiblePair('#f4f4f4');
  assert.ok(pair.foreground === '#000000' || pair.foreground === '#ffffff');
  assert.ok(pair.background.startsWith('#'));
});

test('theme extraction is tenant-isolated by independent input data', () => {
  const tenantA = extractPaletteFromImageData(new Uint8ClampedArray([200, 10, 10, 255, 10, 10, 200, 255, 10, 200, 10, 255, 200, 200, 10, 255]));
  const tenantB = extractPaletteFromImageData(new Uint8ClampedArray([10, 200, 200, 255, 200, 10, 200, 255, 120, 120, 120, 255, 200, 100, 10, 255]));
  assert.notDeepEqual(tenantA.palette, tenantB.palette);
});
