import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeFakeMongoDb } from '../fixtures/fake-mongo-db.js';
import { multisets, scheduledDb, scheduler } from '../fixtures/interleave.js';
import { runAccountDeletion } from '../../base44/functions/deleteMyAccount/_deletion.ts';
import { runOnboardingProvision } from '../../src/lib/authorization/onboardingProvision.js';
import { PRIVACY_NOTICE_VERSION } from '../../src/lib/consent/privacyNotice.js';

// Codex review of PR #197, round 7. Onboarding checked the deletion markers
// only on the auth.me() snapshot: a deleteMyAccount running at the same time
// could set its marker and finish its clean-up while onboarding was still
// writing, and the ConsentRecord, the stamped UserProfile and (founder) the
// School + SchoolSubscription survived on a deleted account. Onboarding now
// re-reads the stored User right before and right after the profile write and
// undoes what it wrote; the deletion re-reads the profiles after its marker.
//
// The interleavings: the deletion's calls that touch none of the entities
// onboarding reads or writes (User, UserProfile, ConsentRecord, School,
// SchoolSubscription) commute with it, so slots are only placed at the
// deletion's calls on those entities; onboarding is cut at its commit-related
// calls (everything up to its ConsentRecord, the pre-read, the profile write,
// the post-read, then its compensation).

const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-02T18:00:00.000Z');
const ONBOARD_NOW = new Date('2026-10-02T17:59:00.000Z');
const USER = { id: 'u-new', email: 'nuevo@ejemplo.mx' };
const CONSENT = { general: true, sensitive: true, noticeVersion: PRIVACY_NOTICE_VERSION };
const BODIES = {
  founder: { role: 'ADMIN', newSchool: { name: 'Escuela Nueva' }, consent: CONSENT },
  join: { role: 'PARENT', joinCode: 'ABCDEFGH', consent: CONSENT },
};
const SHARED = new Set(['User', 'UserProfile', 'ConsentRecord', 'School', 'SchoolSubscription']);

function world() {
  return {
    User: [{ ...USER }, { id: 'u-dir', email: 'dir@ejemplo.mx' }],
    School: [{ id: 'sJ', name: 'Colegio J', join_code: 'ABCDEFGH', created_by_user_id: 'u-dir' }],
    SchoolSubscription: [{ id: 'subJ', school_id: 'sJ', subscription_status: 'active' }],
    UserProfile: [{ id: 'p-dir', user_id: 'u-dir', school_id: 'sJ', app_role: 'ADMIN', status: 'ACTIVE', created_date: '2026-09-01T00:00:00Z' }],
    ConsentRecord: [],
    AuditLog: [],
  };
}

const onboard = (db, kind) => runOnboardingProvision({ user: USER, body: BODIES[kind], sr: db, now: ONBOARD_NOW, randomBytes: () => new Uint8Array(32).fill(7) });
const remove = (db) => runAccountDeletion({ sr: db, user: USER, body: { confirm: 'ELIMINAR' }, now: NOW });

async function soloTrace(fn) {
  const tables = world();
  const db = makeFakeMongoDb(tables, { integrations: { Core: { SendEmail: async () => {} } } });
  const trace = [];
  const entities = new Proxy({}, { get: (_, n) => new Proxy(db.entities[n], { get: (h, op) => (typeof h[op] === 'function' ? (...a) => { trace.push(n); return h[op](...a); } : h[op]) }) });
  await fn({ ...db, entities }).catch(() => {});
  return trace;
}

function when(row) {
  return String(row.withdrawn_at || row.accepted_at || row.created_date || '');
}

function assertNothingSurvivesForMarked(tables, label) {
  const user = tables.User.find((u) => u.id === USER.id);
  const marked = !user || Boolean(user.account_deletion_started_at) || Boolean(user.account_deleted_at);
  const founded = tables.School.filter((s) => s.created_by_user_id === USER.id);
  // Never an orphan: a school this user founded always has a member.
  for (const s of founded) {
    assert.ok(tables.UserProfile.some((p) => p.school_id === s.id), `${label}: orphan school ${s.id}`);
  }
  if (!marked) return;
  assert.equal(tables.UserProfile.some((p) => p.user_id === USER.id), false, `${label}: a profile survived a marked user`);
  assert.equal(founded.length, 0, `${label}: a founded school survived a marked user`);
  assert.equal(tables.SchoolSubscription.some((s) => !tables.School.some((sc) => sc.id === s.school_id)), false, `${label}: an orphan subscription`);
  const mine = tables.ConsentRecord.filter((c) => c.user_id === USER.id);
  for (const schoolId of new Set(mine.map((c) => c.school_id))) {
    const latest = mine.filter((c) => c.school_id === schoolId).sort((a, b) => when(b).localeCompare(when(a)))[0];
    assert.equal(latest.event, 'WITHDRAWN', `${label}: an acceptance is the newest consent for ${schoolId}`);
  }
}

