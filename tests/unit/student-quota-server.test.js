import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeFakeDb } from '../fixtures/fake-entity-db.js';
import { runSchoolWrite } from '../../base44/functions/guardedEntityWrite/_schoolWrite.ts';
import {
  STUDENT_PLAN_LIMITS,
  STUDENT_GRACE_RATIO,
  addsActiveStudent,
  studentHardLimit,
  studentPlanLimit,
} from '../../base44/functions/guardedEntityWrite/_policy.ts';
import {
  ALL_LICENSE_TIERS,
  GRACE_BUFFER_RATIO,
  PLAN_LIMITS,
  evaluateStudentQuota,
} from '../../src/lib/license/licenseModel.js';
import { humanizeError } from '../../src/lib/errorMessages.js';

// v1.9.0 (server-minor). The licensed student cap used to be a browser check
// only (useStudentQuota → GestionEscuela.jsx): any ADMIN token could POST
// guardedEntityWrite {entity:'Student', operation:'create'} past it. It is now
// decided by guardedEntityWrite on every create and re-activation. These tests
// hold the two copies of the rule to the same answers, and run the real write
// path against an in-memory school.

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, ROOT), 'utf8');
const NOW = new Date('2026-10-02T15:00:00.000Z');

test('the server cap table is the client one (tiers, limits, grace)', () => {
  assert.deepEqual(STUDENT_PLAN_LIMITS, PLAN_LIMITS);
  assert.deepEqual(Object.keys(STUDENT_PLAN_LIMITS).sort(), [...ALL_LICENSE_TIERS].sort());
  assert.equal(STUDENT_GRACE_RATIO, GRACE_BUFFER_RATIO);
});

test('server and client refuse exactly the same (tier × status × count) cases', () => {
  const tiers = [...ALL_LICENSE_TIERS, undefined, 'unknown'];
  const statuses = ['trial', 'active', 'view_only', undefined];
  const counts = [0, 149, 150, 164, 165, 166, 399, 400, 439, 440, 441, 5000];
  for (const tier of tiers) {
    for (const status of statuses) {
      for (const used of counts) {
        const client = evaluateStudentQuota({
          licenseTier: tier || 'start',
          billingStatus: status || 'trial',
          activeStudentCount: used,
          gatingEnabled: true,
        });
        const hard = studentHardLimit({ license_tier: tier, subscription_status: status });
        const serverRefuses = hard != null && used >= hard;
        assert.equal(serverRefuses, client.exceeded, `tier=${tier} status=${status} used=${used}`);
        assert.equal(hard, client.hardLimit, `hard limit tier=${tier} status=${status}`);
        assert.equal(studentPlanLimit({ license_tier: tier, subscription_status: status }), client.limit);
      }
    }
  }
});

test('only a write that adds an ACTIVE student counts against the cap', () => {
  assert.equal(addsActiveStudent('create', { first_name: 'A' }, null), true);
  assert.equal(addsActiveStudent('create', { is_active: true }, null), true);
  assert.equal(addsActiveStudent('create', { is_active: false }, null), false);
  assert.equal(addsActiveStudent('update', { is_active: true }, { is_active: false }), true);
  assert.equal(addsActiveStudent('update', { is_active: true }, {}), true, 'a legacy row with no is_active is not counted today');
  assert.equal(addsActiveStudent('update', { is_active: true }, { is_active: true }), false);
  assert.equal(addsActiveStudent('update', { first_name: 'B' }, { is_active: false }), false);
  assert.equal(addsActiveStudent('update', { is_active: false }, { is_active: true }), false);
});

// --- The real write path ------------------------------------------------------

const ADMIN = { id: 'u-admin', full_name: 'Directora', email: 'd@a.mx' };
const OWNER = { id: 'u-owner', role: 'admin', full_name: 'Plataforma', email: 'o@liuma.mx' };

function school({ tier = 'start', status = 'active', active = 0, inactive = 0, otherSchoolActive = 0 } = {}) {
  const students = [];
  for (let i = 0; i < active; i += 1) students.push({ id: `on${i}`, school_id: 'sA', first_name: 'A', last_name: String(i), is_active: true, created_date: '2026-09-01T00:00:00Z' });
  for (let i = 0; i < inactive; i += 1) students.push({ id: `off${i}`, school_id: 'sA', first_name: 'B', last_name: String(i), is_active: false, created_date: '2026-09-01T00:00:00Z' });
  for (let i = 0; i < otherSchoolActive; i += 1) students.push({ id: `b${i}`, school_id: 'sB', first_name: 'C', last_name: String(i), is_active: true, created_date: '2026-09-01T00:00:00Z' });
  return makeFakeDb({
    UserProfile: [
      { id: 'p-admin', user_id: 'u-admin', school_id: 'sA', app_role: 'ADMIN', status: 'ACTIVE', onboarding_completed: true, created_date: '2026-09-01T00:00:00Z' },
    ],
    SchoolSubscription: [{
      id: 'subA', school_id: 'sA', subscription_status: status, license_tier: tier,
      trial_end_date: '2026-10-30T00:00:00Z', license_expires_at: '2026-11-01T00:00:00Z',
    }],
    Classroom: [{ id: 'cA', school_id: 'sA', name: '1A', is_active: true }],
    Student: students,
    AuditLog: [],
  });
}

