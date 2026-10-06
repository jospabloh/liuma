import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { absenceRaceLoser, decideFamilyAccess, buildFamilyPayload } from '../../base44/functions/guardedFamilyWrite/_policy.ts';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// P7 (2026-09-29, finding SEC-04 / Base44 scan 3e73cac8): EmergencyContact's
// create RLS was "you created it", with no student or school check — anyone
// signed in could put themselves on any child's authorized-pickup list.
// AbsenceNotification / EventResponse / UniformOrder only checked
// parent_id == you, never that the child was yours. These pin the rules the
// new guardedFamilyWrite function applies instead.

const ctx = {
  isAdmin: false,
  userId: 'parent-1',
  userName: 'Ana Pérez',
  schoolId: 'school-A',
  studentId: 'student-1',
};

test('someone not linked to the child cannot write a family record for them', () => {
  const decision = decideFamilyAccess({ entity: 'EmergencyContact', operation: 'create', isAdmin: false, isLinkedParent: false, userId: 'stranger' });
  assert.equal(decision.ok, false);
  assert.equal(decision.code, 'NOT_LINKED');
  for (const entity of ['AbsenceNotification', 'EventResponse', 'UniformOrder']) {
    assert.equal(decideFamilyAccess({ entity, operation: 'create', isAdmin: false, isLinkedParent: false, userId: 'x' }).ok, false, entity);
  }
});

test('a linked parent and a school ADMIN can; unsupported operations are refused', () => {
  assert.equal(decideFamilyAccess({ entity: 'EmergencyContact', operation: 'create', isAdmin: false, isLinkedParent: true, userId: 'p' }).ok, true);
  assert.equal(decideFamilyAccess({ entity: 'EmergencyContact', operation: 'delete', isAdmin: true, isLinkedParent: false, userId: 'a' }).ok, true);
  // A parent never deletes an absence request or edits a uniform order through here.
  assert.equal(decideFamilyAccess({ entity: 'AbsenceNotification', operation: 'update', isAdmin: false, isLinkedParent: true, userId: 'p' }).ok, false);
  assert.equal(decideFamilyAccess({ entity: 'UniformOrder', operation: 'delete', isAdmin: true, isLinkedParent: false, userId: 'a' }).ok, false);
});

test('only the parent who answered may change an event response', () => {
  const other = decideFamilyAccess({
    entity: 'EventResponse', operation: 'update', isAdmin: false, isLinkedParent: true, userId: 'parent-2', existing: { parent_id: 'parent-1' },
  });
  assert.equal(other.ok, false);
  assert.equal(other.code, 'NOT_OWN_RESPONSE');
});

test('a parent may only change or remove an emergency contact they added themselves', () => {
  const base = { entity: 'EmergencyContact', isAdmin: false, isLinkedParent: true, userId: 'parent-2' };
  for (const operation of ['update', 'delete']) {
    assert.equal(decideFamilyAccess({ ...base, operation, existing: { added_by_user_id: 'parent-1' } }).code, 'NOT_OWN_CONTACT', operation);
    assert.equal(decideFamilyAccess({ ...base, operation, existing: {} }).code, 'NOT_OWN_CONTACT', operation);
    assert.equal(decideFamilyAccess({ ...base, operation, existing: { added_by_user_id: 'parent-2' } }).ok, true, operation);
    // Pre-P7 rows, created directly by the parent, carry only created_by_id.
    assert.equal(decideFamilyAccess({ ...base, operation, existing: { created_by_id: 'parent-2' } }).ok, true, operation);
    assert.equal(decideFamilyAccess({ ...base, isAdmin: true, operation, existing: { added_by_user_id: 'parent-1' } }).ok, true, operation);
  }
  // The stored author is set by the server, so the parent keeps read access
  // (EmergencyContact.read keys on data.added_by_user_id).
  const built = buildFamilyPayload('EmergencyContact', 'create', { name: 'X', phone: '1', added_by_user_id: 'someone' }, ctx);
  assert.equal(built.data.added_by_user_id, 'parent-1');
  const schema = JSON.parse(read('base44/entities/EmergencyContact.jsonc').replace(/^\s*\/\/.*$/gm, ''));
  assert.ok(schema.rls.read.$or.some((rule) => rule['data.added_by_user_id'] === '{{user.id}}'));
});

