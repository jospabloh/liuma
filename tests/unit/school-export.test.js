import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeFakeMongoDb } from '../fixtures/fake-mongo-db.js';
import { EXPORT_BUDGET_MS, EXPORT_PAGE_SIZE, parseResume, readSchoolExport } from '../../base44/functions/exportSchoolData/_exportGate.ts';
import {
  EXPORT_ENTITY_LABELS,
  exportCompleteness,
  incompleteExportMessage,
  runExportRounds,
  schoolDeletionRequestAllowed,
} from '../../src/lib/account/schoolExportStatus.js';

// Codex review of PR #197, round 10. exportSchoolData read each entity with a
// bare filter() — the SDK's default first page — so a real school's export
// was silently cut, and the deletion page then said "Descarga iniciada" and
// invited the only director to ask for the school's irreversible deletion.

const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const ENTITIES = JSON.parse(read('base44/functions/exportSchoolData/entry.ts')
  .match(/const EXPORTED_ENTITIES = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
const rows = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({
  id: `r${String(i).padStart(6, '0')}`, school_id: 'sA', created_date: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)).toISOString(), ...extra,
}));

test('an entity with more than 1,000 rows is exported whole, and another school\'s rows never are', async () => {
  const db = makeFakeMongoDb({
    Attendance: [...rows(1234), ...rows(10).map((r) => ({ ...r, id: `b-${r.id}`, school_id: 'sB' }))],
    Student: rows(3),
  });
  const out = await readSchoolExport(db, 'sA', ENTITIES);
  assert.equal(out.data.Attendance.length, 1234);
  assert.equal(new Set(out.data.Attendance.map((r) => r.id)).size, 1234);
  assert.ok(out.data.Attendance.every((r) => r.school_id === 'sA'));
  assert.equal(out.data.Student.length, 3);
  assert.deepEqual([out.complete, out.incomplete], [true, []]);
});

test('an entity that cannot be read is flagged; the rest is still exported', async () => {
  const db = makeFakeMongoDb({ Student: rows(5), Attendance: rows(2) }, { failOn: { entity: 'Student', op: 'filter', message: 'store down' } });
  const out = await readSchoolExport(db, 'sA', ENTITIES);
  assert.equal(out.complete, false);
  assert.deepEqual(out.incomplete, ['Student']);
  assert.match(out.errors.Student, /store down/);
  assert.equal(out.data.Attendance.length, 2);
  const src = read('base44/functions/exportSchoolData/entry.ts');
  assert.match(src, /complete: exported\.complete,\s*incomplete: exported\.incomplete,/);
  assert.doesNotMatch(src, /entity\.filter\(\{ school_id: schoolId \}\)/, 'no unpaged read left');
});

test('the client names what is missing, and asking for the school\'s deletion needs a full backup or an acknowledgement', () => {
  for (const name of ENTITIES) assert.ok(EXPORT_ENTITY_LABELS[name], `label for ${name}`);
  const full = exportCompleteness({ ok: true, complete: true, incomplete: [] });
  assert.deepEqual(full, { complete: true, missing: [] });
  const partial = exportCompleteness({ ok: true, complete: false, incomplete: ['Attendance', 'ChargeItem'] });
  assert.deepEqual(partial.missing, ['asistencia', 'cargos']);
  assert.match(incompleteExportMessage(partial), /NO es un respaldo completo\. Falta: asistencia, cargos/);
  // An older server (no `complete`) cut every list at 100: not complete.
  assert.equal(exportCompleteness({ ok: true, data: {} }).complete, false);
  assert.equal(schoolDeletionRequestAllowed({ backup: full, acknowledged: false }), true);
  assert.equal(schoolDeletionRequestAllowed({ backup: partial, acknowledged: false }), false);
  assert.equal(schoolDeletionRequestAllowed({ backup: null, acknowledged: false }), false);
  assert.equal(schoolDeletionRequestAllowed({ backup: partial, acknowledged: true }), true);
});

