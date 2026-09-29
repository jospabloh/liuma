import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decideCreateTargets } from '../../base44/functions/guardedEntityWrite/_policy.ts';

// P10 review (2026-09-29). schoolRead shows a classroom's attendance, diary
// and homework to that classroom's teachers, and a child's records and
// STUDENT/CLASSROOM notices to that child's parents. So a TEACHER creating one
// must name their OWN classroom and a child who is actually in it — before
// this, guardedEntityWrite only checked "same school".

const teacher = (entity, data, studentClassroomId = null) => decideCreateTargets({
  entity, appRole: 'TEACHER', data, assignedClassroomIds: ['c1'], studentClassroomId,
});

test('classroom-bound records: own classroom, and a student who is in it', () => {
  for (const entity of ['Attendance', 'DiaryEntry']) {
    assert.equal(teacher(entity, { classroom_id: 'c1', student_id: 's1' }, 'c1').ok, true, entity);
    assert.equal(teacher(entity, { classroom_id: 'c2', student_id: 's2' }, 'c2').code, 'CLASSROOM_NOT_ASSIGNED', entity);
    // Own classroom, but a child of another one.
    assert.equal(teacher(entity, { classroom_id: 'c1', student_id: 's2' }, 'c2').code, 'STUDENT_NOT_IN_CLASSROOM', entity);
    assert.equal(teacher(entity, { student_id: 's1' }, 'c1').code, 'CLASSROOM_NOT_ASSIGNED', entity);
  }
  assert.equal(teacher('Homework', { classroom_id: 'c1' }).ok, true);
  assert.equal(teacher('Homework', { classroom_id: 'c2' }).code, 'CLASSROOM_NOT_ASSIGNED');
});

test('notices: CLASSROOM and STUDENT targets inside the teacher\'s classrooms', () => {
  assert.equal(teacher('Notice', { scope: 'CLASSROOM', classroom_id: 'c1' }).ok, true);
  assert.equal(teacher('Notice', { scope: 'CLASSROOM', classroom_id: 'c2' }).code, 'CLASSROOM_NOT_ASSIGNED');
  assert.equal(teacher('Notice', { scope: 'STUDENT', student_id: 's1' }, 'c1').ok, true);
  assert.equal(teacher('Notice', { scope: 'STUDENT', student_id: 's2' }, 'c2').code, 'CLASSROOM_NOT_ASSIGNED');
  assert.equal(teacher('Notice', { scope: 'STUDENT', student_id: 's1', classroom_id: 'c9' }, 'c1').code, 'STUDENT_NOT_IN_CLASSROOM');
  assert.equal(teacher('Notice', { scope: 'STUDENT' }).code, 'CLASSROOM_NOT_ASSIGNED');
  // A school-wide notice is not a classroom target (unchanged).
  assert.equal(teacher('Notice', { scope: 'SCHOOL' }).ok, true);
});

test('an ADMIN is not restricted, and unrelated entities pass', () => {
  assert.equal(decideCreateTargets({ entity: 'DiaryEntry', appRole: 'ADMIN', data: { classroom_id: 'cX', student_id: 's' }, assignedClassroomIds: [], studentClassroomId: 'cY' }).ok, true);
  assert.equal(teacher('ChargeItem', { student_id: 's2' }, 'c2').ok, true);
});

test('guardedEntityWrite applies it on create for every non-ADMIN', () => {
  const entry = fs.readFileSync(new URL('../../base44/functions/guardedEntityWrite/entry.ts', import.meta.url), 'utf8');
  assert.match(entry, /decideCreateTargets\(\{/);
  assert.match(entry, /TeacherClassroom\.filter\(\{ school_id: schoolId, teacher_id: user\.id \}\)/);
  assert.match(entry, /profile\.app_role !== 'ADMIN' && \(CLASSROOM_BOUND_ENTITIES\.includes\(entity\) \|\| entity === 'Notice'\)/);
});
