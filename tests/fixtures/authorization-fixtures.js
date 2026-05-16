export const actors = {
  adminSchoolA: {
    role: 'ADMIN',
    schoolId: 'school-a',
    classroomIds: ['class-a1', 'class-a2'],
    studentIds: ['student-a1', 'student-a2'],
  },
  teacherClassA1: {
    role: 'TEACHER',
    schoolId: 'school-a',
    classroomIds: ['class-a1'],
    studentIds: [],
  },
  parentStudentA1: {
    role: 'PARENT',
    schoolId: 'school-a',
    classroomIds: ['class-a1'],
    studentIds: ['student-a1'],
  },
};

export const rows = {
  attendance: [
    { id: 'att-1', school_id: 'school-a', classroom_id: 'class-a1', student_id: 'student-a1', scope: 'STUDENT' },
    { id: 'att-2', school_id: 'school-a', classroom_id: 'class-a2', student_id: 'student-a2', scope: 'STUDENT' },
    { id: 'att-3', school_id: 'school-b', classroom_id: 'class-b1', student_id: 'student-b1', scope: 'STUDENT' },
  ],
  notices: [
    { id: 'not-1', school_id: 'school-a', scope: 'SCHOOL' },
    { id: 'not-2', school_id: 'school-a', classroom_id: 'class-a1', scope: 'CLASSROOM' },
    { id: 'not-3', school_id: 'school-a', classroom_id: 'class-a2', scope: 'CLASSROOM' },
  ],
  diaryEntries: [
    { id: 'dia-1', school_id: 'school-a', classroom_id: 'class-a1', student_id: 'student-a1', scope: 'STUDENT' },
    { id: 'dia-2', school_id: 'school-a', classroom_id: 'class-a2', student_id: 'student-a2', scope: 'STUDENT' },
  ],
  chargeItems: [
    { id: 'chg-1', school_id: 'school-a', student_id: 'student-a1', scope: 'STUDENT' },
    { id: 'chg-2', school_id: 'school-a', student_id: 'student-a2', scope: 'STUDENT' },
  ],
};
