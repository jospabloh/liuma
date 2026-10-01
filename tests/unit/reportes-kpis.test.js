// Mexico's time zone, like dates.test.js: the day-counting below must not
// shift a 'YYYY-MM-DD' by one, which only shows up off UTC.
process.env.TZ = 'America/Mexico_City';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ATTENDANCE_STATUS,
  ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_LABELS,
} from '../../src/lib/attendance/status.js';
import {
  attendanceSummary,
  countSchoolDays,
  diaryCoverage,
  fetchAllPages,
} from '../../src/lib/reports/kpis.js';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('ATTENDANCE_STATUS matches the deployed Attendance.status enum exactly', () => {
  // Reportes compared against 'PRESENT' while the schema stores 'present', so
  // the director's headline KPI was 0% for every school. If the schema enum
  // ever changes, this fails before a report silently goes to zero again.
  const schema = JSON.parse(read('base44/entities/Attendance.jsonc').replace(/^\s*\/\/.*$/gm, ''));
  assert.deepEqual([...ATTENDANCE_STATUSES].sort(), [...schema.properties.status.enum].sort());
  for (const status of ATTENDANCE_STATUSES) {
    assert.ok(ATTENDANCE_STATUS_LABELS[status]?.label, `${status} needs a Spanish label`);
    assert.ok(ATTENDANCE_STATUS_LABELS[status]?.shortLabel, `${status} needs a visible short label`);
  }
});

test('attendance rate counts the real lowercase statuses (not 0%)', () => {
  const records = [
    { status: 'present' }, { status: 'present' }, { status: 'present' },
    { status: 'late' },
    { status: 'absent' },
    { status: 'excused' },
  ];
  const summary = attendanceSummary(records);
  assert.equal(summary.total, 6);
  assert.equal(summary.present, 3);
  assert.equal(summary.late, 1);
  assert.equal(summary.absent, 1);
  assert.equal(summary.excused, 1);
  // A late student attended class; an excused absence is still an absence.
  assert.equal(summary.rate, Math.round((4 / 6) * 100));
});

test('attendance rate is 0 with no records and ignores unknown statuses', () => {
  assert.equal(attendanceSummary([]).rate, 0);
  // The old uppercase value must not count as anything.
  const summary = attendanceSummary([{ status: 'PRESENT' }, { status: 'present' }]);
  assert.equal(summary.total, 1);
  assert.equal(summary.rate, 100);
});

test('school days count Mon–Fri inclusive and read dates as local days', () => {
  // 2026-09-28 is a Monday; under UTC-6 a naive parse would make it Sunday.
  assert.equal(countSchoolDays('2026-09-28', '2026-09-28'), 1);
  assert.equal(countSchoolDays('2026-09-28', '2026-10-04'), 5); // Mon..Sun
  assert.equal(countSchoolDays('2026-10-03', '2026-10-04'), 0); // weekend only
  assert.equal(countSchoolDays('2026-10-02', '2026-09-28'), 0); // reversed range
  assert.equal(countSchoolDays('', '2026-09-28'), 0);
});

test('bitácora coverage over a week never exceeds 100% (it used to show 480%)', () => {
  const students = [{ id: 's1' }, { id: 's2' }];
  const week = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];
  // Every student has a bitácora every day, and s1 has a duplicate on Monday.
  const diaries = students.flatMap((s) => week.map((date) => ({ student_id: s.id, date })));
  diaries.push({ student_id: 's1', date: '2026-09-28' });

  const result = diaryCoverage({ diaries, students, dateFrom: week[0], dateTo: week[4], today: '2026-10-02' });
  assert.equal(result.schoolDays, 5);
  assert.equal(result.expected, 10);
  assert.equal(result.covered, 10); // the duplicate is the same (student, day)
  assert.equal(result.percent, 100);
});

test('bitácora coverage divides by students × school days, not by students', () => {
  const students = [{ id: 's1' }, { id: 's2' }];
  // One bitácora each on Monday, nothing else that week.
  const diaries = [{ student_id: 's1', date: '2026-09-28' }, { student_id: 's2', date: '2026-09-28' }];
  const result = diaryCoverage({ diaries, students, dateFrom: '2026-09-28', dateTo: '2026-10-02', today: '2026-10-02' });
  assert.equal(result.percent, 20); // 2 of 10, where the old math said 100%
});

