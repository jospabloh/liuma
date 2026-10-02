import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeFakeMongoDb } from '../fixtures/fake-mongo-db.js';
import {
  IN_CHUNK,
  IncompleteReadError,
  MAX_PAGES,
  PAGE_SIZE,
  readAllByIds,
  readAllOrFail,
  readAllPages,
} from '../../base44/functions/sendBulkNotification/_pages.ts';

// Codex review of PR #197, round 4. The recipient set of every bulk notice —
// the emergency alert included — and the staff directory came from ONE
// filter() with a fixed limit (2,000 / 5,000): a larger school lost the rest
// without a word. Reads are now paged to the end, sequentially, and a read
// that hits the hard bound says so instead of truncating.

const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const rows = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({
  id: `r${String(i).padStart(6, '0')}`, school_id: 'sA', created_date: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)).toISOString(), ...extra,
}));

// Records the calls and fails if two pages are ever in flight at once.
function watched(db, entity) {
  const handler = db.entities[entity];
  let inFlight = 0;
  const calls = [];
  return {
    calls,
    handler: {
      async filter(...args) {
        inFlight += 1;
        assert.equal(inFlight, 1, 'pages are read one at a time (Base44 rate limit)');
        calls.push(args);
        try { return await handler.filter(...args); } finally { inFlight -= 1; }
      },
    },
  };
}

test('the two copies of the paging helper are the same file', () => {
  assert.equal(read('base44/functions/sendBulkNotification/_pages.ts'), read('base44/functions/listSchoolMembers/_pages.ts'));
  assert.ok(PAGE_SIZE >= 500 && PAGE_SIZE <= 1000, 'page size within what the rate limit affords');
});

test('2,501 profiles (past the old 2,000 limit) are all read, page by page, sequentially', async () => {
  const db = makeFakeMongoDb({ UserProfile: [...rows(2501, { status: 'ACTIVE' }), ...rows(5, { status: 'PENDING' }).map((r) => ({ ...r, id: `p-${r.id}` }))] });
  const w = watched(db, 'UserProfile');
  const result = await readAllPages(w.handler, { school_id: 'sA', status: 'ACTIVE' });
  assert.equal(result.complete, true);
  assert.equal(result.rows.length, 2501);
  assert.equal(new Set(result.rows.map((r) => r.id)).size, 2501);
  assert.equal(w.calls.length, Math.ceil(2501 / PAGE_SIZE));
  for (const [, sort, limit, skip] of w.calls) assert.deepEqual([sort, limit, skip], ['created_date', PAGE_SIZE, undefined], 'keyset, never offsets');
});

// Codex review, round 4: offset paging (skip) lost a row whenever one was
// deleted from a page already read — every later row shifted back by one.
test('a row deleted from an already-read page between page reads never costs a later row', async () => {
  const all = rows(1001);
  const db = makeFakeMongoDb({ Student: all.map((r) => ({ ...r })) });
  let pages = 0;
  const handler = {
    async filter(...args) {
      const out = await db.entities.Student.filter(...args);
      pages += 1;
      // After the first page, someone removes a student that page returned.
      if (pages === 1) db.tables.Student.splice(db.tables.Student.findIndex((r) => r.id === out[3].id), 1);
      return out;
    },
  };
  const result = await readAllPages(handler, { school_id: 'sA' });
  assert.equal(result.complete, true);
  const ids = new Set(result.rows.map((r) => r.id));
  for (const r of db.tables.Student) assert.ok(ids.has(r.id), `${r.id} was skipped`);
  assert.ok(ids.has(all[1000].id), 'the last row is read');
});

test('a tie on created_date wider than a page is reported incomplete, never looped on', async () => {
  const same = rows(PAGE_SIZE + 10).map((r) => ({ ...r, created_date: '2026-01-01T00:00:00.000Z' }));
  const result = await readAllPages(makeFakeMongoDb({ Student: same }).entities.Student, { school_id: 'sA' });
  assert.equal(result.complete, false);
});

