// One helper for every backend-function call (integration of the 2026-09-29
// sales-readiness pass). @base44/sdk's functions client is built with
// interceptResponses:false, so invoke() resolves to the axios RESPONSE and
// rejects with a raw AxiosError; reading `result.record` or `error.data.code`
// straight off them is always undefined. See src/lib/functionResponse.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  functionErrorBody,
  functionErrorCode,
  invokeFunction,
  normalizeFunctionError,
  unwrapFunctionResponse,
} from '../../src/lib/functionResponse.js';
import { humanizeError } from '../../src/lib/errorMessages.js';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');

// What the SDK really hands back.
const axiosResponse = (body) => ({ data: body, status: 200, statusText: 'OK', headers: {}, config: {} });
function axiosError(status, body) {
  const err = new Error(`Request failed with status code ${status}`);
  err.name = 'AxiosError';
  err.isAxiosError = true;
  err.code = 'ERR_BAD_REQUEST';
  err.response = { status, data: body, headers: {}, config: {} };
  return err;
}

test('unwrapFunctionResponse returns the body of an axios response and passes a bare body through', () => {
  assert.deepEqual(unwrapFunctionResponse(axiosResponse({ ok: true, record: { id: 'att1' } })), { ok: true, record: { id: 'att1' } });
  assert.deepEqual(unwrapFunctionResponse({ ok: true, record: { id: 'x' } }), { ok: true, record: { id: 'x' } });
  // A body that merely has a `data` key is not mistaken for an axios response.
  assert.deepEqual(unwrapFunctionResponse({ data: 1 }), { data: 1 });
  assert.equal(unwrapFunctionResponse(undefined), undefined);
  assert.equal(unwrapFunctionResponse(null), null);
});

test('invokeFunction resolves to the body (guardedCreate → record, not undefined)', async () => {
  const calls = [];
  const client = { functions: { invoke: async (name, payload) => { calls.push({ name, payload }); return axiosResponse({ ok: true, record: { id: 'd1' } }); } } };
  const body = await invokeFunction(client, 'guardedEntityWrite', { entity: 'DiaryEntry', operation: 'create', data: {} });
  assert.equal(body.record.id, 'd1');
  assert.deepEqual(calls, [{ name: 'guardedEntityWrite', payload: { entity: 'DiaryEntry', operation: 'create', data: {} } }]);
});

test('invokeFunction rejects with the error body readable as error.data (AxiosError → response.data)', async () => {
  const client = { functions: { invoke: async () => { throw axiosError(429, { ok: false, code: 'DAILY_LIMIT', error: 'Llegaste al límite diario.' }); } } };
  await assert.rejects(invokeFunction(client, 'aiAssist', {}), (error) => {
    assert.equal(error.data.code, 'DAILY_LIMIT');
    assert.equal(error.data.error, 'Llegaste al límite diario.');
    assert.equal(error.status, 429);
    assert.equal(error.response.status, 429, 'the original axios fields stay');
    return true;
  });
});

test('error helpers read AxiosError, Base44Error and network errors', () => {
  assert.equal(functionErrorCode(axiosError(403, { code: 'WRITE_BLOCKED' })), 'WRITE_BLOCKED');
  assert.equal(functionErrorCode({ status: 403, data: { code: 'NOT_PENDING' } }), 'NOT_PENDING');
  const offline = new Error('Network Error');
  offline.code = 'ERR_NETWORK';
  assert.equal(functionErrorBody(offline), null);
  assert.equal(functionErrorCode(offline), null);
  assert.equal(normalizeFunctionError(offline), offline);
  assert.equal(offline.data, undefined);
  // humanizeError sees a function's refusal code even from a raw AxiosError.
  assert.match(humanizeError(axiosError(403, { code: 'WRITE_BLOCKED' })), /solo lectura/);
});

test('the SDK functions client still does not unwrap responses (why this helper exists)', () => {
  const client = read('node_modules/@base44/sdk/dist/client.js');
  assert.match(client, /const functionsAxiosClient = createAxiosClient\(\{[\s\S]{0,300}?interceptResponses: false/);
});

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(jsx?|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('every functions.invoke in src/ goes through invokeFunction', () => {
  const rootPath = new URL('.', ROOT).pathname;
  const raw = [];
  const callers = new Set();
  for (const file of walk(new URL('src/', ROOT).pathname)) {
    const rel = path.relative(rootPath, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    if (rel !== 'src/lib/functionResponse.js' && /\.functions\.invoke\(/.test(text)) raw.push(rel);
    for (const m of text.matchAll(/invokeFunction\(base44, '(\w+)'/g)) callers.add(m[1]);
  }
  assert.deepEqual(raw, [], 'call invokeFunction(base44, name, payload) instead of base44.functions.invoke');
  // Every client-called function exists as a deployed function directory.
  for (const name of callers) {
    assert.ok(fs.existsSync(new URL(`base44/functions/${name}/entry.ts`, ROOT)), `${name} has no base44/functions/${name}/entry.ts`);
  }
  // The call sites that were silently broken before the helper.
  for (const [file, fn] of [
    ['src/lib/authorization/guardedWrite.js', 'guardedEntityWrite'],
    ['src/lib/authorization/familyWrite.js', 'guardedFamilyWrite'],
    ['src/pages/CrearBitacora.jsx', 'aiAssist'],
    ['src/lib/support/aiIntake.js', 'aiAssist'],
    ['src/lib/members/useSchoolMembers.js', 'listSchoolMembers'],
    ['src/lib/notifications/service.js', 'sendBulkNotification'],
    ['src/lib/support/tickets.js', 'postTicketMessage'],
    ['src/hooks/useSubscription.js', 'getMySubscription'],
    ['src/pages/PermisosRoles.jsx', 'exportSchoolData'],
  ]) {
    assert.match(read(file), new RegExp(`invokeFunction\\(base44, '${fn}'`), `${file} → ${fn}`);
  }
});
