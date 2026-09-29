import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { invokeBody } from '../../src/lib/authorization/invokeBody.js';

test('invokeBody unwraps the axios response functions.invoke resolves to', () => {
  // Shape of what @base44/sdk's functions client (interceptResponses: false) returns.
  const response = { data: { ok: true, record: { id: 'att1' } }, status: 200, headers: {}, config: {} };
  assert.deepEqual(invokeBody(response), { ok: true, record: { id: 'att1' } });
  assert.equal(invokeBody(response)?.record?.id, 'att1');
});

test('invokeBody passes a bare body (or nothing) through unchanged', () => {
  assert.deepEqual(invokeBody({ ok: true, record: { id: 'x' } }), { ok: true, record: { id: 'x' } });
  // A body that merely has a `data` key is not mistaken for an axios response.
  assert.deepEqual(invokeBody({ data: 1 }), { data: 1 });
  assert.equal(invokeBody(undefined), undefined);
  assert.equal(invokeBody(null), null);
});

test('the SDK functions client still does not unwrap responses (why invokeBody exists)', () => {
  const client = fs.readFileSync(new URL('../../node_modules/@base44/sdk/dist/client.js', import.meta.url), 'utf8');
  assert.match(client, /const functionsAxiosClient = createAxiosClient\(\{[\s\S]{0,300}?interceptResponses: false/);
});

test('guardedCreate/guardedUpdate return the record from the unwrapped body', () => {
  const src = fs.readFileSync(new URL('../../src/lib/authorization/guardedWrite.js', import.meta.url), 'utf8');
  assert.equal((src.match(/invokeBody\(result\)\?\.record/g) || []).length, 2);
  assert.doesNotMatch(src, /return result\?\.record/);
});
