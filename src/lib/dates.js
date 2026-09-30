// Calendar-date helpers for date-only fields (`date`, `due_date`,
// `absence_date`, `birth_date`, …) that Base44 stores as 'YYYY-MM-DD'.
//
// Why this exists: `new Date('2026-09-15')` is parsed by the spec as UTC
// midnight. In Mexico (UTC-6, no DST since 2022) that instant is 18:00 on
// Sept 14, so every `format(new Date(x.date), …)` rendered the day BEFORE the
// one the school entered — wrong payment deadlines, events on the wrong
// calendar cell, homework flagged overdue a day early. A calendar date has no
// time zone; it must be read as the viewer's own local day.
//
// Rules for callers:
//   - date-only field  -> parseLocalDate(x.date), never new Date(x.date)
//   - writing a date-only field from a Date -> formatLocalDate(d), never
//     d.toISOString().slice(0, 10) (after 18:00 in Mexico that is tomorrow)
//   - "is it overdue / upcoming" -> isBeforeToday / isOnOrAfterToday, which
//     compare calendar days, so an event dated today still counts as upcoming
//     and a charge due today is not yet overdue.
//   - "what is today" -> schoolToday() ('YYYY-MM-DD') / schoolTodayDate(),
//     never format(new Date(), 'yyyy-MM-dd'). See SCHOOL_TIME_ZONE below.
//
// Import-free on purpose so `node --test` loads it directly.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

// "Today" is the SCHOOL's day, not the device's. Every server function that
// reasons about today (lumiQuery/lumiWrite `mexicoToday`, aiAssist's daily
// quota) resolves it in America/Mexico_City. The client used the device clock,
// so any device not set to Mexico time disagreed with the server about what
// day it is: live QA on 2026-09-30 saw the app header say "miércoles 30 de
// septiembre" while Lumi, on the server, answered for "martes 29" — and the
// attendance / diary "today" the client queried by was the device's too. A
// Mexican phone is already on Mexico time, so for it nothing changes; for a
// laptop in UTC, a parent travelling, or a CI browser, the app now agrees
// with the server and with the school.
export const SCHOOL_TIME_ZONE = 'America/Mexico_City';

let schoolDayFormatter = null;
function schoolDayFormat() {
  if (!schoolDayFormatter) {
    schoolDayFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: SCHOOL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    });
  }
  return schoolDayFormatter;
}

/**
 * Parse a date-only value as local midnight of that calendar day.
 * Accepts 'YYYY-MM-DD'; a string carrying a time component (e.g. Base44's
 * `created_date`) is a real instant and is parsed as such; a Date is copied.
 * Returns null for empty or invalid input (including impossible days like
 * '2026-02-30'), so callers can render a fallback instead of "Invalid Date".
 */
export function parseLocalDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const m = DATE_ONLY.exec(trimmed);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const date = new Date(y, mo - 1, d);
    // new Date(y, …) maps years 0–99 to 1900–1999; pin the real year.
    if (y < 100) date.setFullYear(y, mo - 1, d);
    // new Date() silently rolls '2026-02-30' into March; reject instead.
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
      return null;
    }
    return date;
  }
  const instant = new Date(trimmed);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/**
 * Format a Date (or date-like value) as the local calendar day 'YYYY-MM-DD'.
 * Returns '' for empty or invalid input. Called with NO argument it means
 * "today" and returns the school's day (schoolToday).
 */
export function formatLocalDate(value) {
  if (value === undefined) return schoolToday();
  const date = value instanceof Date ? value : parseLocalDate(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * The school's calendar day ('YYYY-MM-DD', America/Mexico_City) at `now`.
 * Falls back to the device's day only if the runtime has no time-zone data.
 */
export function schoolToday(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = {};
    for (const p of schoolDayFormat().formatToParts(date)) parts[p.type] = p.value;
    if (parts.year && parts.month && parts.day) return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    /* no Intl time-zone support: fall through to the device's day */
  }
  return formatLocalDate(date);
}

/**
 * The school's "today" as a Date at local midnight of that calendar day, for
 * date-fns (`format(schoolTodayDate(), "EEEE d 'de' MMMM")`, addDays, …).
 */
export function schoolTodayDate(now = new Date()) {
  return parseLocalDate(schoolToday(now));
}

/** Local midnight of the given instant's calendar day. With no argument: the
 *  school's today (see schoolTodayDate). */
export function startOfLocalDay(value) {
  if (value === undefined) return schoolTodayDate();
  const date = value instanceof Date ? value : parseLocalDate(value);
  if (!date) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Whole calendar days from the school's today to `value`'s day: 0 = today,
 * 1 = tomorrow, -1 = yesterday. null for empty/invalid input. A date-only
 * value is that calendar day as entered; an instant is its day on this device.
 * Use this instead of date-fns isToday/isTomorrow/differenceInDays(x, new
 * Date()), which read the device clock and count 24h blocks.
 */
export function schoolDaysFromToday(value, now = new Date()) {
  const day = startOfLocalDay(value);
  const today = schoolTodayDate(now);
  if (!day || !today) return null;
  // Both are local midnights; round() absorbs a DST hour on devices that
  // still observe it (Mexico itself has none since 2022).
  return Math.round((day.getTime() - today.getTime()) / 86400000);
}

/** True when `value` falls on the school's today. */
export function isSchoolToday(value, now = new Date()) {
  return schoolDaysFromToday(value, now) === 0;
}

/**
 * True when the date-only value is a calendar day strictly before today
 * (e.g. a charge whose due date has passed). A charge due today is NOT overdue.
 * Invalid/empty input returns false.
 */
export function isBeforeToday(value, now = new Date()) {
  const diff = schoolDaysFromToday(value, now);
  return diff != null && diff < 0;
}

/**
 * True when the date-only value is today or later (e.g. an upcoming event).
 * An event dated today counts as upcoming all day long.
 * Invalid/empty input returns false.
 */
export function isOnOrAfterToday(value, now = new Date()) {
  const diff = schoolDaysFromToday(value, now);
  return diff != null && diff >= 0;
}
