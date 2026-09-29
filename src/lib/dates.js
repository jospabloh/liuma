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
//
// Import-free on purpose so `node --test` loads it directly.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

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
 * Returns '' for empty or invalid input.
 */
export function formatLocalDate(value = new Date()) {
  const date = value instanceof Date ? value : parseLocalDate(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local midnight of the given instant's calendar day. */
export function startOfLocalDay(value = new Date()) {
  const date = value instanceof Date ? value : parseLocalDate(value);
  if (!date) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * True when the date-only value is a calendar day strictly before today
 * (e.g. a charge whose due date has passed). A charge due today is NOT overdue.
 * Invalid/empty input returns false.
 */
export function isBeforeToday(value, now = new Date()) {
  const day = startOfLocalDay(value);
  const today = startOfLocalDay(now);
  if (!day || !today) return false;
  return day.getTime() < today.getTime();
}

/**
 * True when the date-only value is today or later (e.g. an upcoming event).
 * An event dated today counts as upcoming all day long.
 * Invalid/empty input returns false.
 */
export function isOnOrAfterToday(value, now = new Date()) {
  const day = startOfLocalDay(value);
  const today = startOfLocalDay(now);
  if (!day || !today) return false;
  return day.getTime() >= today.getTime();
}