test('a parent cannot authorize a pickup contact; an ADMIN can', () => {
  const byParent = buildFamilyPayload('EmergencyContact', 'create', { name: 'Tío Juan', phone: '4491234567', is_authorized_pickup: true }, ctx);
  assert.equal(byParent.ok, true);
  assert.equal(byParent.data.is_authorized_pickup, false);
  const byAdmin = buildFamilyPayload('EmergencyContact', 'create', { name: 'Tío Juan', phone: '4491234567', is_authorized_pickup: true }, { ...ctx, isAdmin: true });
  assert.equal(byAdmin.data.is_authorized_pickup, true);
});

test('school and student come from the server, never from the request body', () => {
  const built = buildFamilyPayload(
    'EmergencyContact',
    'create',
    { name: 'X', phone: '1', school_id: 'school-B', student_id: 'someone-else' },
    ctx,
  );
  assert.equal(built.data.school_id, 'school-A');
  assert.equal(built.data.student_id, 'student-1');
});

test('a parent changing the phone of an authorized contact loses the authorization until the school confirms it', () => {
  // Changing the phone or name of an authorized pickup changes WHO is
  // authorized; editing a note does not.
  const existing = { name: 'Tío Juan', relationship: 'Tío', phone: '4491234567', is_authorized_pickup: true };
  const phoneChange = buildFamilyPayload('EmergencyContact', 'update', { phone: '4499999999' }, { ...ctx, existing });
  assert.equal(phoneChange.data.is_authorized_pickup, false);
  assert.equal(phoneChange.pickupRevoked, true);
  const noteChange = buildFamilyPayload('EmergencyContact', 'update', { notes: 'Llega en auto rojo' }, { ...ctx, existing });
  assert.equal('is_authorized_pickup' in noteChange.data, false);
  assert.equal(noteChange.pickupRevoked, false);
  // A parent can't turn it back on either.
  const reenable = buildFamilyPayload('EmergencyContact', 'update', { is_authorized_pickup: true }, { ...ctx, existing: { ...existing, is_authorized_pickup: false } });
  assert.equal('is_authorized_pickup' in reenable.data, false);
});

test('an absence request is always filed as PENDING, by the caller', () => {
  const built = buildFamilyPayload(
    'AbsenceNotification',
    'create',
    { absence_date: '2026-10-02', reason: 'Cita médica', status: 'APPROVED', parent_id: 'someone-else', reviewed_by: 'x' },
    { ...ctx, today: '2026-10-01' },
  );
  assert.equal(built.ok, true);
  assert.equal(built.data.status, 'PENDING');
  assert.equal(built.data.parent_id, 'parent-1');
  assert.equal('reviewed_by' in built.data, false);
  assert.equal(buildFamilyPayload('AbsenceNotification', 'create', { absence_date: 'mañana', reason: 'x' }, ctx).ok, false);
});

test('an event response\'s payment status is derived from the event, and a parent can never mark it PAID', () => {
  const paid = buildFamilyPayload('EventResponse', 'create', { event_id: 'e1', response: 'ACCEPTED', payment_status: 'PAID' }, { ...ctx, event: { has_cost: true } });
  assert.equal(paid.data.payment_status, 'PENDING');
  const free = buildFamilyPayload('EventResponse', 'create', { event_id: 'e1', response: 'ACCEPTED' }, { ...ctx, event: { has_cost: false } });
  assert.equal(free.data.payment_status, 'NOT_REQUIRED');
  const update = buildFamilyPayload('EventResponse', 'update', { payment_status: 'PAID' }, { ...ctx, existing: { payment_status: 'PENDING' } });
  assert.equal('payment_status' in update.data, false);
  const attach = buildFamilyPayload('EventResponse', 'update', {}, { ...ctx, existing: { payment_status: 'NOT_REQUIRED' }, chargeId: 'ch1' });
  assert.deepEqual(attach.data, { charge_id: 'ch1', payment_status: 'PENDING' });
});

