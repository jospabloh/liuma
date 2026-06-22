/**
 * Test-data blueprint — a pure, deterministic description of a fully-connected,
 * role-isolated sample dataset spanning every LIUMA entity.
 *
 * It is intentionally side-effect free: it returns a graph of "ops" (records to
 * create) whose cross-references are symbolic ({ ref: 'LOCAL_ID' }). The applier
 * (seedTestData.js) resolves those refs to real Base44 ids at run time, while
 * the test suite consumes the same blueprint to assert referential integrity and
 * per-role isolation WITHOUT touching any backend.
 *
 * Why symbolic refs: a record's foreign keys (school_id, classroom_id,
 * teacher_id, parent_id, …) aren't known until each parent record is created.
 * Declaring them as { ref } lets us validate the whole graph offline and apply
 * it in a single deterministic pass.
 *
 * Reserved local ids resolved by the applier, not declared as ops:
 *   - 'SCHOOL'   → the target school_id (the seeding admin's own school)
 *   - 'U_OWNER'  → the seeding admin's own user id (kept as-is; never invented)
 */

export const TEST_PREFIX = '[TEST]';

// Two-decade-stable date helpers. `now` is injectable so tests are deterministic.
function ymd(date) {
  return date.toISOString().slice(0, 10);
}
function daysFrom(now, delta) {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() + delta);
  return ymd(d);
}
function isoFrom(now, deltaDays) {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString();
}

// Required fields per entity (from the Base44 schemas) — exported so the
// integrity test can assert every op satisfies its entity's contract.
export const ENTITY_REQUIRED_FIELDS = {
  UserProfile: ['user_id', 'school_id', 'app_role'],
  ParentProfile: ['user_id', 'school_id'],
  Classroom: ['school_id', 'name'],
  TeacherClassroom: ['school_id', 'teacher_id', 'classroom_id'],
  Student: ['school_id', 'first_name', 'last_name'],
  ParentStudent: ['school_id', 'parent_id', 'student_id'],
  EmergencyContact: ['student_id', 'school_id', 'name', 'phone'],
  Attendance: ['school_id', 'student_id', 'date', 'status', 'recorded_by'],
  Homework: ['school_id', 'classroom_id', 'title', 'due_date', 'teacher_id'],
  DiaryEntry: ['school_id', 'student_id', 'date', 'teacher_id', 'notes_text'],
  Notice: ['school_id', 'title', 'content', 'author_id'],
  NoticeDelivery: ['school_id', 'notice_id', 'recipient_user_id'],
  NoticeRead: ['notice_id', 'user_id'],
  AbsenceNotification: ['school_id', 'student_id', 'parent_id', 'absence_date', 'reason'],
  Event: ['school_id', 'title', 'date'],
  EventResponse: ['school_id', 'event_id', 'student_id', 'parent_id'],
  PaymentConcept: ['school_id', 'name', 'default_amount'],
  ChargeItem: ['school_id', 'student_id', 'concept_name', 'amount', 'due_date'],
  PaymentRecord: ['school_id', 'student_id', 'amount', 'payment_date'],
  Discount: ['school_id', 'name', 'discount_type', 'discount_value'],
  OfficialDocument: ['school_id', 'title', 'document_type', 'file_url', 'uploaded_by'],
  WeeklyMenu: ['school_id', 'week_number', 'year'],
  UniformOrder: ['school_id', 'student_id', 'parent_id', 'items'],
  SupportTicket: ['ticket_number', 'school_id', 'requester_user_id', 'requester_role', 'subject', 'category', 'priority', 'status'],
  SupportTicketMessage: ['ticket_id', 'school_id', 'author_role', 'body'],
  AuditLog: ['school_id', 'user_id', 'action'],
  SchoolSubscription: ['school_id', 'subscription_status', 'subscription_plan'],
  SchoolSetupGuide: ['school_id', 'step_number', 'step_name', 'category'],
  PendingChange: ['school_id', 'type', 'status'],
  PermissionOverride: ['school_id', 'user_profile_id', 'resource', 'action', 'effect'],
};

