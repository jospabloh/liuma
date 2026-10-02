import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeFakeMongoDb } from '../fixtures/fake-mongo-db.js';
import { multisets, scheduledDb, scheduler } from '../fixtures/interleave.js';
import {
  ANONYMIZE as GUARD_ANONYMIZE,
  ANONYMIZED_NAME as GUARD_ANONYMIZED_NAME,
  OPEN_CHANGE_STATUSES as GUARD_OPEN,
  DeletionInProgressError,
  guardWrites,
  withDeletionGuard,
} from '../../base44/functions/guardedEntityWrite/_deletionGuard.ts';
import { ANONYMIZE, ANONYMIZED_NAME, runAccountDeletion } from '../../base44/functions/deleteMyAccount/_deletion.ts';
import { runOnboardingProvision } from '../../src/lib/authorization/onboardingProvision.js';
import { PRIVACY_NOTICE_VERSION } from '../../src/lib/consent/privacyNotice.js';

// Codex review of PR #197, round 8. The deletion-marker gate read only the
// auth.me() snapshot: a write could pass it, pause, and land after
// deleteMyAccount had set its marker and finished anonymizing (a late
// DiaryEntry keeping the deleted teacher's id and name). Every function that
// writes after auth.me() now goes through _deletionGuard.ts.

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, ROOT), 'utf8');
const NOW = new Date('2026-10-02T18:00:00.000Z');
const T = 'u-teacher';

// ── the sweep: who writes, and are they all wrapped ─────────────────────────

