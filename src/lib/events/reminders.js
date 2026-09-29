import { base44 } from '@/api/base44Client';
import { notificationService } from '@/lib/notifications/service';
import { selectEventsNeedingReminder, selectNonResponders } from './reminder-selection.js';

export { selectEventsNeedingReminder, selectNonResponders };

/**
 * Sends confirmation reminders for a school's events whose deadline is 3 days
 * out, to the parents who have NOT yet responded. Mirrors the opportunistic
 * autoEscalateBreachedTickets pattern — this app has no cron, so it runs once
 * per load from an admin surface. Returns the number of events processed.
 *
 * Which events are due is still decided here (selectEventsNeedingReminder);
 * everything after that happens server-side in sendBulkNotification, one call
 * per event id: the audience (by the event's scope), the non-responders, the
 * parents' addresses, the text, and marking `reminder_sent` so it never fires
 * twice. The old version resolved parents' emails from a client-side
 * User.list(), which only ever returns the caller's own row — so the reminder
 * went to nobody and was still marked sent (sales-readiness audit F09).
 */
export async function sendDueEventReminders({ schoolId, now = new Date() } = {}) {
  if (!schoolId) return 0;

  const events = await base44.entities.Event.filter({ school_id: schoolId, requires_confirmation: true });
  const due = selectEventsNeedingReminder(events, now);
  if (due.length === 0) return 0;

  let remindedEvents = 0;
  for (const event of due) {
    try {
      await notificationService.sendBulk({ eventType: 'event_confirmation_reminder', eventId: event.id });
      remindedEvents += 1;
    } catch (error) {
      console.error('Event confirmation reminder failed for event', event?.id, error);
    }
  }
  return remindedEvents;
}
