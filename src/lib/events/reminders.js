import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { notificationService } from '@/lib/notifications/service';
import { selectEventsNeedingReminder, selectNonResponders } from './reminder-selection.js';

export { selectEventsNeedingReminder, selectNonResponders };

const fmt = (value, pattern) => (value ? format(new Date(value), pattern, { locale: es }) : '');

/** Active students that make up an event's audience, honoring its scope. */
async function audienceStudents(event) {
  if (event.scope === 'CLASSROOM') {
    if (!event.classroom_id) return [];
    return base44.entities.Student.filter({ classroom_id: event.classroom_id, is_active: true });
  }
  return base44.entities.Student.filter({ school_id: event.school_id, is_active: true });
}

/**
 * Sends confirmation reminders for a school's events whose deadline is 3 days
 * out, to the parents who have NOT yet responded, then marks each event reminded
 * so it won't fire again (idempotent). Audience is resolved per event scope
 * (whole school vs a classroom). Mirrors the opportunistic
 * autoEscalateBreachedTickets pattern — this app has no cron, so it runs once
 * per load from an admin surface. Returns the number of events processed.
 *
 * Emails go through notificationService (retry + delivery-failure audit, like
 * every other email in the app); each send is awaited via allSettled so one bad
 * address can't block the rest or — since reminder_sent is only set after the
 * event's pass — cause the whole event to re-email everyone on the next load.
 */
export async function sendDueEventReminders({ schoolId, now = new Date() } = {}) {
  if (!schoolId) return 0;

  const events = await base44.entities.Event.filter({ school_id: schoolId, requires_confirmation: true });
  const due = selectEventsNeedingReminder(events, now);
  if (due.length === 0) return 0;

  // One user lookup and one EventResponse lookup for the whole pass.
  const [allUsers, allResponses] = await Promise.all([
    base44.entities.User.list(),
    base44.entities.EventResponse.filter({ event_id: { $in: due.map((e) => e.id) } }),
  ]);
  const userById = new Map(allUsers.map((u) => [u.id, u]));
  const responsesByEvent = new Map();
  for (const r of allResponses) {
    if (!responsesByEvent.has(r.event_id)) responsesByEvent.set(r.event_id, []);
    responsesByEvent.get(r.event_id).push(r);
  }

  let remindedEvents = 0;
  for (const event of due) {
    try {
      const students = await audienceStudents({ ...event, school_id: event.school_id || schoolId });
      const studentById = new Map(students.map((s) => [s.id, s]));
      const studentIds = students.map((s) => s.id);

      if (studentIds.length > 0) {
        const links = await base44.entities.ParentStudent.filter({
          student_id: { $in: studentIds },
          status: 'ACTIVE',
        });
        const audiencePairs = links.map((l) => ({ parentId: l.parent_id, studentId: l.student_id }));
        const nonResponders = selectNonResponders(audiencePairs, responsesByEvent.get(event.id));

        await Promise.allSettled(
          nonResponders.map((pair) => {
            const parent = userById.get(pair.parentId);
            if (!parent?.email) return Promise.resolve();
            const student = studentById.get(pair.studentId);
            return notificationService.sendEventEmailTo({
              eventType: 'event_confirmation_reminder',
              email: parent.email,
              schoolId,
              templateContext: {
                eventTitle: event.title,
                studentName: student ? `${student.first_name} ${student.last_name}` : 'su hijo(a)',
                dateLabel: fmt(event.date, "d 'de' MMMM, yyyy"),
                timeLabel: event.time || '',
                locationLabel: event.location || '',
                deadlineLabel: fmt(event.confirmation_deadline, "d 'de' MMMM"),
              },
            });
          }),
        );
      }

      await base44.entities.Event.update(event.id, { reminder_sent: true });
      remindedEvents += 1;
    } catch (error) {
      console.error('Event confirmation reminder failed for event', event?.id, error);
    }
  }
  return remindedEvents;
}
