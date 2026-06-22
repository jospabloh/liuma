import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestDataBlueprint, ENTITY_REQUIRED_FIELDS, TEST_PREFIX } from '../../src/lib/testData/blueprint.js';
import { deriveScopes, visibleStudentIds, visibleNoticeIds, visibleChargeIds } from '../../src/lib/testData/isolation.js';
import { resolveRefs } from '../../src/lib/testData/seedTestData.js';

const bp = buildTestDataBlueprint({ now: new Date('2026-06-22T00:00:00Z') });
const localIds = new Set([...bp.reserved, ...bp.users.map((u) => u.localId), ...bp.ops.map((o) => o.localId)]);

function collectRefs(value, acc) {
  if (Array.isArray(value)) value.forEach((v) => collectRefs(v, acc));
  else if (value && typeof value === 'object') {
    if ('ref' in value) acc.push(value.ref);
    else Object.values(value).forEach((v) => collectRefs(v, acc));
  }
  return acc;
}

// ── Referential integrity ──────────────────────────────────────────────────────
test('every symbolic ref resolves to a declared local id (no dangling FKs)', () => {
  for (const op of bp.ops) {
    for (const r of collectRefs(op.data, [])) {
      assert.ok(localIds.has(r), `op ${op.entity}#${op.localId} references undeclared '${r}'`);
    }
  }
});

test('local ids are unique', () => {
  const seen = new Set();
  for (const op of bp.ops) {
    assert.ok(!seen.has(op.localId), `duplicate local id ${op.localId}`);
    seen.add(op.localId);
  }
});

test('every op satisfies its entity required fields', () => {
  for (const op of bp.ops) {
    const required = ENTITY_REQUIRED_FIELDS[op.entity];
    assert.ok(required, `no required-field spec for ${op.entity}`);
    for (const field of required) {
      assert.ok(op.data[field] !== undefined && op.data[field] !== null, `${op.entity}#${op.localId} missing required '${field}'`);
    }
  }
});

test('single tenant: every record is scoped to SCHOOL', () => {
  for (const op of bp.ops) {
    assert.deepEqual(op.data.school_id, { ref: 'SCHOOL' }, `${op.entity}#${op.localId} not scoped to SCHOOL`);
  }
});

test('blueprint covers all 30 creatable entities (School + User handled separately)', () => {
  const covered = new Set(bp.ops.map((o) => o.entity));
  const expected = Object.keys(ENTITY_REQUIRED_FIELDS);
  for (const e of expected) assert.ok(covered.has(e), `entity ${e} not covered by blueprint`);
  assert.equal(covered.size, expected.length);
});

test('resolveRefs replaces refs and throws on unknown', () => {
  const idMap = { SCHOOL: 'sch1' };
  for (const id of localIds) idMap[id] = `id_${id}`;
  const resolved = resolveRefs({ a: { ref: 'CL_MAT' }, b: [{ ref: 'ST_ANA' }], c: 5 }, idMap);
  assert.equal(resolved.a, 'id_CL_MAT');
  assert.equal(resolved.b[0], 'id_ST_ANA');
  assert.equal(resolved.c, 5);
  assert.throws(() => resolveRefs({ x: { ref: 'NOPE' } }, idMap), /Unresolved ref 'NOPE'/);
});

// ── Role isolation ─────────────────────────────────────────────────────────────
test('teacher scopes are limited to their assigned classrooms', () => {
  const scopes = deriveScopes(bp);
  assert.deepEqual(scopes.U_TEACHER1.assigned_classroom_ids.sort(), ['CL_K1', 'CL_MAT']);
  assert.deepEqual(scopes.U_TEACHER2.assigned_classroom_ids, ['CL_P1']);
});

test('teachers only see students in their classrooms (and never each other’s)', () => {
  const t1 = visibleStudentIds(bp, 'U_TEACHER1').sort();
  const t2 = visibleStudentIds(bp, 'U_TEACHER2').sort();
  assert.deepEqual(t1, ['ST_ANA', 'ST_BENITO', 'ST_CARLA', 'ST_DIEGO']);
  assert.deepEqual(t2, ['ST_ELENA', 'ST_FELIPE']);
  assert.equal(t1.filter((s) => t2.includes(s)).length, 0, 'teacher visibility overlaps');
});

test('parents only see their own linked children', () => {
  assert.deepEqual(visibleStudentIds(bp, 'U_PARENT1').sort(), ['ST_ANA', 'ST_BENITO']);
  assert.deepEqual(visibleStudentIds(bp, 'U_PARENT2'), ['ST_CARLA']);
  // a parent cannot see another family's child
  assert.ok(!visibleStudentIds(bp, 'U_PARENT1').includes('ST_CARLA'));
});

test('admin (owner) sees every student in the school', () => {
  assert.equal(visibleStudentIds(bp, 'U_OWNER').length, 6);
});

test('classroom notices respect parent classroom scope; school notices reach all', () => {
  // NO_CLASS targets CL_MAT → only parent1 (linked to CL_MAT) sees it.
  assert.ok(visibleNoticeIds(bp, 'U_PARENT1').includes('NO_CLASS'));
  assert.ok(!visibleNoticeIds(bp, 'U_PARENT2').includes('NO_CLASS'));
  // both still see the SCHOOL-scope notices
  ['NO_SCHOOL', 'NO_URGENT'].forEach((n) => {
    assert.ok(visibleNoticeIds(bp, 'U_PARENT1').includes(n));
    assert.ok(visibleNoticeIds(bp, 'U_PARENT2').includes(n));
  });
});

test('parents only see charges for their own children', () => {
  assert.deepEqual(visibleChargeIds(bp, 'U_PARENT1').sort(), ['CH_ST_ANA', 'CH_ST_BENITO']);
  assert.deepEqual(visibleChargeIds(bp, 'U_PARENT2'), ['CH_ST_CARLA']);
  assert.equal(visibleChargeIds(bp, 'U_OWNER').length, 6);
});

test('test records are tagged with the [TEST] prefix on visible name fields', () => {
  const classrooms = bp.ops.filter((o) => o.entity === 'Classroom');
  assert.ok(classrooms.every((c) => c.data.name.startsWith(TEST_PREFIX)));
});
