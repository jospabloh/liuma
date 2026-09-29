import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { READ_RULES } from '../../base44/functions/schoolRead/_scope.ts';
import { makeSchoolReader, SCHOOL_READ_PAGE } from '../../src/lib/data/schoolReadCore.js';

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
    SupportTicketMessage: /isOwner|ticket_id: ticketId/,
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
      // `x.entities.Name.filter(` / `.list(` / `.get(`
      for (const m of line.matchAll(/\.entities\.([A-Z][A-Za-z]+)\.(list|filter|get)\s*\(/g)) {
        const entity = m[1];
        if (!scoped.has(entity)) continue;
        const allowed = DIRECT_READ_EXCEPTIONS[file]?.[entity];
        // The call's own arguments may wrap onto the next lines.
        if (allowed && allowed.test(lines.slice(i, i + 4).join(' '))) continue;
        offenders.push(`${file}:${i + 1} ${entity}.${m[2]}`);
      }
      // Dynamic `x.entities[name].filter(` hides the entity from this scan.
      if (/\.entities\[[^\]]+\]\.(list|filter|get)\s*\(/.test(line)) offenders.push(`${file}:${i + 1} dynamic entities[...] read`);
    });
  }
  assert.deepEqual(offenders, [], `read these through schoolRead (src/lib/data/schoolRead.js):\n${offenders.join('\n')}`);
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
