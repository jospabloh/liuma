import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MAX_TRACKED_USERS,
  SCHOOL_READ_USER_LIMIT,
  makeUserRateLimiter,
} from '../../base44/functions/schoolRead/_userLimit.ts';
import { isRateLimitError, retryAfterMs, RETRY_AFTER_CAP_MS } from '../../src/lib/functionRetry.js';
import { measureConcurrent, measureRunaway, SCENARIOS } from '../../scripts/load-test-reads.mjs';

// v1.9.0 (server-minor). Base44's rate limit is one budget for the whole app,
// and nothing stopped a single session — a tab in a refetch loop, a script
// with a token — from spending all of it, so every other school saw
// "Hay mucha actividad". schoolRead now spends a per-user token before any
// entity call. These tests pin the bucket, its place in entry.ts, and the
// measured claim in its header: normal use never touches it, a runaway loop
// stops starving everybody else.

const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('a full bucket allows CAPACITY calls at once, then refuses with a Retry-After', () => {
  const c = clock();
  const limiter = makeUserRateLimiter({ now: c.now });
  for (let i = 0; i < SCHOOL_READ_USER_LIMIT.capacity; i += 1) assert.equal(limiter.take('u1').ok, true, `call ${i + 1}`);
  const refused = limiter.take('u1');
  assert.equal(refused.ok, false);
  assert.equal(refused.retryAfterS, Math.ceil(1 / SCHOOL_READ_USER_LIMIT.refillPerSecond));
  // Exactly that long later there is a token again — the Retry-After is honest.
  c.advance(refused.retryAfterS * 1000);
  assert.equal(limiter.take('u1').ok, true);
  assert.equal(limiter.take('u1').ok, false);
});

test('one user\'s burst is that user\'s problem: another user is untouched', () => {
  const c = clock();
  const limiter = makeUserRateLimiter({ now: c.now });
  while (limiter.take('loop').ok) { /* drain */ }
  assert.equal(limiter.take('loop').ok, false);
  assert.equal(limiter.take('teacher').ok, true);
});

test('it refills at the sustained rate and never above capacity', () => {
  const c = clock();
  const limiter = makeUserRateLimiter({ now: c.now });
  while (limiter.take('u').ok) { /* drain */ }
  c.advance(60_000);
  let allowed = 0;
  while (limiter.take('u').ok) allowed += 1;
  assert.equal(allowed, Math.min(SCHOOL_READ_USER_LIMIT.capacity, Math.floor(60 * SCHOOL_READ_USER_LIMIT.refillPerSecond)));
  c.advance(24 * 3600_000);
  allowed = 0;
  while (limiter.take('u').ok) allowed += 1;
  assert.equal(allowed, SCHOOL_READ_USER_LIMIT.capacity, 'a day idle is a full bucket, not a day of tokens');
});

test('memory stays bounded: idle users are forgotten first, then the least recent', () => {
  const c = clock();
  const limiter = makeUserRateLimiter({ now: c.now, maxUsers: 3 });
  limiter.take('a'); limiter.take('b'); limiter.take('c');
  c.advance(3600_000); // all three refilled → idle
  limiter.take('d');
  assert.equal(limiter.size(), 1);
  for (const u of ['e', 'f']) limiter.take(u);
  limiter.take('g'); // e, f, d are active: the least recent goes
  assert.ok(limiter.size() <= 3);
  assert.ok(MAX_TRACKED_USERS >= 1000, 'a real deployment tracks thousands of users');
});

test('entry.ts spends the token before any entity call or body parse, and answers like the platform limit', () => {
  const src = read('base44/functions/schoolRead/entry.ts');
  const take = src.indexOf('userLimiter.take(');
  assert.ok(take > 0, 'schoolRead calls the limiter');
  assert.ok(take < src.indexOf('req.json('), 'before reading the body');
  assert.ok(take < src.indexOf('.entities.'), 'before the first entity call');
  assert.ok(src.indexOf('auth.me()') < take, 'after knowing who is asking');
  assert.match(src, /const userLimiter = makeUserRateLimiter\(\);/, 'module scope: it must outlive one request');
  assert.match(src, /code: 'RATE_LIMITED'[^\n]*limit: 'user'/);
  assert.match(src, /'Retry-After': String\(allowed\.retryAfterS\)/);
  // The client already retries a read on exactly this answer, honouring Retry-After.
  const err = { response: { status: 429, data: { ok: false, code: 'RATE_LIMITED', limit: 'user' }, headers: { 'retry-after': '5' } } };
  assert.equal(isRateLimitError(err), true);
  assert.equal(retryAfterMs(err), 5000);
  assert.ok(Math.ceil(1 / SCHOOL_READ_USER_LIMIT.refillPerSecond) * 1000 <= RETRY_AFTER_CAP_MS, 'the client waits the whole Retry-After, not a capped part of it');
});

test('load: no human, brisk or in-app scenario is ever refused by the bucket', async () => {
  for (const scenario of SCENARIOS.filter((s) => s.thinkMs >= 5000 || !s.reload)) {
    const r = await measureConcurrent('after', { ...scenario, rounds: 1 });
    assert.equal(r.userLimitedInvocations, 0, scenario.name);
    for (const [user, peak] of Object.entries(r.peakPerUserPerMinute)) {
      assert.ok(peak < SCHOOL_READ_USER_LIMIT.capacity, `${scenario.name}: ${user} peaked at ${peak}/min`);
    }
  }
});

test('load: a session looping schoolRead no longer starves the other users', async () => {
  const off = await measureRunaway({ userLimit: false, seconds: 120 });
  const on = await measureRunaway({ userLimit: true, seconds: 120 });
  assert.ok(off.othersFailedQueries > 0, 'the mock must reproduce the starvation');
  assert.ok(on.userLimitedInvocations > 0, 'the bucket is what refused the loop');
  assert.ok(on.rateLimitedInvocations * 4 < off.rateLimitedInvocations,
    `app-wide refusals must collapse (off ${off.rateLimitedInvocations}, on ${on.rateLimitedInvocations})`);
  assert.ok(on.othersFailedQueries < off.othersFailedQueries,
    `the teacher and the parent must lose fewer screens (off ${off.othersFailedQueries}, on ${on.othersFailedQueries})`);
});
