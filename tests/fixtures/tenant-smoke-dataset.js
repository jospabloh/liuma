export const tenantDataset = {
  schools: [
    {
      id: 'tenant-small',
      name: 'Escuela Pequeña Demo',
      complexity: 'small',
      data_mode: 'test-data',
      logo_url: 'https://cdn.test/small-logo.png',
      theme_settings: {
        palette: { primary: '#1f2937', secondary: '#f3f4f6', accent: '#2563eb', neutral: '#111827' },
      },
    },
    {
      id: 'tenant-medium',
      name: 'Escuela Mediana Demo',
      complexity: 'medium',
      data_mode: 'test-data',
      logo_url: 'https://cdn.test/medium-logo.png',
      theme_settings: {
        palette: { primary: '#0f766e', secondary: '#ccfbf1', accent: '#0ea5e9', neutral: '#134e4a' },
      },
    },
    {
      id: 'tenant-complex',
      name: 'Escuela Compleja Demo',
      complexity: 'complex',
      data_mode: 'test-data',
      logo_url: 'https://cdn.test/low-contrast-logo.png',
      theme_settings: {
        palette: { primary: '#d1d5db', secondary: '#e5e7eb', accent: '#9ca3af', neutral: '#f3f4f6' },
      },
      low_contrast_logo: true,
    },
  ],
  userProfiles: [
    { id: 'up-admin-active', school_id: 'tenant-small', app_role: 'ADMIN', status: 'ACTIVE', user_id: 'u-admin-1' },
    { id: 'up-teacher-active', school_id: 'tenant-small', app_role: 'TEACHER', status: 'ACTIVE', user_id: 'u-teacher-1' },
    { id: 'up-parent-active', school_id: 'tenant-small', app_role: 'PARENT', status: 'ACTIVE', user_id: 'u-parent-1' },
    { id: 'up-parent-pending', school_id: 'tenant-medium', app_role: 'PARENT', status: 'PENDING', user_id: 'u-parent-2' },
    { id: 'up-teacher-suspended', school_id: 'tenant-complex', app_role: 'TEACHER', status: 'SUSPENDED', user_id: 'u-teacher-2' },
  ],
  classrooms: [
    { id: 'class-small-a', school_id: 'tenant-small', name: '1A' },
    { id: 'class-medium-a', school_id: 'tenant-medium', name: '3B' },
    { id: 'class-complex-a', school_id: 'tenant-complex', name: '5C' },
  ],
  students: [
    { id: 'student-small-1', school_id: 'tenant-small', classroom_id: 'class-small-a' },
    { id: 'student-medium-1', school_id: 'tenant-medium', classroom_id: 'class-medium-a' },
    { id: 'student-complex-1', school_id: 'tenant-complex', classroom_id: 'class-complex-a' },
  ],
  parentStudents: [
    { id: 'ps-small-1', school_id: 'tenant-small', parent_profile_id: 'up-parent-active', student_id: 'student-small-1' },
  ],
  teacherClassrooms: [
    { id: 'tc-small-1', school_id: 'tenant-small', teacher_profile_id: 'up-teacher-active', classroom_id: 'class-small-a' },
  ],
  attendance: [
    { id: 'att-small-1', school_id: 'tenant-small', classroom_id: 'class-small-a', student_id: 'student-small-1', scope: 'STUDENT' },
  ],
  homework: [
    { id: 'hw-small-1', school_id: 'tenant-small', classroom_id: 'class-small-a', student_id: 'student-small-1', scope: 'STUDENT' },
  ],
  diaryEntries: [
    { id: 'de-small-1', school_id: 'tenant-small', classroom_id: 'class-small-a', student_id: 'student-small-1', scope: 'STUDENT' },
  ],
  notices: [
    { id: 'notice-small-school', school_id: 'tenant-small', scope: 'SCHOOL' },
    { id: 'notice-small-class', school_id: 'tenant-small', classroom_id: 'class-small-a', scope: 'CLASSROOM' },
  ],
  events: [
    { id: 'event-small-1', school_id: 'tenant-small', scope: 'SCHOOL' },
  ],
  paymentConcepts: [
    { id: 'pc-small-monthly', school_id: 'tenant-small', name: 'Mensualidad' },
  ],
  chargeItems: [
    { id: 'charge-overdue', school_id: 'tenant-small', student_id: 'student-small-1', concept_id: 'pc-small-monthly', status: 'OVERDUE', due_date: '2026-04-30', scope: 'STUDENT' },
    { id: 'charge-current', school_id: 'tenant-medium', student_id: 'student-medium-1', concept_id: 'pc-small-monthly', status: 'CURRENT', due_date: '2026-06-30', scope: 'STUDENT' },
  ],
  discounts: [
    { id: 'discount-small-1', school_id: 'tenant-small', student_id: 'student-small-1', percent: 10 },
  ],
  officialDocuments: [
    { id: 'doc-small-1', school_id: 'tenant-small', student_id: 'student-small-1', visibility: 'PARENT' },
  ],
};