/**
 * Build the blueprint.
 * @param {object} [opts]
 * @param {Date}   [opts.now] - reference date (defaults to new Date()).
 * @returns {{ users: Array, ops: Array, reserved: string[] }}
 */
export function buildTestDataBlueprint({ now = new Date() } = {}) {
  const ops = [];
  const ref = (localId) => ({ ref: localId });
  const SCHOOL = ref('SCHOOL');
  const add = (entity, localId, data) => {
    ops.push({ entity, localId, data: { school_id: SCHOOL, ...data } });
    return ref(localId);
  };

  // ── Fictitious people (one extra admin, two teachers, four parents) ──────────
  // 'U_OWNER' (the seeding admin) is reserved — we never invent the owner.
  const users = [
    { localId: 'U_OWNER', existing: true, role: 'ADMIN' },
    { localId: 'U_ADMIN2', role: 'ADMIN', email: 'admin2.demo@liuma.test', full_name: 'Mariana Admin (Demo)' },
    { localId: 'U_TEACHER1', role: 'TEACHER', email: 'laura.maestra.demo@liuma.test', full_name: 'Laura Méndez (Demo)' },
    { localId: 'U_TEACHER2', role: 'TEACHER', email: 'sofia.maestra.demo@liuma.test', full_name: 'Sofía Ramírez (Demo)' },
    { localId: 'U_PARENT1', role: 'PARENT', email: 'papa.garcia.demo@liuma.test', full_name: 'Jorge García (Demo)' },
    { localId: 'U_PARENT2', role: 'PARENT', email: 'mama.lopez.demo@liuma.test', full_name: 'Patricia López (Demo)' },
    { localId: 'U_PARENT3', role: 'PARENT', email: 'papa.torres.demo@liuma.test', full_name: 'Raúl Torres (Demo)' },
    { localId: 'U_PARENT4', role: 'PARENT', email: 'mama.hernandez.demo@liuma.test', full_name: 'Gabriela Hernández (Demo)' },
  ];

  // ── UserProfile per user (app-level role + tenant scope) ─────────────────────
  add('UserProfile', 'UP_OWNER', { user_id: ref('U_OWNER'), app_role: 'ADMIN', status: 'ACTIVE', onboarding_completed: true });
  add('UserProfile', 'UP_ADMIN2', { user_id: ref('U_ADMIN2'), app_role: 'ADMIN', status: 'ACTIVE', onboarding_completed: true, phone: '+52 55 1111 0002' });
  add('UserProfile', 'UP_TEACHER1', { user_id: ref('U_TEACHER1'), app_role: 'TEACHER', status: 'ACTIVE', onboarding_completed: true, phone: '+52 55 1111 1001' });
  add('UserProfile', 'UP_TEACHER2', { user_id: ref('U_TEACHER2'), app_role: 'TEACHER', status: 'ACTIVE', onboarding_completed: true, phone: '+52 55 1111 1002' });
  for (const n of [1, 2, 3, 4]) {
    add('UserProfile', `UP_PARENT${n}`, { user_id: ref(`U_PARENT${n}`), app_role: 'PARENT', status: 'ACTIVE', onboarding_completed: true, phone: `+52 55 1111 200${n}` });
    add('ParentProfile', `PP_PARENT${n}`, { user_id: ref(`U_PARENT${n}`), phone: `+52 55 1111 200${n}`, address: `Calle Demo ${n}0, CDMX`, occupation: ['Ingeniero', 'Doctora', 'Comerciante', 'Diseñadora'][n - 1] });
  }

  // ── Classrooms ───────────────────────────────────────────────────────────────
  add('Classroom', 'CL_MAT', { name: `${TEST_PREFIX} Maternal A`, grade: 'Maternal', capacity: 12, is_active: true });
  add('Classroom', 'CL_K1', { name: `${TEST_PREFIX} Kínder 1`, grade: 'Kínder', capacity: 18, is_active: true });
  add('Classroom', 'CL_P1', { name: `${TEST_PREFIX} Primaria 1A`, grade: 'Primaria', capacity: 25, is_active: true });

  // ── Teacher ⇄ Classroom assignments (drives teacher isolation) ───────────────
  add('TeacherClassroom', 'TC_T1_MAT', { teacher_id: ref('U_TEACHER1'), classroom_id: ref('CL_MAT'), is_primary: true, is_active: true });
  add('TeacherClassroom', 'TC_T1_K1', { teacher_id: ref('U_TEACHER1'), classroom_id: ref('CL_K1'), is_primary: false, is_active: true });
  add('TeacherClassroom', 'TC_T2_P1', { teacher_id: ref('U_TEACHER2'), classroom_id: ref('CL_P1'), is_primary: true, is_active: true });

  // ── Students (distributed across classrooms) ─────────────────────────────────
  const students = [
    { id: 'ST_ANA', first: 'Ana', last: 'García', cls: 'CL_MAT', birth: '2022-03-14', allergies: 'Ninguna' },
    { id: 'ST_BENITO', first: 'Benito', last: 'García', cls: 'CL_MAT', birth: '2022-07-02', allergies: 'Lactosa' },
    { id: 'ST_CARLA', first: 'Carla', last: 'López', cls: 'CL_K1', birth: '2020-11-20', allergies: 'Ninguna' },
    { id: 'ST_DIEGO', first: 'Diego', last: 'Torres', cls: 'CL_K1', birth: '2020-05-09', allergies: 'Cacahuate' },
    { id: 'ST_ELENA', first: 'Elena', last: 'Hernández', cls: 'CL_P1', birth: '2018-09-30', allergies: 'Ninguna' },
    { id: 'ST_FELIPE', first: 'Felipe', last: 'Hernández', cls: 'CL_P1', birth: '2018-01-12', allergies: 'Polen' },
  ];
  for (const s of students) {
    add('Student', s.id, {
      classroom_id: ref(s.cls), first_name: s.first, last_name: s.last,
      birth_date: s.birth, blood_type: 'O+', allergies: s.allergies, is_active: true,
    });
    add('EmergencyContact', `EC_${s.id}`, {
      student_id: ref(s.id), name: `Abuela de ${s.first}`, relationship: 'abuela',
      phone: '+52 55 9876 5432', is_authorized_pickup: true,
    });
  }

  // ── Parent ⇄ Student links (drives parent isolation; P1 has two children) ────
  const links = [
    ['PARENT1', 'ST_ANA', 'padre', true], ['PARENT1', 'ST_BENITO', 'padre', false],
    ['PARENT2', 'ST_CARLA', 'madre', true],
    ['PARENT3', 'ST_DIEGO', 'padre', true],
    ['PARENT4', 'ST_ELENA', 'madre', true], ['PARENT4', 'ST_FELIPE', 'madre', false],
  ];
  links.forEach(([p, st, rel, primary], i) => {
    add('ParentStudent', `PS_${i}`, { parent_id: ref(`U_${p}`), student_id: ref(st), relationship: rel, is_primary: primary, status: 'ACTIVE' });
  });

  // Helper: which teacher owns a classroom (for recorder/author scoping).
  const clsTeacher = { CL_MAT: 'U_TEACHER1', CL_K1: 'U_TEACHER1', CL_P1: 'U_TEACHER2' };
  const clsTeacherName = { CL_MAT: 'Laura Méndez (Demo)', CL_K1: 'Laura Méndez (Demo)', CL_P1: 'Sofía Ramírez (Demo)' };

  // ── Attendance (recorded by the classroom's teacher) ─────────────────────────
  students.forEach((s) => {
    [-1, 0].forEach((delta, k) => {
      add('Attendance', `AT_${s.id}_${k}`, {
        classroom_id: ref(s.cls), student_id: ref(s.id), date: daysFrom(now, delta),
        status: delta === -1 && s.id === 'ST_DIEGO' ? 'absent' : 'present',
        recorded_by: ref(clsTeacher[s.cls]), recorded_by_name: clsTeacherName[s.cls],
      });
    });
  });

  // ── Homework (per classroom) ─────────────────────────────────────────────────
  [['CL_MAT', 'Colorear figuras'], ['CL_K1', 'Trazos de vocales'], ['CL_P1', 'Sumas hasta 20']].forEach(([cls, title], i) => {
    add('Homework', `HW_${i}`, {
      classroom_id: ref(cls), subject: 'General', title: `${TEST_PREFIX} ${title}`,
      description: 'Tarea de práctica para casa.', assigned_date: daysFrom(now, -1),
      due_date: daysFrom(now, 2), teacher_id: ref(clsTeacher[cls]), teacher_name: clsTeacherName[cls],
    });
  });

  // ── Diary entries / bitácoras (per student, by teacher) ──────────────────────
  students.forEach((s) => {
    add('DiaryEntry', `DE_${s.id}`, {
      classroom_id: ref(s.cls), student_id: ref(s.id), date: daysFrom(now, 0),
      teacher_id: ref(clsTeacher[s.cls]), teacher_name: clsTeacherName[s.cls],
      general_mood: 'feliz', food_mood: 'feliz', notes_text: `${s.first} tuvo un gran día y participó mucho.`,
      teacher_message: `¡Bien hecho, ${s.first}!`, sent_to_parents: true, sent_at: isoFrom(now, 0),
    });
  });

  // ── Communications: notices + deliveries + reads ─────────────────────────────
  add('Notice', 'NO_SCHOOL', { scope: 'SCHOOL', title: `${TEST_PREFIX} Junta general de padres`, content: 'Los esperamos el viernes a las 18:00 en el auditorio.', priority: 'IMPORTANT', author_id: ref('U_OWNER'), author_name: 'Dirección', sent_at: isoFrom(now, -1) });
  add('Notice', 'NO_CLASS', { scope: 'CLASSROOM', classroom_id: ref('CL_MAT'), title: `${TEST_PREFIX} Salida didáctica Maternal`, content: 'Llevar gorra y agua el jueves.', priority: 'NORMAL', author_id: ref('U_TEACHER1'), author_name: 'Laura Méndez (Demo)', sent_at: isoFrom(now, 0) });
  add('Notice', 'NO_URGENT', { scope: 'SCHOOL', title: `${TEST_PREFIX} Suspensión de clases`, content: 'Por mantenimiento, no habrá clases el lunes.', priority: 'URGENT', is_emergency: true, author_id: ref('U_OWNER'), author_name: 'Dirección', sent_at: isoFrom(now, 0) });
  // Deliver the school notice to every parent; mark P1 as read.
  [1, 2, 3, 4].forEach((n) => {
    add('NoticeDelivery', `ND_SCHOOL_P${n}`, { notice_id: ref('NO_SCHOOL'), recipient_user_id: ref(`U_PARENT${n}`), recipient_role: 'PARENT', status: n === 1 ? 'READ' : 'SENT', sent_at: isoFrom(now, -1), ...(n === 1 ? { read_at: isoFrom(now, 0) } : {}) });
  });
  add('NoticeDelivery', 'ND_CLASS_P1', { notice_id: ref('NO_CLASS'), recipient_user_id: ref('U_PARENT1'), recipient_role: 'PARENT', classroom_id: ref('CL_MAT'), student_id: ref('ST_ANA'), status: 'SENT', sent_at: isoFrom(now, 0) });
  add('NoticeRead', 'NR_SCHOOL_P1', { notice_id: ref('NO_SCHOOL'), user_id: ref('U_PARENT1'), read_at: isoFrom(now, 0) });

  // ── Absence justification (parent → admin) ───────────────────────────────────
  add('AbsenceNotification', 'AB_DIEGO', { student_id: ref('ST_DIEGO'), parent_id: ref('U_PARENT3'), parent_name: 'Raúl Torres (Demo)', absence_date: daysFrom(now, -1), reason: 'Cita médica', status: 'PENDING' });

  // ── Events + responses ───────────────────────────────────────────────────────
  add('Event', 'EV_FESTIVAL', { title: `${TEST_PREFIX} Festival de primavera`, description: 'Convivencia con familias.', date: daysFrom(now, 14), time: '10:00', location: 'Patio central', scope: 'SCHOOL', requires_confirmation: true, has_cost: true, cost_amount: 150, cost_concept: 'Material y refrigerio', confirmation_deadline: daysFrom(now, 10) });
  add('EventResponse', 'EVR_ANA', { event_id: ref('EV_FESTIVAL'), student_id: ref('ST_ANA'), parent_id: ref('U_PARENT1'), parent_name: 'Jorge García (Demo)', response: 'ACCEPTED', payment_status: 'PENDING' });
  add('EventResponse', 'EVR_CARLA', { event_id: ref('EV_FESTIVAL'), student_id: ref('ST_CARLA'), parent_id: ref('U_PARENT2'), parent_name: 'Patricia López (Demo)', response: 'PENDING', payment_status: 'NOT_REQUIRED' });

  // ── Payments: concepts, discounts, charges, records ──────────────────────────
  add('PaymentConcept', 'PC_INSC', { name: `${TEST_PREFIX} Inscripción`, concept_type: 'INSCRIPCION', default_amount: 3500, is_recurring: false, recurrence: 'once', is_active: true });
  add('PaymentConcept', 'PC_COL', { name: `${TEST_PREFIX} Colegiatura`, concept_type: 'COLEGIATURA', default_amount: 2800, is_recurring: true, recurrence: 'monthly', is_active: true });
  add('Discount', 'DI_HERMANOS', { name: `${TEST_PREFIX} Descuento hermanos`, description: '10% para familias con 2+ inscritos.', discount_type: 'PERCENTAGE', discount_value: 10, applicable_to_concepts: ['COLEGIATURA'], is_active: true, valid_from: daysFrom(now, -30), valid_until: daysFrom(now, 300) });
  // One monthly charge per student; siblings (García, Hernández) get the discount.
  students.forEach((s) => {
    const sibling = s.last === 'García' || s.last === 'Hernández';
    const original = 2800;
    const discount = sibling ? 280 : 0;
    add('ChargeItem', `CH_${s.id}`, {
      student_id: ref(s.id), concept_id: ref('PC_COL'), concept_name: `${TEST_PREFIX} Colegiatura`, concept_type: 'COLEGIATURA',
      original_amount: original, discount_amount: discount, ...(sibling ? { discount_id: ref('DI_HERMANOS') } : {}),
      amount: original - discount, due_date: daysFrom(now, 5), status: s.id === 'ST_ANA' ? 'PAID' : 'PENDING',
    });
  });
  add('PaymentRecord', 'PR_ANA', { charge_id: ref('CH_ST_ANA'), student_id: ref('ST_ANA'), amount: 2520, payment_date: daysFrom(now, -2), payment_method: 'transfer', reference: 'DEMO-TRX-001', recorded_by: ref('U_OWNER') });

  // ── Documents + menu + uniforms ──────────────────────────────────────────────
  add('OfficialDocument', 'DOC_MENU', { title: `${TEST_PREFIX} Menú del mes`, document_type: 'MENU', file_url: 'https://example.com/demo-menu.pdf', target_audience: 'PADRES', uploaded_by: ref('U_OWNER'), uploaded_by_name: 'Dirección', is_current: true, valid_from: daysFrom(now, -5) });
  add('OfficialDocument', 'DOC_UNIFORM', { title: `${TEST_PREFIX} Catálogo de uniformes`, document_type: 'UNIFORM_CATALOG', file_url: 'https://example.com/demo-uniforms.pdf', target_audience: 'TODOS', uploaded_by: ref('U_OWNER'), uploaded_by_name: 'Dirección', is_current: true });
  add('WeeklyMenu', 'WM_1', { week_number: 1, year: now.getUTCFullYear(), monday: 'Pollo con verduras', tuesday: 'Pasta', wednesday: 'Pescado al horno', thursday: 'Guisado de res', friday: 'Día de fruta', is_active: true });
  add('UniformOrder', 'UO_CARLA', { student_id: ref('ST_CARLA'), parent_id: ref('U_PARENT2'), parent_name: 'Patricia López (Demo)', items: [{ product: 'Playera', size: '6', quantity: 2 }, { product: 'Pants', size: '6', quantity: 1 }], status: 'PENDING', notes: 'Entregar antes del festival.' });

  // ── Support tickets ──────────────────────────────────────────────────────────
  add('SupportTicket', 'TK_1', { ticket_number: `${TEST_PREFIX}-2026-000001`, requester_user_id: ref('U_PARENT1'), requester_profile_id: ref('UP_PARENT1'), requester_role: 'PARENT', requester_name: 'Jorge García (Demo)', subject: 'No veo el cargo de mi hijo', category: 'PAYMENTS', priority: 'NORMAL', status: 'OPEN', tier: 'SCHOOL_ADMIN', channel_origin: 'MANUAL', ai_attempted: false });
  add('SupportTicketMessage', 'TKM_1', { ticket_id: ref('TK_1'), author_user_id: ref('U_PARENT1'), author_role: 'REQUESTER', body: 'Hola, no encuentro el cargo de colegiatura de Benito.' });
  add('SupportTicketMessage', 'TKM_2', { ticket_id: ref('TK_1'), author_user_id: ref('U_OWNER'), author_role: 'SCHOOL_ADMIN', body: 'Hola Jorge, ya lo revisamos, aparece en la sección de Pagos.' });

  // ── Audit log / bitácora de seguridad ────────────────────────────────────────
  add('AuditLog', 'AL_1', { user_id: ref('U_OWNER'), user_email: 'h.josepablo@gmail.com', action: 'STUDENT_CREATED', target_type: 'Student', target_id: ref('ST_ANA'), details: { note: 'seed' } });
  add('AuditLog', 'AL_2', { user_id: ref('U_TEACHER1'), user_email: 'laura.maestra.demo@liuma.test', action: 'DIARY_CREATED', target_type: 'DiaryEntry', target_id: ref('DE_ST_ANA'), details: { note: 'seed' } });
  add('AuditLog', 'AL_3', { user_id: ref('U_OWNER'), user_email: 'h.josepablo@gmail.com', action: 'NOTICE_SENT', target_type: 'Notice', target_id: ref('NO_SCHOOL'), details: { note: 'seed' } });

  // ── Subscription, setup guide, governance ────────────────────────────────────
  add('SchoolSubscription', 'SUB_1', { subscription_status: 'trial', subscription_plan: 'trial', license_tier: 'growth', licensed_student_limit: 150, trial_start_date: isoFrom(now, -3), trial_end_date: isoFrom(now, 11) });
  [['Configurar salones', 'GENERAL', true], ['Cargar alumnos', 'GENERAL', true], ['Invitar maestros', 'GENERAL', false]].forEach(([name, cat, done], i) => {
    add('SchoolSetupGuide', `SG_${i}`, { step_number: i + 1, step_name: `${TEST_PREFIX} ${name}`, description: 'Paso de configuración inicial.', category: cat, is_completed: done, ...(done ? { completed_by: ref('U_OWNER'), completed_at: isoFrom(now, -2) } : {}) });
  });
  add('PendingChange', 'PCH_1', { type: 'ROLE_CHANGE', status: 'PENDING_SECOND_ADMIN_APPROVAL', requester_profile_id: ref('UP_OWNER'), requester_user_id: ref('U_OWNER'), target_profile_id: ref('UP_TEACHER2'), payload: { from_role: 'TEACHER', to_role: 'ADMIN', risk_level: 'HIGH' } });
  add('PermissionOverride', 'PO_1', { user_profile_id: ref('UP_TEACHER1'), resource: 'Notice', action: 'write', effect: 'allow', reason: 'Maestra titular puede emitir avisos de su salón.' });

  return { users, ops, reserved: ['SCHOOL', 'U_OWNER'] };
}