test('a uniform order is created PENDING with sanitized items', () => {
  const built = buildFamilyPayload(
    'UniformOrder',
    'create',
    {
      items: [{ product: 'Playera', size: 'M', quantity: '2' }, { product: '', size: 'S' }, { product: 'Short', size: 'S', quantity: -4 }],
      status: 'DELIVERED',
      admin_notes: 'x',
      measurements: { pecho: 60, nested: { a: 1 } },
    },
    ctx,
  );
  assert.equal(built.ok, true);
  assert.equal(built.data.status, 'PENDING');
  assert.equal('admin_notes' in built.data, false);
  assert.deepEqual(built.data.items, [{ product: 'Playera', size: 'M', quantity: 2 }, { product: 'Short', size: 'S', quantity: 1 }]);
  assert.deepEqual(built.data.measurements, { pecho: '60' });
  assert.equal(buildFamilyPayload('UniformOrder', 'create', { items: [] }, ctx).ok, false);
});

test('guardedFamilyWrite takes the school from the student record and re-checks the stored record\'s school', () => {
  const source = read('base44/functions/guardedFamilyWrite/entry.ts');
  assert.match(source, /const schoolId = String\(student\.school_id \|\| ''\);/);
  assert.match(source, /existing && String\(existing\.school_id \|\| ''\) !== schoolId/);
  assert.match(source, /sr\.entities\.ParentStudent\.filter\(\{\s*parent_id: user\.id,\s*student_id: studentId,\s*status: 'ACTIVE',/);
});

// The pre-create duplicate read is not atomic: two requests for the same child
// and day can both pass it. Each racer re-reads after creating and applies the
// same rule, so they agree on one keeper and exactly one row survives.
test('absence race: both racers agree on one keeper (oldest live, then id)', () => {
  const a = { id: 'b2', student_id: 's1', absence_date: '2026-10-05', status: 'PENDING', created_date: '2026-10-01T10:00:00.000Z' };
  const b = { id: 'a9', student_id: 's1', absence_date: '2026-10-05', status: 'PENDING', created_date: '2026-10-01T10:00:00.000Z' };
  const rows = [a, b];
  // Same instant: the lower id keeps the day.
  assert.equal(absenceRaceLoser(rows, b), false);
  assert.equal(absenceRaceLoser(rows, a), true);
  // The re-read may not show our own row yet: it still counts.
  assert.equal(absenceRaceLoser([b], a), true);
  assert.equal(absenceRaceLoser([], b), false);
});

test('absence race: a REJECTED row or another day/child never makes the new one lose', () => {
  const mine = { id: 'z1', student_id: 's1', absence_date: '2026-10-05', status: 'PENDING', created_date: '2026-10-01T10:00:05.000Z' };
  const rows = [
    { id: 'a1', student_id: 's1', absence_date: '2026-10-05', status: 'REJECTED', created_date: '2026-10-01T09:00:00.000Z' },
    { id: 'a2', student_id: 's1', absence_date: '2026-10-06', status: 'PENDING', created_date: '2026-10-01T09:00:00.000Z' },
    { id: 'a3', student_id: 's2', absence_date: '2026-10-05', status: 'PENDING', created_date: '2026-10-01T09:00:00.000Z' },
    mine,
  ];
  assert.equal(absenceRaceLoser(rows, mine), false);
});

test('guardedFamilyWrite removes its own row when it loses the absence race', () => {
  const src = read('base44/functions/guardedFamilyWrite/entry.ts');
  assert.match(src, /absenceRaceLoser\(after,/);
  assert.match(src, /const id = String\(record\.id\);[\s\S]*?AbsenceNotification\.delete\(id\)/);
});