const newStudent = { entity: 'Student', operation: 'create', data: { first_name: 'Nueva', last_name: 'Alumna', classroom_id: 'cA' } };
const activeCount = (db) => db.entities.Student.filter({ school_id: 'sA', is_active: true }).then((r) => r.length);

test('Start plan: the 165th active student is accepted, the 166th is refused (150 + 10 %)', async () => {
  const db = school({ active: 164 });
  const ok = await runSchoolWrite({ sr: db, user: ADMIN, body: newStudent, now: NOW });
  assert.equal(ok.status, 200);
  assert.equal(await activeCount(db), 165);

  const refused = await runSchoolWrite({ sr: db, user: ADMIN, body: newStudent, now: NOW });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, 'STUDENT_QUOTA');
  assert.equal(refused.body.limit, 150);
  assert.equal(refused.body.hard_limit, 165);
  assert.equal(refused.body.used, 165);
  assert.equal(await activeCount(db), 165, 'nothing was written');
});

test('inactive students and other schools do not count', async () => {
  const db = school({ active: 160, inactive: 50, otherSchoolActive: 300 });
  const r = await runSchoolWrite({ sr: db, user: ADMIN, body: newStudent, now: NOW });
  assert.equal(r.status, 200);
});

test('at the cap: creating an INACTIVE student and editing an active one still work', async () => {
  const db = school({ active: 165 });
  const inactive = await runSchoolWrite({ sr: db, user: ADMIN, body: { ...newStudent, data: { ...newStudent.data, is_active: false } }, now: NOW });
  assert.equal(inactive.status, 200);
  const edit = await runSchoolWrite({ sr: db, user: ADMIN, body: { entity: 'Student', operation: 'update', id: 'on0', data: { first_name: 'Ana' } }, now: NOW });
  assert.equal(edit.status, 200);
  const retire = await runSchoolWrite({ sr: db, user: ADMIN, body: { entity: 'Student', operation: 'update', id: 'on1', data: { is_active: false } }, now: NOW });
  assert.equal(retire.status, 200);
});

test('at the cap: re-activating a retired student is refused and the stored row is untouched', async () => {
  const db = school({ active: 165, inactive: 1 });
  const r = await runSchoolWrite({ sr: db, user: ADMIN, body: { entity: 'Student', operation: 'update', id: 'off0', data: { is_active: true, first_name: 'Otro' } }, now: NOW });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'STUDENT_QUOTA');
  const row = await db.entities.Student.get('off0');
  assert.equal(row.is_active, false);
  assert.equal(row.first_name, 'B');
});

test('Growth caps at 440; Plus, Fundador and a trial have no cap', async () => {
  let db = school({ tier: 'growth', active: 440 });
  assert.equal((await runSchoolWrite({ sr: db, user: ADMIN, body: newStudent, now: NOW })).body.code, 'STUDENT_QUOTA');
  for (const [tier, status] of [['plus', 'active'], ['founder', 'active'], ['start', 'trial']]) {
    db = school({ tier, status, active: 3000 });
    const r = await runSchoolWrite({ sr: db, user: ADMIN, body: newStudent, now: NOW });
    assert.equal(r.status, 200, `${tier}/${status}`);
  }
});

test('the ACACIA platform owner bypasses the cap, as in the client', async () => {
  const db = school({ active: 500 });
  const r = await runSchoolWrite({ sr: db, user: OWNER, body: { ...newStudent, data: { ...newStudent.data, school_id: 'sA' } }, now: NOW });
  assert.equal(r.status, 200);
});

test('two creates racing for the last seat never leave the school over the cap', async () => {
  const db = school({ active: 164 });
  // A parallel request lands its student between our check and our write.
  const create = db.entities.Student.create.bind(db.entities.Student);
  let raced = false;
  db.entities.Student.create = async (data) => {
    if (!raced) {
      raced = true;
      await create({ ...data, first_name: 'Paralela' });
    }
    return create(data);
  };
  const r = await runSchoolWrite({ sr: db, user: ADMIN, body: newStudent, now: NOW });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'STUDENT_QUOTA');
  assert.equal(await activeCount(db), 165, 'our write was undone; the parallel one stays');
  assert.ok(!db.writes.some((w) => w.entity === 'AuditLog' && w.data?.action === 'RECORD_CREATED'), 'an undone write is not audited as created');
});

test('the refusal reads as Spanish in the app, and the browser warning is no longer behind the paywall flag', () => {
  const message = humanizeError({ response: { status: 403, data: { ok: false, code: 'STUDENT_QUOTA' } } });
  assert.match(message, /máximo de alumnos activos de su plan/);
  const hook = read('src/hooks/useStudentQuota.js');
  assert.doesNotMatch(hook, /PAYWALL_GATING_ENABLED\s*[,}]/, 'useStudentQuota must not read the paywall build flag');
  assert.match(hook, /gatingEnabled: STUDENT_QUOTA_ALWAYS_GATED/);
  assert.match(hook, /export const STUDENT_QUOTA_ALWAYS_GATED = true;/);
  // A server refusal the pre-check missed (stale count) lands on the same upgrade path.
  const page = read('src/pages/GestionEscuela.jsx');
  assert.match(page, /if \(functionErrorCode\(error\) === 'STUDENT_QUOTA'\) \{[\s\S]{0,200}setShowUpgrade\(true\)/);
});
