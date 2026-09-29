import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { READ_RULES } from '../../base44/functions/schoolRead/_scope.ts';
import {
  makeSchoolReader, SCHOOL_READ_PAGE, SCHOOL_READ_ALL, SCHOOL_READ_MAX_SKIP, SCHOOL_READ_MAX_TOTAL, TOO_MANY_ROWS_MESSAGE,
} from '../../src/lib/data/schoolReadCore.js';
import { MAX_SKIP, MAX_LIMIT, MAX_SCANS_PER_BATCH, needsScan } from '../../base44/functions/schoolRead/_scope.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// P10 (sales-readiness audit F01, 2026-09-29). The deployed entity RLS stays
// strict — platform owner, or the caller's own rows — so a direct
// `base44.entities.X.filter()` of school data from a real director, teacher or
// parent returns nothing. Every school-scoped read in src/ goes through
// schoolRead (src/lib/data/schoolRead.js → base44/functions/schoolRead).

// Direct reads of an allowlisted (school-scoped) entity that stay direct, and
// why. Anything not listed here fails the scan below.
const DIRECT_READ_EXCEPTIONS = {
  // The caller's OWN profile rows (`user_id: user.id`): readable under RLS,
  // and needed before there is a scope to ask the server about.
  'src/components/GuardedRoute.jsx': { UserProfile: /user_id: user\.id/ },
  'src/components/nav/NavContext.jsx': { UserProfile: /user_id: user\.id/ },
  'src/hooks/useCurrentProfile.js': { UserProfile: /user_id: user\.id/ },
  'src/hooks/useSubscription.js': { UserProfile: /user_id: user\.id/ },
  'src/pages/Home.jsx': { UserProfile: /user_id: currentUser\.id/ },
  // Platform-owner branches only (cross-school support inbox): the owner-only
  // RLS is theirs. The school-user branch next to each goes through schoolRead.
  'src/lib/support/tickets.js': {
    UserProfile: /user_id: ticket\.requester_user_id/,
    SupportTicket: /\.list\('-created_date'\)/,
    // Anchored to the owner branch itself: the same arguments in a
    // non-owner read must not pass.
    SupportTicketMessage: /isOwner\s*\?\s*await base44\.entities\.SupportTicketMessage\.filter\(/,
  },
  // A PENDING joiner has no active profile to scope by (known gap, P6/P8:
  // resolve the admin recipients server-side).
  'src/lib/onboardingTenantCreation.js': { UserProfile: /app_role: 'ADMIN'/ },
  // Pure mirror of the provisionOnboardingProfile function: `sr` is the
  // service role there.
  'src/lib/authorization/onboardingProvision.js': { UserProfile: /sr\.entities/ },
  // Platform-owner seed tool (SeedTestData has no school role).
  'src/lib/testData/seedTestData.js': { Classroom: /sdk\.entities/ },
};

// `x.entities.Name` not followed by a write call. Group 1: entity; group 2:
// the member used, if any.
const DIRECT_READ = /\.entities\.([A-Z][A-Za-z]+)\b(?!\.(?:create|update|delete|bulkCreate)\s*\()(\.\w+)?/g;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (/\.(jsx?|tsx?)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(rel);
  }
  return out;
}

test('src/ never reads a school-scoped entity directly', () => {
  const scoped = new Set(Object.keys(READ_RULES));
  const offenders = [];
  for (const file of walk('src')) {
    const lines = read(file).split('\n');
    lines.forEach((line, i) => {
      // Any `x.entities.Name` that is not a write: `.filter(` / `.list(` /
      // `.get(`, but also the handler passed as a value
      // (`fetchAllPages(base44.entities.Attendance, …)`, `const h =
      // base44.entities.X`) — which is how Reportes' direct reads slipped
      // past the first version of this scan.
      for (const m of line.matchAll(DIRECT_READ)) {
        const entity = m[1];
        if (!scoped.has(entity)) continue;
        const allowed = DIRECT_READ_EXCEPTIONS[file]?.[entity];
        // The call's own arguments may wrap onto the next lines; the line
        // before is included so an exception can anchor to its branch.
        if (allowed && allowed.test(lines.slice(Math.max(0, i - 1), i + 4).join(' '))) continue;
        offenders.push(`${file}:${i + 1} ${entity}${m[2] || ' (handler as a value)'}`);
      }
      // Dynamic `x.entities[name].filter(` hides the entity from this scan.
      if (/\.entities\[[^\]]+\]\.(list|filter|get)\s*\(/.test(line)) offenders.push(`${file}:${i + 1} dynamic entities[...] read`);
    });
  }
  assert.deepEqual(offenders, [], `read these through schoolRead (src/lib/data/schoolRead.js):\n${offenders.join('\n')}`);
});

test('the scan catches a handler passed as a value, and lets writes through', () => {
  const hits = (text) => [...text.matchAll(DIRECT_READ)].map((m) => m[1]);
  assert.deepEqual(hits('fetchAllPages(base44.entities.Attendance, q)'), ['Attendance']);
  assert.deepEqual(hits('const h = base44.entities.DiaryEntry; h.filter({})'), ['DiaryEntry']);
  assert.deepEqual(hits('base44.entities.Student.filter({})'), ['Student']);
  assert.deepEqual(hits('base44.entities.NoticeDelivery.create({})'), []);
  assert.deepEqual(hits('base44.entities.Notice.update(id, {})'), []);
  // The old Reportes line would fail the scan.
  assert.equal(DIRECT_READ_EXCEPTIONS['src/pages/Reportes.jsx'], undefined);
});

test('no batch in src/ carries more scan-mode reads than the server accepts', () => {
  let batches = 0;
  for (const file of walk('src')) {
    const source = read(file);
    for (const m of source.matchAll(/schoolReadMany\(\{([\s\S]*?)\}\);/g)) {
      batches += 1;
      const entities = [...m[1].matchAll(/\[\s*'([A-Z][A-Za-z]+)'/g)].map((e) => e[1]);
      for (const role of ['ADMIN', 'TEACHER', 'PARENT']) {
        const scans = entities.filter((entity) => needsScan(role, entity)).length;
        assert.ok(scans <= MAX_SCANS_PER_BATCH, `${file}: ${scans} scan reads for ${role} (${entities.join(', ')})`);
      }
    }
  }
  assert.ok(batches >= 3, 'expected to find the home/operation batches');
});

test('every exception above still exists (no stale allowances)', () => {
  for (const [file, entities] of Object.entries(DIRECT_READ_EXCEPTIONS)) {
    const source = read(file);
    for (const entity of Object.keys(entities)) {
      assert.match(source, new RegExp(`\\.entities\\.${entity}\\.(list|filter|get)\\(`), `${file} no longer reads ${entity} directly — drop the exception`);
    }
  }
});

test('the entity RLS stays strict: no read rule was loosened to make reads work', () => {
  // Owner decision: school users read through service-role functions; the
  // read rules keep granting only the platform owner or the caller's own rows.
  for (const entity of Object.keys(READ_RULES)) {
    const source = read(`base44/entities/${entity}.jsonc`).replace(/\/\/[^\n]*/g, '');
    const schema = JSON.parse(source);
    const rule = JSON.stringify(schema.rls?.read ?? null);
    assert.doesNotMatch(rule, /user\.data\.|school_id|app_role|"read":\s*true|^true$/, `${entity}.read was loosened: ${rule}`);
    const templates = rule.match(/\{\{[^}]+\}\}/g) || [];
    assert.ok(templates.every((t) => t === '{{user.id}}'), `${entity}.read uses ${templates.join(', ')}`);
  }
});

test('schoolRead is one function, under the endpoint cap', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'base44/functions/schoolRead/entry.ts')));
});

