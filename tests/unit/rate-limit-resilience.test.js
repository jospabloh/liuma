import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IDEMPOTENT_READ_FUNCTIONS, MAX_READ_RETRIES, backoffDelay, isRateLimitError, isRetryableReadError,
  makeCooldown, retryAfterMs, withReadRetry,
} from '../../src/lib/functionRetry.js';
import { invokeFunction, onFunctionWrite } from '../../src/lib/functionResponse.js';
import { humanizeError } from '../../src/lib/errorMessages.js';
import { QUERY_STALE_TIME_MS, shouldRetryQuery } from '../../src/lib/queryErrorPolicy.js';
import {
  makeSchoolReader, planBatches, SCAN_MODE_ENTITIES, SCHOOL_READ_BATCH_MAX, SCHOOL_READ_BATCH_MAX_SCANS,
} from '../../src/lib/data/schoolReadCore.js';
import { blockingLoadFailure } from '../../src/lib/loadFailure.js';
import {
  readSessionSubscription, writeSessionSubscription, clearSessionSubscription, SUBSCRIPTION_FRESH_MS,
} from '../../src/lib/license/subscriptionSession.js';
import { READ_RULES, MAX_BATCH, MAX_SCANS_PER_BATCH, needsScan } from '../../base44/functions/schoolRead/_scope.ts';
import { answerSchoolRead, isRateLimitError as serverIsRateLimit } from '../../base44/functions/schoolRead/_answer.ts';
import { makeFakeDb } from '../fixtures/fake-entity-db.js';
import { buildWorld, measureAllScreens, measureConcurrent } from '../../scripts/load-test-reads.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// v1.8.3 — live QA on 2026-10-01 (production v1.8.2): with three people
// browsing at once, schoolRead and getMySubscription failed by the hundred
// with "Rate limit exceeded" (function logs), every one of them answered as
// 500 INTERNAL, nothing retried, and each failure rendered as an empty list:
// "Sin avisos", "Sin hijos vinculados", "Sin salón", a locked "Crear aviso".
// Base44's budget is app-wide for service-role calls, so the fix is fewer
// calls (batching, a shared context, staleTime, one license read per
// session), a 429 the client can act on, bounded retries for READS only, and
// screens that tell a failure from an empty answer.

const noSleep = { sleep: async () => {}, random: () => 0.5 };
const axiosError = (status, data, headers = {}) => Object.assign(new Error(`Request failed with status code ${status}`), {
  response: { status, data, headers },
});

// --- what counts as retryable -------------------------------------------------

test('the rate limit is recognised in every shape it arrives in', () => {
  assert.equal(isRateLimitError(axiosError(429, { code: 'RATE_LIMITED' })), true);
  // v1.8.2's getMySubscription: 500 with the raw SDK message.
  assert.equal(isRateLimitError(axiosError(500, { code: 'INTERNAL', error: 'Rate limit exceeded' })), true);
  assert.equal(isRateLimitError(Object.assign(new Error('Rate limit exceeded'), { status: 429 })), true);
  assert.equal(isRateLimitError(axiosError(403, { code: 'FORBIDDEN' })), false);
  // The server-side test is the same rule.
  assert.equal(serverIsRateLimit({ status: 429 }), true);
  assert.equal(serverIsRateLimit(new Error('Rate limit exceeded')), true);
  assert.equal(serverIsRateLimit(new Error('entity Notice unavailable')), false);
});

test('a read is retried on the limit, a gateway 5xx, a 500 INTERNAL or no answer — never on a refusal', () => {
  for (const error of [
    axiosError(429, {}), axiosError(503, {}), axiosError(502, {}), axiosError(504, {}),
    axiosError(500, { code: 'INTERNAL', error: 'INTERNAL' }),
    Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }),
  ]) assert.equal(isRetryableReadError(error), true, error.message);
  for (const error of [
    axiosError(400, { code: 'INVALID_FILTER' }), axiosError(401, {}), axiosError(403, { code: 'FORBIDDEN' }),
    axiosError(404, {}), axiosError(409, {}), axiosError(500, { code: 'OVERPAYMENT' }),
  ]) assert.equal(isRetryableReadError(error), false, error.message);
  assert.equal(isRetryableReadError(axiosError(503, {}), { online: false }), false, 'offline: retrying cannot help');
});

