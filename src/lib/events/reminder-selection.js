import { differenceInDays, startOfDay } from 'date-fns';

/**
 * Pure selector: which events are due for a confirmation reminder right now.
 * An event qualifies when it requires confirmation, has a deadline, hasn't been
 * reminded yet, and the deadline is exactly 3 days out. Compared at day
 * granularity (startOfDay on both sides) so a date-only deadline isn't thrown
 * off by the current time-of-day. Kept free of IO / base44 so it is
 * unit-testable; the side-effecting send lives in sendDueEventReminders.
 */
export function selectEventsNeedingReminder(events, now = new Date()) {
  return (events || []).filter((event) => {
    if (!event?.requires_confirmation) return false;
    if (!event.confirmation_deadline) return false;
    if (event.reminder_sent) return false;
    return differenceInDays(startOfDay(new Date(event.confirmation_deadline)), startOfDay(now)) === 3;
  });
}

/**
 * Given the event's audience as {parentId, studentId} pairs and the existing
 * EventResponse rows, returns the pairs that have NOT responded. A pair counts
 * as responded when a response exists for the same parent AND student — this is
 * how we identify non-responders, since the app never writes a 'PENDING'
 * response row (only ACCEPTED/DECLINED on submit), so absence of a row is the
 * only signal that a parent still needs to confirm.
 */
export function selectNonResponders(audiencePairs, responses) {
  const responded = new Set(
    (responses || [])
      .filter((r) => r && r.parent_id && r.student_id)
      .map((r) => `${r.parent_id}::${r.student_id}`)
  );
  return (audiencePairs || []).filter(
    (p) => p && p.parentId && p.studentId && !responded.has(`${p.parentId}::${p.studentId}`)
  );
}