// --- the client wrapper --------------------------------------------------------

function fakeCall(total) {
  const calls = [];
  const call = async (payload) => {
    calls.push(payload);
    if (payload.queries) {
      return { ok: true, results: Object.fromEntries(payload.queries.map((q) => [q.key, [{ id: `${q.key}-1` }]])) };
    }
    if (payload.action === 'context') {
      return { ok: true, role: 'PARENT', school_id: 'A', classroom_ids: ['c1'], student_ids: ['s1'], link_student_ids: ['s1', 'gone'], students: [{ id: 's1' }], classrooms: [{ id: 'c1' }] };
    }
    const start = payload.skip || 0;
    const end = Math.min(total, start + payload.limit);
    const rows = Array.from({ length: Math.max(0, end - start) }, (_, i) => ({ id: `r${start + i}` }));
    return { ok: true, rows, has_more: end < total };
  };
  return { call, calls };
}

test('read() is a drop-in for entities.X.filter(filter, sort, limit)', async () => {
  const { call, calls } = fakeCall(30);
  const { read: schoolRead } = makeSchoolReader(call);
  const rows = await schoolRead('Student', { classroom_id: 'c1' }, 'first_name', 10);
  assert.equal(rows.length, 10);
  assert.deepEqual(calls[0], { entity: 'Student', filter: { classroom_id: 'c1' }, sort: 'first_name', limit: 10, skip: 0 });
});