test('backoff grows, is jittered and capped; Retry-After is honoured', () => {
  assert.equal(backoffDelay(1, { random: () => 0 }), 300);
  assert.equal(backoffDelay(1, { random: () => 1 }), 600);
  assert.equal(backoffDelay(3, { random: () => 0 }), 1200);
  assert.ok(backoffDelay(20, { random: () => 1 }) <= 6000);
  const a = backoffDelay(2, { random: () => 0.1 });
  const b = backoffDelay(2, { random: () => 0.9 });
  assert.notEqual(a, b, 'two failed reads must not come back in the same instant');
  assert.equal(retryAfterMs(axiosError(429, {}, { 'retry-after': '3' })), 3000);
  assert.equal(retryAfterMs(axiosError(429, {}, { 'retry-after': '999' })), 10000, 'capped');
  assert.equal(retryAfterMs(axiosError(429, {})), 0);
});

test('withReadRetry: recovers from a transient limit, gives up after a bound, marks the error', async () => {
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls < 3) throw axiosError(429, { code: 'RATE_LIMITED' });
    return 'ok';
  };
  assert.equal(await withReadRetry(flaky, noSleep), 'ok');
  assert.equal(calls, 3);

  let always = 0;
  await assert.rejects(withReadRetry(async () => { always += 1; throw axiosError(429, {}); }, noSleep), (error) => {
    assert.equal(error.retriesExhausted, true);
    assert.equal(error.attempts, MAX_READ_RETRIES + 1);
    return true;
  });
  assert.equal(always, MAX_READ_RETRIES + 1, 'bounded');

  let refused = 0;
  await assert.rejects(withReadRetry(async () => { refused += 1; throw axiosError(403, { code: 'FORBIDDEN' }); }, noSleep));
  assert.equal(refused, 1, 'a refusal is final');
});

test('a rate limit seen by one read pauses the next ones (shared cooldown)', async () => {
  let clock = 0;
  const cooldown = makeCooldown({ now: () => clock });
  const slept = [];
  const sleep = async (ms) => { slept.push(ms); clock += ms; };
  let first = true;
  await withReadRetry(async () => {
    if (first) { first = false; throw axiosError(429, {}, { 'retry-after': '3' }); }
    return 1;
  }, { sleep, cooldown, random: () => 0 });
  assert.deepEqual(slept, [3000]);
  cooldown.hold(2000);
  slept.length = 0;
  await withReadRetry(async () => 2, { sleep, cooldown });
  assert.deepEqual(slept, [2000], 'a read started during the pause waits it out before asking');
});

// --- invokeFunction: reads retried, writes never -------------------------------

function fakeClient(script) {
  const calls = [];
  return {
    calls,
    functions: {
      async invoke(name, payload) {
        calls.push(name);
        const step = script(calls.length, name, payload);
        if (step instanceof Error) throw step;
        return { data: step, status: 200, headers: {}, config: {} };
      },
    },
  };
}

test('invokeFunction retries a read function and returns its body', async () => {
  const client = fakeClient((n) => (n < 2 ? axiosError(429, { code: 'RATE_LIMITED' }) : { ok: true, rows: [] }));
  const body = await invokeFunction(client, 'schoolRead', {}, { retry: noSleep });
  assert.deepEqual(body, { ok: true, rows: [] });
  assert.equal(client.calls.length, 2);
  assert.ok(IDEMPOTENT_READ_FUNCTIONS.has('getMySubscription'));
});

