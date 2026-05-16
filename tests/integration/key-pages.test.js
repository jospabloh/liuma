import test from 'node:test';
import assert from 'node:assert/strict';
import { filterByRowLevel } from '../../src/lib/authorization/policy.js';
import { actors, rows } from '../fixtures/authorization-fixtures.js';

const pages = [
  { name: 'Home', entity: 'Notice', dataset: rows.notices, actor: actors.parentStudentA1, expectedIds: ['not-1', 'not-2'] },
  { name: 'Asistencia', entity: 'Attendance', dataset: rows.attendance, actor: actors.teacherClassA1, expectedIds: ['att-1'] },
  { name: 'Avisos', entity: 'Notice', dataset: rows.notices, actor: actors.teacherClassA1, expectedIds: ['not-1', 'not-2'] },
  { name: 'Pagos', entity: 'ChargeItem', dataset: rows.chargeItems, actor: actors.parentStudentA1, expectedIds: ['chg-1'] },
  { name: 'Bitacora', entity: 'DiaryEntry', dataset: rows.diaryEntries, actor: actors.teacherClassA1, expectedIds: ['dia-1'] },
];

for (const page of pages) {
  test(`${page.name} enforces scoped visibility`, () => {
    const visible = filterByRowLevel({
      role: page.actor.role,
      entity: page.entity,
      rows: page.dataset,
      classroomIds: page.actor.classroomIds,
      studentIds: page.actor.studentIds,
    });

    assert.deepEqual(visible.map((row) => row.id), page.expectedIds);
  });
}
