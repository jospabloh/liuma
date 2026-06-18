/**
 * Human-friendly ticket identifiers, e.g. "LIUMA-2026-000042".
 *
 * The sequence is allocated per calendar year. The caller supplies the next
 * sequence value (derived from a count of existing tickets); see
 * `allocateTicketNumber` in tickets.js for how the live sequence is obtained.
 */

const DEFAULT_PREFIX = 'LIUMA';
const SEQUENCE_PAD = 6;

export function generateTicketNumber({ sequence, date = new Date(), prefix = DEFAULT_PREFIX } = {}) {
  const safeDate = date instanceof Date ? date : new Date(date);
  const year = safeDate.getUTCFullYear();
  const safeSequence = Math.max(1, Math.floor(Number(sequence) || 1));
  const padded = String(safeSequence).padStart(SEQUENCE_PAD, '0');
  return `${prefix}-${year}-${padded}`;
}

/** Parse a ticket number back into its parts, or null if it doesn't match. */
export function parseTicketNumber(ticketNumber) {
  const match = /^([A-Z]+)-(\d{4})-(\d+)$/.exec(String(ticketNumber || ''));
  if (!match) return null;
  return { prefix: match[1], year: Number(match[2]), sequence: Number(match[3]) };
}