test('neither screen calls an incomplete export a success, and both gate the school\'s deletion request', () => {
  for (const [page, gate] of [['src/pages/EliminarCuenta.jsx', 'schoolDeletionAllowed'], ['src/pages/PermisosRoles.jsx', 'deletionAllowed']]) {
    const src = read(page);
    assert.doesNotMatch(src, /toast\.success\('Descarga iniciada'\)/, page);
    assert.match(src, /if \(result\.complete\) toast\.success\('Respaldo completo descargado'\);\s*else toast\.warning\(incompleteExportMessage\(result\)/, page);
    assert.match(src, /<SchoolBackupStatus backup=\{backup\} acknowledged=\{backupAcknowledged\} onAcknowledge=\{setBackupAcknowledged\}/, page);
    assert.match(src, new RegExp(`disabled=\\{[^}]*!${gate}\\}`), `${page}: the school-deletion request is disabled until allowed`);
  }
  assert.match(read('src/components/account/SchoolBackupStatus.jsx'), /Continuar sin respaldo completo/);
  assert.match(read('src/lib/account/schoolExport.js'), /return exportCompleteness\(payload\);/);
});

test('other reads that feed decisions are complete or refuse', () => {
  const govern = read('base44/functions/governRoleChange/entry.ts');
  assert.match(govern, /readAllPages\(sr\.entities\.UserProfile, \{ school_id: schoolId \}\)/);
  assert.doesNotMatch(govern, /UserProfile\.filter\(\{ school_id: schoolId \}\)/);
  const fanout = read('base44/functions/guardedEntityWrite/_schoolWrite.ts');
  assert.match(fanout, /\[students, links, parents, existing\]\.some\(\(list\) => \(list \|\| \[\]\)\.length >= FANOUT_READ_LIMIT\)/);
});

// ── rate limit and size (our review of 96166fe) ──────────────────────────────
// 500-row pages made a year of a 100-student school ~130 sequential calls,
// next to Base44's ~150/min app-wide limit, and a rate-limit answer just
// marked the entity incomplete.

function counting(db) {
  const calls = [];
  const entities = new Proxy({}, { get: (_, n) => ({ filter: (...a) => { calls.push(n); return db.entities[n].filter(...a); } }) });
  return { sr: { entities }, calls };
}
const instant = { sleep: async () => {} };

test('a 20,000-row entity exports in fewer than 10 calls (5,000 per call, the SDK maximum)', async () => {
  assert.equal(EXPORT_PAGE_SIZE, 5000);
  const { sr, calls } = counting(makeFakeMongoDb({ Attendance: rows(20000) }));
  const out = await readSchoolExport(sr, 'sA', ['Attendance'], instant);
  assert.equal(out.data.Attendance.length, 20000);
  assert.equal(out.complete, true);
  assert.ok(calls.length < 10, `${calls.length} calls`);
});

test('a year of a 100-student school: every row, in about 35 calls', async (t) => {
  const sizes = {
    Student: 100, Classroom: 6, TeacherClassroom: 12, ParentStudent: 160, ParentProfile: 150,
    Attendance: 18000, Homework: 1200, DiaryEntry: 18000, Notice: 250, NoticeDelivery: 20000,
    AbsenceNotification: 400, EmergencyContact: 300, Event: 60, EventResponse: 3000,
    PaymentConcept: 20, ChargeItem: 1300, PaymentRecord: 1300, Discount: 10, UniformOrder: 200,
    OfficialDocument: 40, WeeklyMenu: 40, SchoolSetupGuide: 12, SupportTicket: 30, UserProfile: 180,
  };
  const tables = Object.fromEntries(Object.entries(sizes).map(([n, k]) => [n, rows(k)]));
  const { sr, calls } = counting(makeFakeMongoDb(tables));
  const out = await readSchoolExport(sr, 'sA', ENTITIES, instant);
  assert.equal(out.complete, true);
  for (const [n, k] of Object.entries(sizes)) assert.equal(out.data[n].length, k, n);
  t.diagnostic(`calls: ${calls.length} (500-row pages: ${Object.values(sizes).reduce((a, k) => a + Math.max(1, Math.ceil(k / 499)), 0)})`);
  assert.ok(calls.length <= 40, `${calls.length} calls`);
});

test('a rate-limit answer mid-export waits (3 s, then 6 s) and retries the same page, ending complete', async () => {
  const db = makeFakeMongoDb({ Attendance: rows(12000), Student: rows(10) });
  let n = 0;
  const filter = db.entities.Attendance.filter;
  db.entities.Attendance.filter = async (...a) => {
    n += 1;
    if (n === 2 || n === 3) throw Object.assign(new Error('Rate limit exceeded'), { status: 429 });
    return filter(...a);
  };
  const waits = [];
  let clock = 0;
  const out = await readSchoolExport(db, 'sA', ['Attendance', 'Student'], { now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; } });
  assert.deepEqual(waits, [3000, 6000]);
  assert.deepEqual([out.complete, out.incomplete, out.resume], [true, [], null]);
  assert.equal(new Set(out.data.Attendance.map((r) => r.id)).size, 12000);
});