test('bitácora coverage ignores future days, other students and weekends', () => {
  const students = [{ id: 's1' }];
  const diaries = [
    { student_id: 's1', date: '2026-09-28' },
    { student_id: 'filtered-out', date: '2026-09-28' },
    { student_id: 's1', date: '2026-09-27' }, // Sunday, outside the range anyway
  ];
  // Range runs to Friday but today is Monday: only Monday is expected so far.
  const result = diaryCoverage({ diaries, students, dateFrom: '2026-09-28', dateTo: '2026-10-02', today: '2026-09-28' });
  assert.equal(result.expected, 1);
  assert.equal(result.covered, 1);
  assert.equal(result.percent, 100);
});

test('fetchAllPages follows the cursor instead of stopping at the first 5,000', async () => {
  const pages = [
    { items: [{ id: 1 }, { id: 2 }], has_more: true, next_cursor: 'c1' },
    { items: [{ id: 3 }], has_more: true, next_cursor: 'c2' },
    { items: [{ id: 4 }], has_more: false, next_cursor: null },
  ];
  const calls = [];
  const handler = {
    async filter(query, options) {
      calls.push({ query, options });
      return pages[calls.length - 1];
    },
  };
  const query = { school_id: 'sch', date: { $gte: '2026-09-01', $lte: '2026-09-30' } };
  const items = await fetchAllPages(handler, query, { fields: ['status'] });
  assert.deepEqual(items.map((i) => i.id), [1, 2, 3, 4]);
  assert.equal(calls.length, 3);
  // The date range goes to the server, not filtered in the browser.
  assert.deepEqual(calls[0].query, query);
  assert.deepEqual(calls[0].options.fields, ['status']);
  assert.equal(calls[1].options.cursor, 'c1');
  assert.equal(calls[2].options.cursor, 'c2');
});

test('fetchAllPages accepts a plain-array answer', async () => {
  const handler = { filter: async () => [{ id: 'a' }] };
  assert.deepEqual(await fetchAllPages(handler, {}), [{ id: 'a' }]);
});

test('Reportes reads statuses from the shared module and filters by date on the server', () => {
  const page = read('src/pages/Reportes.jsx');
  assert.doesNotMatch(page, /'PRESENT'|'ABSENT'/);
  assert.match(page, /attendanceSummary\(/);
  assert.match(page, /diaryCoverage\(/);
  assert.match(page, /date: \{ \$gte: filters\.dateFrom, \$lte: filters\.dateTo \}/);
  // No more full-history download.
  assert.doesNotMatch(page, /Attendance\.filter\(\{ school_id: userProfile\.school_id \}\)/);
  assert.doesNotMatch(page, /DiaryEntry\.filter\(\{ school_id: userProfile\.school_id \}\)/);
});

// Live QA of v1.8.3: under the "las cifras pueden estar incompletas" banner the
// cards still read "$0.00 · 0 cargos · 0 vencidos" and "0 enviados" while the
// truth was $950 and 4 avisos. A failed list with nothing cached shows "—".
test('Reportes shows a dash, not zeros, for a card whose list failed to load', () => {
  const src = fs.readFileSync(new URL('../../src/pages/Reportes.jsx', import.meta.url), 'utf8');
  assert.match(src, /const unavailable = \(\.\.\.queries\) => queries\.some\(\(q\) => q\.isError && q\.data === undefined\)/);
  for (const flag of ['attendanceNA', 'diaryNA', 'unpaidNA', 'noticesNA', 'eventsNA']) {
    assert.match(src, new RegExp(`${flag} \\?`), flag);
  }
  assert.match(src, /unpaidNA \? DASH : formatMoney\(totalPending\)/);
  // Codex review on #194: the "Ver detalle" panels still showed 0s.
  for (const [panel, flag] of [['attendance', 'attendanceNA'], ['payments', 'unpaidNA']]) {
    assert.match(src, new RegExp(`openPanel === '${panel}' && \\(${flag} \\?`), panel);
  }
  for (const [panel, flag] of [['diary', 'diaryNA'], ['notices', 'noticesNA']]) {
    assert.match(src, new RegExp(`openPanel === '${panel}' && !${flag} &&`), panel);
  }
});