test('invokeFunction NEVER retries a write: one call, the error surfaces', async () => {
  for (const name of ['guardedEntityWrite', 'guardedFamilyWrite', 'sendBulkNotification', 'notifyParents', 'approveProfile']) {
    assert.equal(IDEMPOTENT_READ_FUNCTIONS.has(name), false, name);
    const client = fakeClient(() => axiosError(429, { code: 'RATE_LIMITED' }));
    await assert.rejects(invokeFunction(client, name, {}, { retry: noSleep }));
    assert.equal(client.calls.length, 1, `${name} was sent more than once`);
  }
  const internal = fakeClient(() => axiosError(500, { code: 'INTERNAL' }));
  await assert.rejects(invokeFunction(internal, 'guardedEntityWrite', {}, { retry: noSleep }));
  assert.equal(internal.calls.length, 1);
});

test('a successful write is announced (caches go stale); a read is not', async () => {
  const seen = [];
  const off = onFunctionWrite((name) => seen.push(name));
  try {
    await invokeFunction(fakeClient(() => ({ ok: true })), 'guardedEntityWrite', {});
    await invokeFunction(fakeClient(() => ({ ok: true })), 'schoolRead', {});
    await assert.rejects(invokeFunction(fakeClient(() => axiosError(400, {})), 'guardedFamilyWrite', {}));
  } finally {
    off();
  }
  assert.deepEqual(seen, ['guardedEntityWrite']);
});

test('the rate limit reads as one Spanish sentence, also from a pre-v1.8.3 500', () => {
  const expected = 'Hay mucha actividad en este momento. Espera unos segundos e inténtalo de nuevo.';
  assert.equal(humanizeError(axiosError(429, { code: 'RATE_LIMITED' })), expected);
  assert.equal(humanizeError(axiosError(500, { code: 'INTERNAL', error: 'Rate limit exceeded' })), expected);
});

// --- React Query defaults ----------------------------------------------------------