for (const kind of ['founder', 'join']) {
  test(`onboarding (${kind}) racing a deletion: nothing it wrote survives on a marked account, in any placement`, async () => {
    const dTrace = await soloTrace(remove);
    // Slots: before each deletion call that touches a shared entity, and the end.
    const slots = [0, ...dTrace.map((e, i) => (SHARED.has(e) ? i + 1 : null)).filter((x) => x !== null)];
    const oTrace = await soloTrace((db) => onboard(db, kind));
    const prefix = oTrace.indexOf('ConsentRecord') + 1; // up to and including its ConsentRecord
    assert.ok(prefix > 0);
    let outcomes = new Set();
    for (const [s1, s2, s3, s4, s5] of multisets(slots, 5)) {
      const schedule = [
        ...Array(s1).fill('D'), ...Array(prefix).fill('O'),
        ...Array(s2 - s1).fill('D'), 'O', // pre-commit read
        ...Array(s3 - s2).fill('D'), 'O', // profile write
        ...Array(s4 - s3).fill('D'), 'O', // post-commit read
        ...Array(s5 - s4).fill('D'), ...Array(8).fill('O'), // compensation, if any
      ];
      const tables = world();
      const sched = scheduler(schedule);
      const o = scheduledDb(tables, 'O', sched);
      const d = scheduledDb(tables, 'D', sched);
      const [or, dr] = await Promise.allSettled([
        onboard(o, kind).finally(() => sched.finish('O')),
        remove(d).finally(() => sched.finish('D')),
      ]);
      const label = `${kind} ${[s1, s2, s3, s4, s5].join(',')}`;
      assertNothingSurvivesForMarked(tables, label);
      const oCode = or.status === 'fulfilled' ? 'ok' : or.reason.code;
      const dCode = dr.status === 'fulfilled' ? (dr.value.status === 200 ? 'ok' : dr.value.body.code) : 'threw';
      assert.ok(['ok', 'ACCOUNT_DELETION_IN_PROGRESS', 'ONBOARDING_NOT_CONFIRMED'].includes(oCode), `${label}: onboarding ${oCode}`);
      assert.notEqual(dCode, 'threw', label);
      outcomes.add(`${oCode}/${dCode}`);
    }
    // The harness reaches the race, not just the two sequential orders.
    assert.ok(outcomes.has('ACCOUNT_DELETION_IN_PROGRESS/ok'), [...outcomes].join(' '));
    outcomes = null;
  });
}

test('the onboarding copies re-read the stored User before and after the profile write, and compensate', () => {
  const fn = read('base44/functions/provisionOnboardingProfile/entry.ts');
  const consentAt = fn.indexOf('ConsentRecord.create(');
  const pre = fn.indexOf('await refuseIfDeleting(', consentAt);
  const write = fn.indexOf('UserProfile.create(', pre);
  const post = fn.indexOf('await refuseIfDeleting(', write);
  assert.ok(consentAt > 0 && pre > consentAt && write > pre && post > write, 'consent → re-read → profile → re-read');
  for (const name of ['storedDeletionState', 'compensateOnboarding', 'refuseIfDeleting']) {
    assert.match(fn, new RegExp(`async function ${name}\\(`), `${name} copied into entry.ts`);
  }
  assert.match(fn, /event: 'WITHDRAWN'[\s\S]*?source: 'onboarding_cancelled'/, 'the acceptance is kept and withdrawn, never deleted');
  assert.doesNotMatch(fn, /ConsentRecord\.delete/);
  assert.match(fn, /others && others\.length === 0/, 'a school is removed only while nobody else is in it');
});

test('a compensation that cannot complete is logged with ids and still refuses', async () => {
  const tables = world();
  tables.User[0].account_deletion_started_at = NOW.toISOString();
  // The WITHDRAWN record (2nd ConsentRecord write) fails, and so does its retry.
  const db = makeFakeMongoDb(tables, { failOn: [2, 3].map((nth) => ({ entity: 'ConsentRecord', op: 'create', nth, message: 'store down' })) });
  // The snapshot is stale: the marker is only in the stored User.
  const errors = [];
  const original = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    await assert.rejects(() => onboard(db, 'join'), (e) => e.code === 'ACCOUNT_DELETION_IN_PROGRESS' && e.status === 403);
  } finally {
    console.error = original;
  }
  assert.equal(tables.UserProfile.some((p) => p.user_id === USER.id), false, 'no profile was written');
  assert.ok(errors.some((m) => /compensation incomplete/.test(m) && /u-new/.test(m) && /ConsentRecord WITHDRAWN for sJ/.test(m)), errors.join('\n'));
});

test('the deletion re-reads profiles after its marker, before judging the director seat', () => {
  const src = read('base44/functions/deleteMyAccount/_deletion.ts');
  const marker = src.indexOf('account_deletion_started_at: startedAt');
  const reread = src.indexOf('profiles = await myProfiles(sr, userId);', marker);
  const seat = src.indexOf('await reserveDirectorSeats(sr, userId, profiles)', marker);
  assert.ok(marker > 0 && reread > marker && seat > reread);
});
