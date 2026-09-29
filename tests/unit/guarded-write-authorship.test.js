import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// The function's own pure rules, loaded as-is (Node 22 strips the TS types).
import {
  decideModifyExisting,
  stripServerOnlyFields,
  referencesToCheck,
} from '../../base44/functions/guardedEntityWrite/_policy.ts';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// P7 (2026-09-29, findings SEC-05/SEC-10): Notice/Homework/Attendance/
// DiaryEntry create/update became service-role only, so guardedEntityWrite is
// the only way to write them. Its role check alone said "a TEACHER may write
// DiaryEntry" — which let any teacher rewrite or delete a colleague's diary
// entries (minors' behavior and health notes), still attributed to the
// colleague. These pin the record-level rule.

test('a teacher cannot edit a record another teacher authored', () => {
  const decision = decideModifyExisting({
    entity: 'DiaryEntry',
    operation: 'update',
    appRole: 'TEACHER',
    userId: 'teacher-b',
    existing: { teacher_id: 'teacher-a' },
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.code, 'NOT_AUTHOR');
});

test('the author and a school ADMIN can edit the record', () => {
  assert.equal(
    decideModifyExisting({ entity: 'Notice', operation: 'update', appRole: 'TEACHER', userId: 't1', existing: { author_id: 't1' } }).ok,
    true,
  );
  assert.equal(
    decideModifyExisting({ entity: 'Notice', operation: 'update', appRole: 'ADMIN', userId: 'a1', existing: { author_id: 't1' } }).ok,
    true,
  );
});

test('only a school ADMIN may delete, even the author cannot', () => {
  const own = decideModifyExisting({ entity: 'Homework', operation: 'delete', appRole: 'TEACHER', userId: 't1', existing: { teacher_id: 't1' } });
  assert.equal(own.ok, false);
  assert.equal(own.code, 'DELETE_ADMIN_ONLY');
  assert.equal(decideModifyExisting({ entity: 'Homework', operation: 'delete', appRole: 'ADMIN', userId: 'a1', existing: {} }).ok, true);
});

test('a co-teacher assigned to the classroom may correct that day\'s attendance; one who is not may not', () => {
  const base = { entity: 'Attendance', operation: 'update', appRole: 'TEACHER', userId: 't2', existing: { recorded_by: 't1', classroom_id: 'c1' } };
  assert.equal(decideModifyExisting({ ...base, assignedClassroomIds: ['c1'] }).ok, true);
  assert.equal(decideModifyExisting({ ...base, assignedClassroomIds: ['c9'] }).ok, false);
  // The classroom exception is Attendance-only: a diary entry stays the author's.
  assert.equal(
    decideModifyExisting({ ...base, entity: 'DiaryEntry', existing: { teacher_id: 't1', classroom_id: 'c1' }, assignedClassroomIds: ['c1'] }).ok,
    false,
  );
});

test('an entity without an attribution field is never "authored" by a non-admin', () => {
  // ChargeItem has no author; a PermissionOverride allow must not turn into
  // "anyone may edit any charge".
  const decision = decideModifyExisting({ entity: 'ChargeItem', operation: 'update', appRole: 'TEACHER', userId: 'u', existing: { created_by_id: 'u' } });
  assert.equal(decision.ok, false);
});

test('server-only notification fields are stripped on create, not only on update', () => {
  // A teacher creating Attendance with parent_notified:true would silently
  // stop the absence email to the parents.
  const attendance = stripServerOnlyFields('Attendance', { status: 'absent', parent_notified: true, notified_at: '2026-01-01T00:00:00Z' });
  assert.deepEqual(attendance, { status: 'absent' });
  const diary = stripServerOnlyFields('DiaryEntry', { notes_text: 'x', notified_parent_emails: ['p@x.mx'], parents_notified_at: 'now' });
  assert.deepEqual(diary, { notes_text: 'x' });
  // Doesn't mutate the caller's object.
  const input = { parent_notified: true };
  stripServerOnlyFields('Attendance', input);
  assert.equal(input.parent_notified, true);
});

test('client references (classroom, event, concept, charge) are collected for the same-school check', () => {
  assert.deepEqual(referencesToCheck({ classroom_id: 'c1', title: 'x' }), [['classroom_id', 'Classroom', 'c1']]);
  assert.deepEqual(referencesToCheck({ classroom_id: '', event_id: null }), []);
  const fields = referencesToCheck({ classroom_id: 'c', concept_id: 'p', discount_id: 'd', event_id: 'e', charge_id: 'ch' }).map(([f]) => f);
  assert.deepEqual(fields.sort(), ['charge_id', 'classroom_id', 'concept_id', 'discount_id', 'event_id']);
});

test('guardedEntityWrite wires the rules in: record check before update/delete, reference check on both writes, audit rows', () => {
  const source = read('base44/functions/guardedEntityWrite/entry.ts');
  assert.match(source, /from '\.\/_policy\.ts';/);
  assert.match(source, /const decision = decideModifyExisting\(\{/);
  assert.match(source, /if \(!decision\.ok\) return bad\(403, decision\.code, decision\.message\);/);
  const refChecks = source.match(/const foreignRef = await firstForeignReference\(sr, (data|patch), schoolId\);/g) || [];
  assert.equal(refChecks.length, 2, 'expected the same-school reference check on create AND update');
  assert.match(source, /action: 'RECORD_UPDATED'/);
  assert.match(source, /action: 'RECORD_DELETED'/);
});
