import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeFakeMongoDb } from '../fixtures/fake-mongo-db.js';
import { readSchoolExport } from '../../base44/functions/exportSchoolData/_exportGate.ts';
import {
  EXPORT_ENTITY_LABELS,
  exportCompleteness,
  incompleteExportMessage,
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