test('5,001 users by id (past the old 5,000 limit) are all read, in bounded $in chunks', async () => {
  const users = rows(5001);
  const db = makeFakeMongoDb({ User: users });
  const w = watched(db, 'User');
  const result = await readAllByIds(w.handler, 'id', users.map((u) => u.id));
  assert.equal(result.complete, true);
  assert.equal(result.rows.length, 5001);
  for (const [query] of w.calls) assert.ok(query.id.$in.length <= IN_CHUNK);
});

test('past the hard bound the read says so — never a quiet truncation', async () => {
  const n = PAGE_SIZE * MAX_PAGES + 1;
  const db = makeFakeMongoDb({ Student: rows(n) });
  const partial = await readAllPages(db.entities.Student, { school_id: 'sA' });
  assert.equal(partial.complete, false);
  assert.ok(partial.rows.length < n && partial.rows.length >= (PAGE_SIZE - 1) * MAX_PAGES);
  await assert.rejects(() => readAllOrFail(db.entities.Student, { school_id: 'sA' }, 'students'),
    (e) => e instanceof IncompleteReadError && e.code === 'RECIPIENTS_INCOMPLETE' && e.status === 503);
  // Exactly at a page boundary is still complete (one empty page confirms it).
  const exact = await readAllPages(makeFakeMongoDb({ Student: rows(PAGE_SIZE * 2) }).entities.Student, { school_id: 'sA' });
  assert.deepEqual([exact.complete, exact.rows.length], [true, PAGE_SIZE * 2]);
});

test('sendBulkNotification builds every recipient set from paged reads; only the emergency alert proceeds on a partial one', () => {
  const src = read('base44/functions/sendBulkNotification/entry.ts');
  // No fixed-size read of a recipient entity is left (the old 2,000 / 5,000 caps).
  for (const m of src.matchAll(/sr\.entities\.(UserProfile|Student|ParentStudent|EventResponse|User|NoticeDelivery)\.filter\(([^;]*)\);/g)) {
    // Allowed: the caller's own profile (authorization), never a recipient list.
    assert.match(m[2], /user_id: user\.id/, `fixed-size recipient read left: ${m[0].slice(0, 120)}`);
  }
  assert.doesNotMatch(src, /, MAX_RECIPIENTS\)/, 'no read limited to MAX_RECIPIENTS');
  assert.doesNotMatch(src, /, 5000\)/);
  const emergency = src.slice(src.indexOf('async function planEmergency('), src.indexOf('async function parentRecipientsForStudent('));
  assert.match(emergency, /readAllPages\(sr\.entities\.UserProfile/);
  assert.match(emergency, /usersByIds\(sr, .*\{ strict: false \}\)/);
  assert.match(emergency, /recipientsIncomplete: recipientsIncomplete \? 1 : 0/, 'the response says it');
  assert.match(emergency, /action: 'NOTIFICATION_DELIVERY_FAILED',[\s\S]*?reason: 'recipients_incomplete'/, 'and an audit row records it');
  assert.match(emergency, /readAllPages\(sr\.entities\.ParentStudent/);
  assert.match(emergency, /readAllPages\(sr\.entities\.Student/);
  // Every other planner refuses an incomplete list (nothing sent).
  const rest = src.slice(src.indexOf('async function parentRecipientsForStudent('), src.indexOf('const PLANNERS'));
  assert.doesNotMatch(rest, /readAllPages\(/, 'non-emergency plans never use the lenient read');
  assert.doesNotMatch(rest, /strict: false/);
  assert.match(src, /if \(e instanceof IncompleteReadError\) return bad\(e\.status, e\.code, e\.message\);/);
});

test('listSchoolMembers reads the whole school or refuses (RECIPIENTS_INCOMPLETE), never the first 5,000', () => {
  const src = read('base44/functions/listSchoolMembers/entry.ts');
  assert.doesNotMatch(src, /MAX_MEMBERS/);
  assert.match(src, /readAllOrFail\(sr\.entities\.UserProfile, \{ school_id: schoolId \}/);
  assert.match(src, /readAllByIds\(sr\.entities\.User, 'id', userIds\)/);
  assert.match(src, /if \(!usersRead\.complete\) throw new IncompleteReadError/);
  assert.match(src, /e instanceof IncompleteReadError[\s\S]*?status: e\.status/);
});