const WRITE = /\bentities(\.\w+|\[[^\]]+\])\.(create|update|delete|bulkCreate|updateMany|deleteMany)\(/;
// Writers with their own handshake, or none that touches entities.
const EXEMPT = {
  deleteMyAccount: 'the deletion itself',
  myConsent: 'its own marker handshake (compensateStamp)',
  provisionOnboardingProfile: 'its own compensation (refuseIfDeleting)',
  lumiQuery: 'only reads; the confirmation-claim writers in the shared _lumiCore.ts are lumiWrite\'s',
};

function writerDirs() {
  const out = [];
  for (const dir of fs.readdirSync(new URL('base44/functions/', ROOT))) {
    let entry = '';
    try { entry = read(`base44/functions/${dir}/entry.ts`); } catch { continue; }
    if (!/await base44\.auth\.me\(\)/.test(entry)) continue;
    const files = fs.readdirSync(new URL(`base44/functions/${dir}/`, ROOT)).filter((f) => f.endsWith('.ts') && f !== '_deletionGuard.ts');
    const writes = files.some((f) => WRITE.test(read(`base44/functions/${dir}/${f}`)));
    if (writes) out.push(dir);
  }
  return out;
}

test('every function that writes after auth.me() is wrapped by the deletion guard (sweep)', () => {
  const writers = writerDirs();
  assert.ok(writers.length >= 14, writers.join(','));
  const guarded = [];
  for (const dir of writers) {
    if (EXEMPT[dir]) continue;
    const src = read(`base44/functions/${dir}/entry.ts`);
    assert.match(src, /import \{ withDeletionGuard \} from '\.\/_deletionGuard\.ts';/, `${dir}: imports the guard`);
    assert.match(src, /Deno\.serve\(withDeletionGuard\(async \(req, guarded\) => \{/, `${dir}: wraps its handler`);
    // Every service-role client it uses is a guarded one.
    const raw = [...src.matchAll(/base44\.asServiceRole/g)].length;
    const wrapped = [...src.matchAll(/guarded\(base44\.asServiceRole, String\(user\.id\)\)/g)].length;
    assert.ok(wrapped >= 1 && raw === wrapped, `${dir}: ${raw} service-role clients, ${wrapped} guarded`);
    guarded.push(dir);
  }
  for (const fn of ['guardedEntityWrite', 'guardedFamilyWrite', 'postTicketMessage', 'sendBulkNotification', 'uploadSchoolFile', 'recordAuditEvent', 'approveProfile', 'governRoleChange', 'markWelcomeShown']) {
    assert.ok(guarded.includes(fn), `${fn} is guarded`);
  }
  // guardedEntityWrite's school-write path is guarded too.
  assert.match(read('base44/functions/guardedEntityWrite/entry.ts'), /runSchoolWrite\(\{ sr: guarded\(base44\.asServiceRole, String\(user\.id\)\), user,/);
  // The exempt ones say why, and lumiQuery never calls the claim writers.
  assert.doesNotMatch(read('base44/functions/lumiQuery/entry.ts'), /claimConfirmationCode|releaseConfirmationCode/);
  // One guard, byte-identical everywhere.
  const reference = read('base44/functions/guardedEntityWrite/_deletionGuard.ts');
  for (const dir of guarded) assert.equal(read(`base44/functions/${dir}/_deletionGuard.ts`), reference, `${dir}/_deletionGuard.ts`);
});

test('the guard compensates exactly as the deletion does: same anonymization table', () => {
  assert.deepEqual(GUARD_ANONYMIZE, ANONYMIZE);
  assert.equal(GUARD_ANONYMIZED_NAME, ANONYMIZED_NAME);
  assert.match(read('base44/functions/deleteMyAccount/_deletion.ts'), new RegExp(`const OPEN_CHANGE_STATUSES = ${JSON.stringify(GUARD_OPEN).replace(/"/g, "'").replace(/,/g, ', ').replace(/[[\]]/g, '\\$&')};`));
  const audit = JSON.parse(read('base44/entities/AuditLog.jsonc').replace(/^\s*\/\/.*$/gm, '')).properties.action.enum;
  assert.ok(audit.includes('DELETION_STRAGGLER_UNRESOLVED'));
});

// ── behaviour ───────────────────────────────────────────────────────────────

function school(extra = {}) {
  return {
    User: [{ id: T, email: 'maestra@ejemplo.mx' }],
    UserProfile: [{ id: 'p-t', user_id: T, school_id: 'sA', app_role: 'TEACHER', status: 'ACTIVE', consent_notice_version: '2026-10-02', consent_terms_version: '2026-10-02', created_date: '2026-09-01T00:00:00Z' }],
    DiaryEntry: [],
    AbsenceNotification: [],
    ParentStudent: [],
    AuditLog: [],
    ConsentRecord: [],
    ...extra,
  };
}

test('a marker already stored refuses before writing, even when the snapshot was clean', async () => {
  const tables = school();
  tables.User[0].account_deletion_started_at = NOW.toISOString();
  const { sr, tripped } = guardWrites(makeFakeMongoDb(tables), T);
  await assert.rejects(() => sr.entities.DiaryEntry.create({ school_id: 'sA', teacher_id: T, teacher_name: 'Ana' }), DeletionInProgressError);
  assert.equal(tables.DiaryEntry.length, 0);
  assert.equal(tripped(), true);
  // A User already removed counts as marked.
  const gone = guardWrites(makeFakeMongoDb({ ...school(), User: [] }), T);
  await assert.rejects(() => gone.sr.entities.DiaryEntry.create({ teacher_id: T }), DeletionInProgressError);
});

test('a write that lands after the marker is compensated as the deletion would, never deleted as school data', async () => {
  const cases = [
    ['DiaryEntry', { school_id: 'sA', teacher_id: T, teacher_name: 'Ana' }, (rows) => rows.length === 1 && rows[0].teacher_name === ANONYMIZED_NAME],
    ['AbsenceNotification', { school_id: 'sA', parent_id: T, parent_name: 'Ana', status: 'PENDING' }, (rows) => rows.length === 0],
    ['AbsenceNotification', { school_id: 'sA', parent_id: T, parent_name: 'Ana', status: 'APPROVED' }, (rows) => rows.length === 1 && rows[0].parent_name === ANONYMIZED_NAME],
    ['ParentStudent', { school_id: 'sA', parent_id: T, student_id: 's1', status: 'ACTIVE' }, (rows) => rows[0].status === 'REVOKED'],
  ];
  for (const [entity, data, ok] of cases) {
    const tables = school();
    const db = makeFakeMongoDb(tables);
    // The deletion sets its marker while this create is in flight.
    const create = db.entities[entity].create;
    db.entities[entity].create = async (d) => { const r = await create(d); tables.User[0].account_deletion_started_at = NOW.toISOString(); return r; };
    const { sr, tripped } = guardWrites(db, T);
    await assert.rejects(() => sr.entities[entity].create(data), DeletionInProgressError, entity);
    assert.ok(ok(tables[entity]), `${entity} ${JSON.stringify(tables[entity])}`);
    assert.equal(tripped(), true);
  }
});

test('a compensation that fails twice is recorded for the owner (DELETION_STRAGGLER_UNRESOLVED), and still refused', async () => {
  const tables = school();
  const db = makeFakeMongoDb(tables, { failOn: { entity: 'DiaryEntry', op: 'update', message: 'store down' } });
  const create = db.entities.DiaryEntry.create;
  db.entities.DiaryEntry.create = async (d) => { const r = await create(d); tables.User[0].account_deletion_started_at = NOW.toISOString(); return r; };
  const { sr } = guardWrites(db, T);
  await assert.rejects(() => sr.entities.DiaryEntry.create({ school_id: 'sA', teacher_id: T, teacher_name: 'Ana' }), DeletionInProgressError);
  const row = tables.AuditLog.find((a) => a.action === 'DELETION_STRAGGLER_UNRESOLVED');
  assert.ok(row, 'recorded');
  assert.deepEqual([row.target_type, row.target_id, row.user_id, row.school_id], ['DiaryEntry', tables.DiaryEntry[0].id, T, 'sA']);
});

test('a post-check that cannot read the User lets the write stand (the deletion\'s final sweep is the backstop)', async () => {
  const tables = school();
  const db = makeFakeMongoDb(tables);
  const get = db.entities.User.get;
  let reads = 0;
  db.entities.User.get = async (id) => { reads += 1; if (reads === 2) throw new Error('socket hang up'); return get(id); };
  const { sr, tripped } = guardWrites(db, T);
  await sr.entities.DiaryEntry.create({ school_id: 'sA', teacher_id: T, teacher_name: 'Ana' });
  assert.equal(tripped(), false);
  assert.equal(tables.DiaryEntry[0].teacher_name, 'Ana');
});

test('withDeletionGuard answers 403 whatever the handler caught or answered', async () => {
  const tables = school();
  tables.User[0].account_deletion_started_at = NOW.toISOString();
  const handler = withDeletionGuard(async (_req, guarded) => {
    const sr = guarded(makeFakeMongoDb(tables), T);
    // A best-effort write that swallows its error, then a 200.
    await sr.entities.AuditLog.create({ action: 'RECORD_CREATED' }).catch(() => null);
    return Response.json({ ok: true });
  });
  const res = await handler(new Request('http://x/'));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'ACCOUNT_DELETION_IN_PROGRESS');
  const clean = withDeletionGuard(async () => Response.json({ ok: true }));
  assert.equal((await clean(new Request('http://x/'))).status, 200);
});

// ── the race, end to end ─────────────────────────────────────────────────────

const SHARED = new Set(['User', 'DiaryEntry']);
async function deletionTrace() {
  const tables = school();
  const db = makeFakeMongoDb(tables, { integrations: { Core: { SendEmail: async () => {} } } });
  const t = [];
  const entities = new Proxy({}, { get: (_, n) => new Proxy(db.entities[n], { get: (h, op) => (typeof h[op] === 'function' ? (...a) => { t.push(n); return h[op](...a); } : h[op]) }) });
  await runAccountDeletion({ sr: { ...db, entities }, user: { id: T, email: 'maestra@ejemplo.mx' }, body: { confirm: 'ELIMINAR' }, now: NOW });
  return t;
}

async function raceAll(useGuard) {
  const dTrace = await deletionTrace();
  const slots = [0, ...dTrace.map((e, i) => (SHARED.has(e) ? i + 1 : null)).filter((x) => x !== null)];
  const leaks = [];
  // The writer: [pre-read, create, post-read, compensation…]; place its
  // first three calls at every combination of slots.
  for (const [s1, s2, s3] of multisets(slots, 3)) {
    const schedule = [...Array(s1).fill('D'), 'W', ...Array(s2 - s1).fill('D'), 'W', ...Array(s3 - s2).fill('D'), 'W'];
    const tables = school();
    const sched = scheduler(schedule);
    const d = scheduledDb(tables, 'D', sched);
    const w = scheduledDb(tables, 'W', sched);
    const writer = useGuard ? guardWrites(w, T).sr : w;
    await Promise.allSettled([
      runAccountDeletion({ sr: d, user: { id: T, email: 'maestra@ejemplo.mx' }, body: { confirm: 'ELIMINAR' }, now: NOW }).finally(() => sched.finish('D')),
      writer.entities.DiaryEntry.create({ school_id: 'sA', teacher_id: T, teacher_name: 'Ana' }).finally(() => sched.finish('W')),
    ]);
    const user = tables.User.find((u) => u.id === T);
    const marked = !user || user.account_deletion_started_at || user.account_deleted_at;
    if (marked && tables.DiaryEntry.some((e) => e.teacher_id === T && e.teacher_name !== ANONYMIZED_NAME)) leaks.push([s1, s2, s3].join(','));
  }
  return leaks;
}

test('a bitácora written while the teacher deletes the account never keeps the name, in any placement', async () => {
  assert.deepEqual(await raceAll(true), []);
});

test('…and without the guard it would (why the guard exists)', async () => {
  // The deletion's final sweep alone catches most placements; not the write
  // that lands after it.
  assert.ok((await raceAll(false)).length > 0);
});

// ── the deletion's own final sweep ──────────────────────────────────────────

test('deleteMyAccount sweeps once more before marking the account deleted, and re-reads the profiles after deleting them', async () => {
  const tables = school();
  tables.DiaryEntry.push({ id: 'd0', school_id: 'sA', teacher_id: T, teacher_name: 'Ana' });
  const db = makeFakeMongoDb(tables, { integrations: { Core: { SendEmail: async () => {} } } });
  // A straggler lands right after the first anonymization pass of DiaryEntry…
  const updateMany = db.entities.DiaryEntry.updateMany;
  let passes = 0;
  db.entities.DiaryEntry.updateMany = async (q, d) => {
    const r = await updateMany(q, d);
    if ('teacher_name' in (q || {}) && (passes += 1) === 1) tables.DiaryEntry.push({ id: 'd-late', school_id: 'sA', teacher_id: T, teacher_name: 'Ana' });
    return r;
  };
  // …and a profile right after the first profile deletion.
  const deleteMany = db.entities.UserProfile.deleteMany;
  let deletions = 0;
  db.entities.UserProfile.deleteMany = async (q) => {
    const r = await deleteMany(q);
    if ((deletions += 1) === 1) tables.UserProfile.push({ id: 'p-late', user_id: T, school_id: 'sA', app_role: 'TEACHER', status: 'ACTIVE' });
    return r;
  };
  const r = await runAccountDeletion({ sr: db, user: { id: T, email: 'maestra@ejemplo.mx' }, body: { confirm: 'ELIMINAR' }, now: NOW });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(tables.DiaryEntry.find((e) => e.id === 'd-late').teacher_name, ANONYMIZED_NAME, 'the final sweep caught it');
  assert.equal(tables.UserProfile.some((p) => p.user_id === T), false, 'the late profile is gone too');
  const src = read('base44/functions/deleteMyAccount/_deletion.ts');
  assert.ok(src.indexOf('const finalSweep = await sweepUserData(') < src.indexOf('account_deleted_at: markedAt'), 'final sweep before the mark');
});

// ── onboarding: layered compensation (finding 2) ────────────────────────────

const CONSENT = { general: true, sensitive: true, noticeVersion: PRIVACY_NOTICE_VERSION };
function onboardingWorld() {
  return {
    User: [{ id: 'u-new', email: 'n@ejemplo.mx' }],
    School: [{ id: 'sJ', name: 'J', join_code: 'ABCDEFGH', created_by_user_id: 'u-dir' }],
    UserProfile: [{ id: 'p-dir', user_id: 'u-dir', school_id: 'sJ', app_role: 'ADMIN', status: 'ACTIVE' }],
    ConsentRecord: [],
    AuditLog: [],
  };
}
// The deletion sets its marker right after onboarding writes the profile.
function raced(tables, failOn) {
  const db = makeFakeMongoDb(tables, { failOn });
  const create = db.entities.UserProfile.create;
  db.entities.UserProfile.create = async (d) => { const r = await create(d); tables.User[0].account_deletion_started_at = NOW.toISOString(); return r; };
  return db;
}
const join = (db) => runOnboardingProvision({ user: { id: 'u-new' }, body: { role: 'PARENT', joinCode: 'ABCDEFGH', phone: '4491234567', consent: CONSENT }, sr: db, now: NOW });
const mine = (tables) => tables.UserProfile.filter((p) => p.user_id === 'u-new');

test('onboarding compensation, level 1: the profile it wrote is deleted', async () => {
  const tables = onboardingWorld();
  await assert.rejects(() => join(raced(tables)), (e) => e.code === 'ACCOUNT_DELETION_IN_PROGRESS');
  assert.equal(mine(tables).length, 0);
});

test('level 2: the delete fails twice — the profile is SUSPENDED and emptied (grants nothing, holds nothing personal)', async () => {
  const tables = onboardingWorld();
  await assert.rejects(() => join(raced(tables, { entity: 'UserProfile', op: 'delete', message: 'store down' })), (e) => e.code === 'ACCOUNT_DELETION_IN_PROGRESS');
  const [p] = mine(tables);
  assert.deepEqual([p.status, p.phone, p.consent_notice_version, p.consent_terms_version], ['SUSPENDED', '', '', '']);
  assert.equal(tables.AuditLog.some((a) => a.action === 'ONBOARDING_COMPENSATION_UNRESOLVED'), false, 'resolved by the fallback');
});

test('level 3: delete and neutralize both fail — persisted for the owner (ONBOARDING_COMPENSATION_UNRESOLVED), still refused', async () => {
  const tables = onboardingWorld();
  const failOn = [{ entity: 'UserProfile', op: 'delete', message: 'store down' }, { entity: 'UserProfile', op: 'update', message: 'store down' }];
  await assert.rejects(() => join(raced(tables, failOn)), (e) => e.code === 'ACCOUNT_DELETION_IN_PROGRESS' && e.status === 403);
  const row = tables.AuditLog.find((a) => a.action === 'ONBOARDING_COMPENSATION_UNRESOLVED');
  assert.ok(row);
  assert.equal(row.target_id, mine(tables)[0].id);
  assert.ok(row.details.unresolved.some((u) => u.startsWith('UserProfile ')));
});

test('level 4: even the record fails — logged with ids, still refused, never 200', async () => {
  const tables = onboardingWorld();
  const failOn = ['delete', 'update'].map((op) => ({ entity: 'UserProfile', op, message: 'store down' })).concat([{ entity: 'AuditLog', op: 'create', message: 'store down' }]);
  const errors = [];
  const original = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    await assert.rejects(() => join(raced(tables, failOn)), (e) => e.code === 'ACCOUNT_DELETION_IN_PROGRESS');
  } finally {
    console.error = original;
  }
  assert.ok(errors.some((m) => /not recorded/.test(m) && /u-new/.test(m)), errors.join('\n'));
  // The deletion's own re-read of profiles removes it when it gets there.
  const entry = read('base44/functions/provisionOnboardingProfile/entry.ts');
  assert.match(entry, /action: 'ONBOARDING_COMPENSATION_UNRESOLVED'/);
  assert.match(entry, /const PROFILE_NEUTRALIZED = \{\s*status: 'SUSPENDED',/);
});
