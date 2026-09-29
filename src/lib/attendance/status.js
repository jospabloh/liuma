// The Attendance.status enum, in one place.
//
// base44/entities/Attendance.jsonc declares the enum in lowercase
// ('present' | 'absent' | 'late' | 'excused'), and Asistencia.jsx writes those
// values. Reportes.jsx used to compare against 'PRESENT'/'ABSENT', so its
// headline "Asistencia" KPI read 0% for every school: the strings never
// matched. Every reader and writer now goes through these constants, and
// tests/unit/reportes-kpis.test.js asserts they equal the schema's enum.
//
// Import-free on purpose so `node --test` loads it directly.

export const ATTENDANCE_STATUS = Object.freeze({
  PRESENT: 'present',
  ABSENT: 'absent',
  LATE: 'late',
  EXCUSED: 'excused',
});

/** Display order for the teacher's status buttons and the report detail. */
export const ATTENDANCE_STATUSES = Object.freeze([
  ATTENDANCE_STATUS.PRESENT,
  ATTENDANCE_STATUS.ABSENT,
  ATTENDANCE_STATUS.LATE,
  ATTENDANCE_STATUS.EXCUSED,
]);

/**
 * Spanish copy per status. `shortLabel` is what fits visibly under a status
 * icon on a 390px phone; `label` is the badge / detail text.
 */
export const ATTENDANCE_STATUS_LABELS = Object.freeze({
  [ATTENDANCE_STATUS.PRESENT]: Object.freeze({ label: 'Presente', shortLabel: 'Presente', plural: 'Presentes' }),
  [ATTENDANCE_STATUS.ABSENT]: Object.freeze({ label: 'Ausente', shortLabel: 'Ausente', plural: 'Ausentes' }),
  [ATTENDANCE_STATUS.LATE]: Object.freeze({ label: 'Tardanza', shortLabel: 'Tarde', plural: 'Tardanzas' }),
  [ATTENDANCE_STATUS.EXCUSED]: Object.freeze({ label: 'Justificado', shortLabel: 'Justif.', plural: 'Justificados' }),
});

/**
 * Statuses that mean the student was in class. A late arrival still attended;
 * an excused absence is still an absence (justified, but the child was not
 * there). This is the numerator of the "Asistencia" KPI.
 */
export const ATTENDED_STATUSES = Object.freeze([
  ATTENDANCE_STATUS.PRESENT,
  ATTENDANCE_STATUS.LATE,
]);

export function isAttendanceStatus(value) {
  return ATTENDANCE_STATUSES.includes(value);
}
