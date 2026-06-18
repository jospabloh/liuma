import test from 'node:test';
import assert from 'node:assert/strict';
import { guardWrite } from '../../src/lib/license/writeGuard.js';

test('guardWrite proceeds when writing is allowed and does not call onBlocked', () => {
  let blocked = false;
  const ok = guardWrite(true, () => { blocked = true; });
  assert.equal(ok, true);
  assert.equal(blocked, false);
});

test('guardWrite blocks and invokes onBlocked when writing is not allowed', () => {
  let blocked = false;
  const ok = guardWrite(false, () => { blocked = true; });
  assert.equal(ok, false);
  assert.equal(blocked, true);
});

test('guardWrite tolerates a missing onBlocked callback', () => {
  assert.equal(guardWrite(false), false);
  assert.equal(guardWrite(true), true);
});