test('read() without a limit pages through the server cap', async () => {
  const { call, calls } = fakeCall(2500);
  const { read: schoolRead } = makeSchoolReader(call);
  const rows = await schoolRead('EmergencyContact', { school_id: 'A' });
  assert.equal(rows.length, 2500);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.limit <= SCHOOL_READ_PAGE));
  assert.deepEqual(calls.map((c) => c.skip), [0, 1000, 2000]);
});

test('read() stops at 5000 rows when no limit is given', async () => {
  const { call } = fakeCall(9000);
  const { read: schoolRead } = makeSchoolReader(call);
  assert.equal((await schoolRead('Student')).length, 5000);
});

test('read() never asks for a skip the server refuses', async () => {
  assert.equal(SCHOOL_READ_MAX_SKIP, MAX_SKIP);
  assert.equal(SCHOOL_READ_PAGE, MAX_LIMIT);
  const { call, calls } = fakeCall(30000);
  const { read: schoolRead } = makeSchoolReader(call);
  const rows = await schoolRead('Attendance', {}, 'date', 25000);
  assert.equal(rows.length, SCHOOL_READ_MAX_TOTAL);
  assert.ok(calls.every((c) => c.skip <= MAX_SKIP));
});

test('read(…, SCHOOL_READ_ALL) returns everything, or throws instead of a cut list', async () => {
  const small = fakeCall(2500);
  assert.equal((await makeSchoolReader(small.call).read('Attendance', {}, 'date', SCHOOL_READ_ALL)).length, 2500);
  const exact = fakeCall(SCHOOL_READ_MAX_TOTAL);
  assert.equal((await makeSchoolReader(exact.call).read('Attendance', {}, 'date', SCHOOL_READ_ALL)).length, SCHOOL_READ_MAX_TOTAL);
  const big = fakeCall(SCHOOL_READ_MAX_TOTAL + 1);
  await assert.rejects(makeSchoolReader(big.call).read('Attendance', {}, 'date', SCHOOL_READ_ALL), { message: TOO_MANY_ROWS_MESSAGE });
  assert.ok(big.calls.every((c) => c.skip <= MAX_SKIP));
});

test('readMany() sends one request and maps results back by key', async () => {
  const { call, calls } = fakeCall(0);
  const { readMany } = makeSchoolReader(call);
  const out = await readMany({ a: ['Notice', { priority: 'URGENT' }, '-created_date', 50], b: ['NoticeDelivery', {}] });
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(out), ['a', 'b']);
  assert.equal(calls[0].queries[0].limit, 50);
  assert.equal(calls[0].queries[1].limit, SCHOOL_READ_PAGE);
});

test('context() normalizes the server\'s scope', async () => {
  const { call } = fakeCall(0);
  const { context } = makeSchoolReader(call);
  const c = await context();
  assert.equal(c.role, 'PARENT');
  assert.deepEqual(c.linkStudentIds, ['s1', 'gone']);
  assert.deepEqual(c.students.map((s) => s.id), ['s1']);
});

test('the relation helpers ask the server for the caller\'s scope in one request', () => {
  const linked = read('src/lib/relations/getLinkedStudents.js');
  assert.match(linked, /schoolReadContext\(\)/);
  assert.doesNotMatch(linked, /entities\./);
  const classrooms = read('src/lib/relations/getLinkedClassrooms.js');
  assert.match(classrooms, /schoolReadContext\(\)/);
  // TeacherHome / BitacorasMaestro: one context call instead of
  // TeacherClassroom → Classroom → Student in sequence.
  for (const file of ['src/components/home/TeacherHome.jsx', 'src/pages/BitacorasMaestro.jsx']) {
    const source = read(file);
    assert.match(source, /schoolReadContext\(\)/, file);
    assert.doesNotMatch(source, /loadActiveStudentsByClassroomIds|loadClassroomsByIds|'TeacherClassroom'/, file);
  }
});
