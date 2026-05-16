import test from 'node:test';
import assert from 'node:assert/strict';
import { canReadEntity, canWriteEntity, buildScopedFilter, filterByRowLevel } from '../../src/lib/authorization/policy.js';
import { actors, rows } from '../fixtures/authorization-fixtures.js';

test('denies unknown entities by default', () => {
  assert.equal(canReadEntity('ADMIN', 'UnknownEntity'), false);
  assert.equal(canWriteEntity('ADMIN', 'UnknownEntity'), false);
});

test('keeps parent scoped to linked student data only', () => {
  const visible = filterByRowLevel({
    role: actors.parentStudentA1.role,
    entity: 'Attendance',
    rows: rows.attendance,
    classroomIds: actors.parentStudentA1.classroomIds,
    studentIds: actors.parentStudentA1.studentIds,
  });

  assert.deepEqual(visible.map((item) => item.id), ['att-1']);
});

test('keeps teacher scoped to assigned classroom rows only', () => {
  const visible = filterByRowLevel({
    role: actors.teacherClassA1.role,
    entity: 'DiaryEntry',
    rows: rows.diaryEntries,
    classroomIds: actors.teacherClassA1.classroomIds,
  });

  assert.deepEqual(visible.map((item) => item.id), ['dia-1']);
});

test('allows admin to see all rows', () => {
  const visible = filterByRowLevel({
    role: actors.adminSchoolA.role,
    entity: 'Notice',
    rows: rows.notices,
  });

  assert.deepEqual(visible.map((item) => item.id), ['not-1', 'not-2', 'not-3']);
});

test('builds teacher scoped filters with classroom restriction', () => {
  const filter = buildScopedFilter({
    role: actors.teacherClassA1.role,
    entity: 'Attendance',
    schoolId: actors.teacherClassA1.schoolId,
    classroomIds: actors.teacherClassA1.classroomIds,
  });

  assert.deepEqual(filter, {
    school_id: 'school-a',
    classroom_id: { $in: ['class-a1'] },
  });
});