test('when the budget runs out the call answers `resume`, and the next call finishes — every row exactly once', async () => {
  // Pairs of rows share a creation time, so page boundaries fall on ties.
  const tied = rows(9000).map((r, i) => ({ ...r, created_date: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, Math.floor(i / 2))).toISOString() }));
  const db = makeFakeMongoDb({ Attendance: tied, Student: rows(7000), Homework: rows(3) });
  // Each call uses up the 45 s budget, so every call reads one page and the
  // first stop falls inside Attendance, on a page boundary that is a tie.
  let clock = 0;
  const filter = db.entities.Attendance.filter;
  for (const name of ['Attendance', 'Student', 'Homework']) {
    const f = db.entities[name].filter;
    db.entities[name].filter = async (...a) => { clock += 50_000; return f(...a); };
  }
  void filter;
  const entities = ['Attendance', 'Student', 'Homework'];
  const first = await readSchoolExport(db, 'sA', entities, { now: () => clock, ...instant });
  assert.equal(first.complete, false);
  assert.ok(first.resume, 'resume token');
  assert.equal(first.resume.entity, 'Attendance');
  assert.ok(first.resume.boundaryIds.length >= 1, 'the rows already sent at the boundary travel with the token');
  assert.equal(EXPORT_BUDGET_MS, 45_000);
  // The client's loop: the same function called again with the token.
  const invoke = async (body) => {
    clock = 0;
    const out = await readSchoolExport(db, 'sA', entities, { now: () => clock, ...instant, resume: parseResume(body.resume, entities) });
    return { ok: true, ...out };
  };
  const merged = await runExportRounds(invoke, { sleep: async () => {} });
  assert.equal(merged.complete, true, JSON.stringify({ rounds: merged.rounds, resume: merged.resume, incomplete: merged.incomplete }));
  assert.ok(merged.rounds >= 2);
  for (const [name, k] of [['Attendance', 9000], ['Student', 7000], ['Homework', 3]]) {
    assert.equal(merged.data[name].length, k, name);
    assert.equal(new Set(merged.data[name].map((r) => r.id)).size, k, `${name}: no duplicates across rounds`);
  }
});

test('the client loop is bounded, and an unfinished or old-server export is never called complete', async () => {
  let calls = 0;
  const never = async () => { calls += 1; return { ok: true, complete: false, data: { Student: [] }, incomplete: [], resume: { entity: 'Student', since: null, boundaryIds: [] } }; };
  const out = await runExportRounds(never, { maxRounds: 3, sleep: async () => {} });
  assert.equal(calls, 3);
  assert.equal(out.complete, false);
  assert.deepEqual(exportCompleteness(out).missing, ['alumnos']);
  const old = await runExportRounds(async () => ({ ok: true, data: { Student: [] } }), { sleep: async () => {} });
  assert.equal(old.complete, false);
  assert.match(read('src/lib/account/schoolExport.js'), /runExportRounds\(\(body\) => invokeFunction\(base44, 'exportSchoolData', body\)\)/);
  assert.match(read('base44/functions/exportSchoolData/entry.ts'), /resume: parseResume\(body\?\.resume, EXPORTED_ENTITIES\)/);
});
