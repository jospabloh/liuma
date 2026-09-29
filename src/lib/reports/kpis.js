// Pure KPI math for the director's Reportes page.
//
// Kept out of Reportes.jsx so `node --test` can pin the numbers a director
// shows to parents and to the board (tests/unit/reportes-kpis.test.js). Each
// function below exists because the inline version was wrong:
//   - attendanceSummary: compared against 'PRESENT', but the enum is
//     lowercase, so the KPI was 0% for every school.
//   - diaryCoverage: divided every bitácora in the range by ONE day's student
//     count, so selecting a week showed e.g. 480%.
//   - fetchAllPages: the page downloaded the school's whole history in one
//     call, which the SDK silently truncates at 5,000 records.
//
// Only relative, explicit-extension imports so `node --test` loads it.

import { ATTENDANCE_STATUS, ATTENDANCE_STATUSES, ATTENDED_STATUSES } from '../attendance/status.js';
import { formatLocalDate, parseLocalDate } from '../dates.js';

/**
 * Count Attendance records per status and derive the attendance rate:
 * (present + late) / all records, rounded to a whole percent. 0 when there are
 * no records (an empty range is "no data", not "everyone absent" — callers
 * show the record count next to it).
 */
export function attendanceSummary(records = []) {
  const counts = Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s, 0]));
  let total = 0;
  for (const record of records) {
    if (!record || !(record.status in counts)) continue;
    counts[record.status] += 1;
    total += 1;
  }
  const attended = ATTENDED_STATUSES.reduce((sum, s) => sum + counts[s], 0);
  const rate = total ? Math.round((attended / total) * 100) : 0;
  return {
    total,
    rate,
    present: counts[ATTENDANCE_STATUS.PRESENT],
    absent: counts[ATTENDANCE_STATUS.ABSENT],
    late: counts[ATTENDANCE_STATUS.LATE],
    excused: counts[ATTENDANCE_STATUS.EXCUSED],
  };
}

function isWeekday(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

/**
 * School days (Mon–Fri) in the inclusive range [from, to], both 'YYYY-MM-DD'.
 * Holidays are not subtracted: the school calendar is not modelled, so the
 * denominator can only over-count, which keeps the percentage conservative.
 */
export function countSchoolDays(from, to) {
  const start = parseLocalDate(from);
  const end = parseLocalDate(to);
  if (!start || !end || start > end) return 0;
  let count = 0;
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (cursor <= end) {
    if (isWeekday(cursor)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/**
 * Bitácora coverage for a date range:
 *   distinct (student, school day) pairs with a bitácora
 *   ÷ (students × school days in the range, never past today)
 * capped at 100.
 *
 * - Distinct pairs: two entries for the same child on the same day are one
 *   day covered, not two.
 * - Only students in `students` count, so the numerator is a subset of the
 *   denominator (a bitácora for a student filtered out does not inflate it).
 * - Days after `today` are excluded: nobody can have written tomorrow's
 *   bitácora yet, so a range ending next Friday must not read as behind.
 * - Weekend entries are ignored: the denominator only has weekdays.
 */
export function diaryCoverage({ diaries = [], students = [], dateFrom, dateTo, today = formatLocalDate(new Date()) }) {
  const effectiveTo = dateTo && today && dateTo > today ? today : dateTo;
  const schoolDays = countSchoolDays(dateFrom, effectiveTo);
  const studentIds = new Set(students.map((s) => s.id));
  const expected = studentIds.size * schoolDays;

  const covered = new Set();
  for (const diary of diaries) {
    if (!diary || !studentIds.has(diary.student_id)) continue;
    const date = parseLocalDate(diary.date);
    if (!date || !isWeekday(date)) continue;
    const day = formatLocalDate(date);
    if (day < dateFrom || day > effectiveTo) continue;
    covered.add(`${diary.student_id}|${day}`);
  }

  const percent = expected ? Math.min(100, Math.round((covered.size / expected) * 100)) : 0;
  return { covered: covered.size, expected, schoolDays, percent };
}

/**
 * Read every record matching `query`, following the SDK's cursor pages, so a
 * large school's range is never silently cut at the 5,000-record page cap.
 * `handler` is a Base44 entity handler (base44.entities.X); injected so the
 * paging can be tested without the SDK.
 */
export async function fetchAllPages(handler, query, { fields, sort = 'date', limit = 5000, maxPages = 100 } = {}) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < maxPages; page += 1) {
    const options = cursor ? { cursor, limit } : { sort, limit, ...(fields ? { fields } : {}) };
    const result = await handler.filter(query, options);
    // Defensive: an older SDK/back end answers the options form with a plain array.
    if (Array.isArray(result)) return items.concat(result);
    items.push(...(result?.items || []));
    if (!result?.has_more || !result?.next_cursor) return items;
    cursor = result.next_cursor;
  }
  throw new Error('Demasiados registros para este rango; acota las fechas.');
}
