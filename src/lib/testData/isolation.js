/**
 * Pure role-isolation model for the test-data blueprint.
 *
 * Mirrors the Base44 RLS rules in terms of the blueprint's symbolic local ids,
 * so the test suite can prove the seeded graph is correctly scoped per role
 * (and so the applier can derive the denormalized User.data.* scope fields that
 * RLS keys off: assigned_classroom_ids, linked_student_ids, …).
 *
 * Everything here operates on local ids (e.g. 'CL_MAT', 'ST_ANA', 'U_TEACHER1');
 * it never touches a backend.
 */

function opsByEntity(blueprint, entity) {
  return blueprint.ops.filter((o) => o.entity === entity);
}
function refId(value) {
  return value && typeof value === 'object' && 'ref' in value ? value.ref : value;
}

/**
 * Derive each user's effective scope from the relational ops, exactly as the
 * platform must denormalize onto User.data for RLS to work.
 * @returns {Record<string, {role, assigned_classroom_ids, assigned_student_ids, linked_student_ids, linked_student_classroom_ids}>}
 */
export function deriveScopes(blueprint) {
  const profiles = opsByEntity(blueprint, 'UserProfile');
  const teacherClassrooms = opsByEntity(blueprint, 'TeacherClassroom');
  const parentStudents = opsByEntity(blueprint, 'ParentStudent');
  const students = opsByEntity(blueprint, 'Student');

  // student local id → its classroom local id
  const studentClassroom = {};
  students.forEach((s) => { studentClassroom[s.localId] = refId(s.data.classroom_id); });

  const scopes = {};
  profiles.forEach((p) => {
    const userId = refId(p.data.user_id);
    scopes[userId] = {
      role: p.data.app_role,
      assigned_classroom_ids: [],
      assigned_student_ids: [],
      linked_student_ids: [],
      linked_student_classroom_ids: [],
    };
  });

  teacherClassrooms.forEach((tc) => {
    const t = refId(tc.data.teacher_id);
    if (!scopes[t]) return;
    scopes[t].assigned_classroom_ids.push(refId(tc.data.classroom_id));
  });
  // assigned students = students in assigned classrooms
  Object.values(scopes).forEach((sc) => {
    if (sc.role !== 'TEACHER') return;
    sc.assigned_student_ids = students
      .filter((s) => sc.assigned_classroom_ids.includes(refId(s.data.classroom_id)))
      .map((s) => s.localId);
  });

  parentStudents.forEach((ps) => {
    const p = refId(ps.data.parent_id);
    if (!scopes[p]) return;
    const studentLocal = refId(ps.data.student_id);
    scopes[p].linked_student_ids.push(studentLocal);
    const cls = studentClassroom[studentLocal];
    if (cls && !scopes[p].linked_student_classroom_ids.includes(cls)) {
      scopes[p].linked_student_classroom_ids.push(cls);
    }
  });

  return scopes;
}

/** Local ids of students an actor may READ, per the Student RLS rule. */
export function visibleStudentIds(blueprint, actorUserId) {
  const scopes = deriveScopes(blueprint);
  const actor = scopes[actorUserId];
  const students = opsByEntity(blueprint, 'Student');
  if (!actor) return [];
  if (actor.role === 'ADMIN') return students.map((s) => s.localId);
  if (actor.role === 'TEACHER') {
    return students.filter((s) => actor.assigned_classroom_ids.includes(refId(s.data.classroom_id))).map((s) => s.localId);
  }
  // PARENT
  return students.filter((s) => actor.linked_student_ids.includes(s.localId)).map((s) => s.localId);
}

/** Local ids of notices an actor may READ, per the Notice RLS rule. */
export function visibleNoticeIds(blueprint, actorUserId) {
  const scopes = deriveScopes(blueprint);
  const actor = scopes[actorUserId];
  const notices = opsByEntity(blueprint, 'Notice');
  if (!actor) return [];
  return notices.filter((n) => {
    if (actor.role === 'ADMIN') return true;
    if (n.data.scope === 'SCHOOL') return true;
    if (n.data.scope === 'CLASSROOM') {
      const cls = refId(n.data.classroom_id);
      return actor.role === 'TEACHER'
        ? actor.assigned_classroom_ids.includes(cls)
        : actor.linked_student_classroom_ids.includes(cls);
    }
    return false; // STUDENT scope handled elsewhere; none in blueprint
  }).map((n) => n.localId);
}

/** Local ids of charges an actor may READ, per the ChargeItem RLS rule. */
export function visibleChargeIds(blueprint, actorUserId) {
  const scopes = deriveScopes(blueprint);
  const actor = scopes[actorUserId];
  const charges = opsByEntity(blueprint, 'ChargeItem');
  if (!actor) return [];
  if (actor.role === 'ADMIN') return charges.map((c) => c.localId);
  if (actor.role === 'PARENT') {
    return charges.filter((c) => actor.linked_student_ids.includes(refId(c.data.student_id))).map((c) => c.localId);
  }
  return []; // teachers have no ChargeItem read rule
}