test('React Query: lists stay fresh 30 s, no focus refetch, writes never retried, no retry on top of invokeFunction', () => {
  assert.ok(QUERY_STALE_TIME_MS >= 30 * 1000);
  const source = read('src/lib/query-client.js');
  assert.match(source, /staleTime: QUERY_STALE_TIME_MS/);
  assert.match(source, /refetchOnWindowFocus: false/);
  assert.match(source, /retry: shouldRetryQuery/);
  assert.match(source, /mutations: \{[\s\S]*?retry: false/);
  // Writes leave caches stale but do not trigger a refetch burst.
  assert.match(source, /refetchType: 'none'/);
  assert.match(source, /onFunctionWrite\(markAllStale\)/);

  const exhausted = Object.assign(axiosError(429, {}), { retriesExhausted: true });
  assert.equal(shouldRetryQuery(0, exhausted), false, 'invokeFunction already retried it');
  assert.equal(shouldRetryQuery(0, axiosError(403, {})), false);
  assert.equal(shouldRetryQuery(0, axiosError(503, {})), true);
  assert.equal(shouldRetryQuery(2, axiosError(503, {})), false, 'bounded');
  assert.equal(shouldRetryQuery(0, new Error('["x"] data is undefined')), false);
});

// --- one license read per session ----------------------------------------------------

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

test('getMySubscription is kept per user AND school for the session, then expires', () => {
  const storage = memoryStorage();
  const data = { ok: true, subscription: { subscription_status: 'active' } };
  writeSessionSubscription({ userId: 'u1', schoolId: 'A', data, now: 1000, storage });
  assert.deepEqual(readSessionSubscription({ userId: 'u1', schoolId: 'A', now: 2000, storage }), { data, updatedAt: 1000 });
  assert.equal(readSessionSubscription({ userId: 'u2', schoolId: 'A', now: 2000, storage }), undefined, 'another account in the tab');
  assert.equal(readSessionSubscription({ userId: 'u1', schoolId: 'B', now: 2000, storage }), undefined, 'another school');
  assert.equal(readSessionSubscription({ userId: 'u1', schoolId: 'A', now: 1000 + SUBSCRIPTION_FRESH_MS, storage }), undefined, 'expired');
  writeSessionSubscription({ userId: 'u1', schoolId: 'A', data: { ok: false }, now: 3000, storage });
  assert.equal(readSessionSubscription({ userId: 'u1', schoolId: 'A', now: 3001, storage }).updatedAt, 1000, 'a failure is never stored');
  clearSessionSubscription({ storage });
  assert.equal(readSessionSubscription({ userId: 'u1', schoolId: 'A', now: 2000, storage }), undefined);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(readSessionSubscription({ userId: 'u1', schoolId: 'A', storage: broken }), undefined);
  writeSessionSubscription({ userId: 'u1', schoolId: 'A', data, storage: broken });
  clearSessionSubscription({ storage: broken });
});

test('useSubscription seeds from the session copy, and logout forgets it', () => {
  const hook = read('src/hooks/useSubscription.js');
  assert.match(hook, /initialData: stored\?\.data/);
  assert.match(hook, /staleTime: SUBSCRIPTION_FRESH_MS/);
  assert.match(hook, /writeSessionSubscription\(/);
  assert.match(read('src/lib/AuthContext.jsx'), /clearSessionSubscription\(\)/);
});

// --- auto-batching -------------------------------------------------------------------

function recordingCall(handler) {
  const calls = [];
  const call = async (payload) => {
    calls.push(payload);
    return handler(payload);
  };
  return { call, calls };
}

const echo = (payload) => {
  if (payload.action === 'context') return { ok: true, role: 'PARENT', classroom_ids: ['c1'], student_ids: ['s1'], link_student_ids: ['s1'], students: [{ id: 's1' }], classrooms: [{ id: 'c1' }] };
  if (payload.queries) {
    return {
      ok: true,
      results: Object.fromEntries(payload.queries.map((q) => [q.key, [{ id: `${q.entity}-1` }]])),
      has_more: Object.fromEntries(payload.queries.map((q) => [q.key, false])),
      ...(payload.context ? { context: echo({ action: 'context' }) } : {}),
    };
  }
  return { ok: true, rows: [{ id: `${payload.entity}-1` }], has_more: false };
};

const immediate = (fn) => setTimeout(fn, 0);

test('the batcher keeps the server\'s caps in step with _scope.ts', () => {
  assert.equal(SCHOOL_READ_BATCH_MAX, MAX_BATCH);
  assert.equal(SCHOOL_READ_BATCH_MAX_SCANS, MAX_SCANS_PER_BATCH);
  const scans = Object.keys(READ_RULES).filter((e) => ['ADMIN', 'TEACHER', 'PARENT'].some((r) => needsScan(r, e)));
  assert.deepEqual([...SCAN_MODE_ENTITIES].sort(), scans.sort(), 'SCAN_MODE_ENTITIES drifted from needsScan');
});

test('reads made in the same tick travel as ONE request; a lone read keeps the single shape', async () => {
  const { call, calls } = recordingCall(echo);
  const reader = makeSchoolReader(call, { batch: true, schedule: immediate });
  const [a, b, c] = await Promise.all([
    reader.read('Notice', { school_id: 'A' }, '-created_date', 10),
    reader.read('Event', { school_id: 'A' }, 'date', 5),
    reader.read('ChargeItem', { school_id: 'A' }),
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].queries.length, 3);
  assert.deepEqual([a[0].id, b[0].id, c[0].id], ['Notice-1', 'Event-1', 'ChargeItem-1']);

  const lone = recordingCall(echo);
  await makeSchoolReader(lone.call, { batch: true, schedule: immediate }).read('Student', { id: 's1' });
  assert.deepEqual(lone.calls, [{ entity: 'Student', filter: { id: 's1' }, sort: undefined, limit: 1000, skip: 0 }]);
});

test('identical reads in flight share one answer, and a caller cannot mutate the other\'s rows', async () => {
  const { call, calls } = recordingCall(echo);
  const reader = makeSchoolReader(call, { batch: true, schedule: immediate });
  const [x, y] = await Promise.all([reader.read('Notice', { school_id: 'A' }, '-created_date', 50), reader.read('Notice', { school_id: 'A' }, '-created_date', 50)]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { entity: 'Notice', filter: { school_id: 'A' }, sort: '-created_date', limit: 50, skip: 0 });
  x[0].id = 'changed';
  assert.equal(y[0].id, 'Notice-1');
});

test('batches never exceed the read or scan cap (no INVALID_BATCH / TOO_MANY_SCANS)', () => {
  const items = [
    ...Array.from({ length: 14 }, (_, i) => ({ payload: { entity: 'Student', key: i } })),
    ...Array.from({ length: 5 }, () => ({ payload: { entity: 'Notice' } })),
  ];
  const groups = planBatches(items);
  for (const g of groups) {
    assert.ok(g.length <= MAX_BATCH);
    assert.ok(g.filter((i) => SCAN_MODE_ENTITIES.has(i.payload.entity)).length <= MAX_SCANS_PER_BATCH);
  }
  assert.equal(groups.flat().length, items.length);
});

test('one refused read in a batch does not take its siblings down', async () => {
  const { call, calls } = recordingCall((payload) => {
    if (payload.queries) throw axiosError(403, { code: 'FORBIDDEN', key: 'q1' });
    if (payload.entity === 'PermissionOverride') throw axiosError(403, { code: 'FORBIDDEN' });
    return echo(payload);
  });
  const reader = makeSchoolReader(call, { batch: true, schedule: immediate });
  const [ok, refused] = await Promise.allSettled([reader.read('Notice', {}), reader.read('PermissionOverride', {})]);
  assert.equal(ok.status, 'fulfilled');
  assert.equal(refused.status, 'rejected');
  assert.equal(calls.length, 3, 'the batch, then each read on its own');
});

test('a rate-limited batch fails every read in it (each screen then shows its error)', async () => {
  const reader = makeSchoolReader(async () => { throw axiosError(429, { code: 'RATE_LIMITED' }); }, { batch: true, schedule: immediate });
  const results = await Promise.allSettled([reader.read('Notice', {}), reader.read('Event', {})]);
  assert.deepEqual(results.map((r) => r.status), ['rejected', 'rejected']);
});

test('pages beyond the first keep paging (has_more)', async () => {
  let served = 0;
  const reader = makeSchoolReader(async (payload) => {
    if (payload.queries) {
      return { ok: true, results: Object.fromEntries(payload.queries.map((q) => [q.key, Array.from({ length: q.limit }, (_, i) => ({ id: `${q.entity}${q.skip + i}` }))])), has_more: Object.fromEntries(payload.queries.map((q) => [q.key, q.entity === 'Attendance'])) };
    }
    served += 1;
    return { ok: true, rows: Array.from({ length: 200 }, (_, i) => ({ id: `p${i}` })), has_more: false };
  }, { batch: true, schedule: immediate });
  const [attendance] = await Promise.all([reader.read('Attendance', {}, 'date', 1200), reader.read('Notice', {}, '-created_date', 5)]);
  assert.equal(attendance.length, 1200);
  assert.equal(served, 1, 'the second page went out on its own');
});

test('the context rides on the batch of reads around it, and is shared for its TTL', async () => {
  let clock = 0;
  const { call, calls } = recordingCall(echo);
  const reader = makeSchoolReader(call, { batch: true, contextTtlMs: 30000, now: () => clock, schedule: immediate });
  const [ctx] = await Promise.all([reader.context(), reader.context(), reader.read('Notice', {})]);
  assert.equal(calls.length, 1, 'context + read: one request');
  assert.equal(calls[0].context, true);
  assert.deepEqual(ctx.studentIds, ['s1']);
  await reader.context();
  assert.equal(calls.length, 1, 'cached');
  clock = 30001;
  await reader.context();
  assert.equal(calls.length, 2, 'expired');
  reader.reset();
  await reader.context();
  assert.equal(calls.length, 3, 'reset after a write');
});

test('a server without `context: true` support still answers the context', async () => {
  const { call, calls } = recordingCall((payload) => {
    if (payload.queries) {
      const { context: _ignored, ...old } = payload;
      return echo({ queries: old.queries });
    }
    return echo(payload);
  });
  const reader = makeSchoolReader(call, { batch: true, schedule: immediate });
  const [ctx] = await Promise.all([reader.context(), reader.read('Notice', {})]);
  assert.equal(ctx.role, 'PARENT');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { action: 'context' });
});

test('schoolRead.js turns batching and the shared context on', () => {
  const source = read('src/lib/data/schoolRead.js');
  assert.match(source, /batch: true/);
  assert.match(source, /contextTtlMs: SCHOOL_READ_CONTEXT_TTL_MS/);
  assert.match(source, /onFunctionWrite\(\(\) => reader\.reset\(\)\)/);
});

// --- the server: one scope derivation per request, 429 not 500 -------------------------

test('a batch with its context derives the scope ONCE (service-role calls counted)', async () => {
  const db = makeFakeDb(buildWorld());
  const profiles = await db.entities.UserProfile.filter({ user_id: 'parent1' });
  const reads = [
    { key: 'a', entity: 'Notice', filter: {}, sort: '-created_date', limit: 10 },
    { key: 'b', entity: 'Event', filter: {}, sort: 'date', limit: 5 },
    { key: 'c', entity: 'ChargeItem', filter: {} },
  ];
  db.calls.length = 0;
  const batched = await answerSchoolRead(db, 'parent1', profiles, { queries: reads, context: true });
  assert.equal(batched.status, 200);
  assert.ok(batched.body.context.student_ids.length > 0);
  const batchedCalls = db.calls.length;

  db.calls.length = 0;
  await answerSchoolRead(db, 'parent1', profiles, { action: 'context' });
  for (const q of reads) await answerSchoolRead(db, 'parent1', profiles, q);
  const singleCalls = db.calls.length;
  // Parent scope = ParentStudent + Student: paid once instead of four times.
  assert.ok(batchedCalls <= singleCalls - 6, `batched ${batchedCalls} vs one by one ${singleCalls}`);
});

test('a rate limit leaves every read function as 429 RATE_LIMITED with Retry-After, never a raw message', () => {
  const entry = read('base44/functions/schoolRead/entry.ts');
  assert.match(entry, /isRateLimitError\(e\)/);
  assert.match(entry, /status: 429, headers: \{ 'Retry-After'/);
  const canonical = read('base44/functions/schoolRead/_answer.ts').match(/export function isRateLimitError[\s\S]*?\n\}/)[0].replace('export ', '');
  for (const fn of ['getMySubscription', 'guardedEntityWrite', 'guardedFamilyWrite', 'listSchoolMembers']) {
    const source = read(`base44/functions/${fn}/entry.ts`);
    assert.ok(source.includes(canonical), `${fn}: isRateLimitError drifted from schoolRead/_answer.ts`);
    assert.match(source, /code: 'RATE_LIMITED'[\s\S]*?status: 429/, fn);
  }
  const subscription = read('base44/functions/getMySubscription/entry.ts');
  assert.doesNotMatch(subscription, /error: \(e as Error\)\.message/, 'getMySubscription no longer echoes the SDK error');
});

test('the caller\'s own profile is read with their token, off the shared service-role budget', () => {
  for (const fn of ['schoolRead', 'getMySubscription']) {
    const source = read(`base44/functions/${fn}/entry.ts`);
    assert.match(source, /base44\.entities\.UserProfile\.filter\(\{ user_id: user\.id \}/, fn);
    assert.doesNotMatch(source, /sr\.entities\.UserProfile\.filter\(\{ user_id/, fn);
  }
  // That read is own-row under RLS — what makes it safe with the user token.
  const rls = JSON.parse(read('base44/entities/UserProfile.jsonc').replace(/\/\/[^\n]*/g, '')).rls.read;
  assert.deepEqual(rls.$or[0], { 'data.user_id': '{{user.id}}' });
});

// --- failures are not empty lists --------------------------------------------------------

test('blockingLoadFailure: a failed load with nothing to show, never an empty answer or stale data', async () => {
  let refetched = 0;
  const ok = { isError: false, data: [] };
  const failed = { isError: true, data: undefined, error: axiosError(429, { code: 'RATE_LIMITED' }), refetch: async () => { refetched += 1; } };
  const staleButShown = { isError: true, data: [{ id: 1 }], error: axiosError(503, {}) };
  const noRow = { isError: true, data: undefined, error: new Error('["student","x"] data is undefined') };
  assert.equal(blockingLoadFailure(ok, staleButShown, noRow), null);
  const failure = blockingLoadFailure(ok, failed);
  assert.match(failure.message, /mucha actividad/);
  await failure.retry();
  assert.equal(refetched, 1);
});

test('the screens QA saw empty now render <LoadError> with a retry when their read failed', () => {
  const screens = [
    'src/pages/Avisos.jsx', 'src/pages/AvisosMaestro.jsx', 'src/pages/AvisosAdmin.jsx', 'src/pages/MisHijos.jsx',
    'src/pages/Pagos.jsx', 'src/pages/SolicitarAusencia.jsx', 'src/pages/GestionAlumno.jsx', 'src/pages/Bitacora.jsx',
    'src/pages/Tarea.jsx', 'src/pages/EventosParaPadres.jsx', 'src/pages/PedidosUniformes.jsx', 'src/pages/Reportes.jsx',
    'src/pages/Asistencia.jsx', 'src/components/home/ParentHome.jsx', 'src/components/home/TeacherHome.jsx',
    'src/components/home/AdminHome.jsx',
  ];
  for (const file of screens) {
    const source = read(file);
    assert.match(source, /blockingLoadFailure\(/, file);
    assert.match(source, /<LoadError\b/, file);
  }
  // The specific empty states from the QA report each sit behind a failure check.
  const guards = {
    'src/pages/Avisos.jsx': /loadFailure \? \([\s\S]{0,200}title="Sin avisos"/,
    'src/pages/MisHijos.jsx': /loadFailure \? \([\s\S]{0,200}title="Sin hijos vinculados"/,
    'src/pages/Pagos.jsx': /loadFailure \? \([\s\S]{0,250}No hay hijos vinculados a tu cuenta/,
    'src/pages/AvisosMaestro.jsx': /noticesFailure \? \([\s\S]{0,200}title="Sin avisos"/,
  };
  for (const [file, pattern] of Object.entries(guards)) assert.match(read(file), pattern, file);
  assert.doesNotMatch(read('src/pages/GestionAlumno.jsx'), /classroom\?\.name \|\| 'Sin salón'/, 'a failed classroom read is not "Sin salón"');
  const component = read('src/components/ui/LoadError.jsx');
  assert.match(component, /Reintentar/);
  assert.match(component, /Tus datos no se perdieron/);
  assert.match(read('src/components/subscription/ReadOnlyBanner.jsx'), /refetchSubscription\(\)/);
});

// --- the load test, as a regression gate -----------------------------------------------

test('load test: every screen costs fewer service-role calls, and the total drops by over a third', async () => {
  const rows = await measureAllScreens();
  let before = 0;
  let after = 0;
  for (const row of rows) {
    assert.ok(row.after.serviceOps <= row.before.serviceOps, `${row.screen}: ${row.after.serviceOps} > ${row.before.serviceOps}`);
    assert.ok(row.after.invocations <= row.before.invocations, `${row.screen} invocations`);
    before += row.before.serviceOps;
    after += row.after.serviceOps;
  }
  assert.ok(after <= before * 0.65, `total ${before} → ${after}`);
  const admin = rows.find((r) => r.screen === 'AdminHome');
  assert.ok(admin.after.invocations <= 3, `AdminHome: ${admin.after.invocations} invocations`);
});

test('load test: three people at QA pace — v1.8.2 surfaced failures, v1.8.3 surfaces none', async () => {
  const before = await measureConcurrent('before', { rounds: 1, thinkMs: 1500 });
  const after = await measureConcurrent('after', { rounds: 1, thinkMs: 1500 });
  assert.ok(before.failedQueries > 0, 'the mock must reproduce the production failure');
  assert.equal(after.failedQueries, 0);
  assert.ok(after.invocations < before.invocations / 3);
});
