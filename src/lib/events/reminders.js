import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { selectEventsNeedingReminder, selectNonResponders } from './reminder-selection.js';

export { selectEventsNeedingReminder, selectNonResponders };

function reminderEmail(event, student) {
  const studentName = student ? `${student.first_name} ${student.last_name}` : 'su hijo(a)';
  return {
    from_name: 'LIUMA - Recordatorio de Evento',
    subject: `Recordatorio: Confirma asistencia a ${event.title}`,
    body: `
      <h2>Recordatorio de Confirmación</h2>
      <p>Estimado padre/madre de familia:</p>
      <p>Le recordamos confirmar la asistencia de <strong>${studentName}</strong> al siguiente evento:</p>

      <div style="background: #dbeafe; padding: 16px; border-radius: 8px; border: 1px solid #3b82f6; margin: 16px 0;">
        <p><strong>${event.title}</strong></p>
        <p><strong>Fecha:</strong> ${format(new Date(event.date), "d 'de' MMMM, yyyy", { locale: es })}</p>
        ${event.time ? `<p><strong>Hora:</strong> ${event.time}</p>` : ''}
        ${event.location ? `<p><strong>Lugar:</strong> ${event.location}</p>` : ''}
        <p><strong>Fecha límite:</strong> ${format(new Date(event.confirmation_deadline), "d 'de' MMMM", { locale: es })}</p>
      </div>

      <p>Por favor, confirme su asistencia lo antes posible.</p>
      <p>Atentamente,<br>Equipo LIUMA</p>
    `,
  };
}

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
 * Per-email and per-event errors are caught so one failure can't block the rest;
 * reminder_sent is only set after an event's pass completes, and individual send
 * failures are swallowed (logged) so a single bad address doesn't cause the
 * whole event to retry — and re-email everyone — on the next load.
 */
export async function sendDueEventReminders({ schoolId, now = new Date() } = {}) {
  if (!schoolId) return 0;

  const events = await base44.entities.Event.filter({ school_id: schoolId, requires_confirmation: true });
  const due = selectEventsNeedingReminder(events, now);
  if (due.length === 0) return 0;

  // One user lookup for the whole pass (RLS-scoped to what the admin can see).
  const allUsers = await base44.entities.User.list();
  const userById = new Map(allUsers.map((u) => [u.id, u]));

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
        const responses = await base44.entities.EventResponse.filter({ event_id: event.id });
        const nonResponders = selectNonResponders(audiencePairs, responses);

        for (const pair of nonResponders) {
          const parent = userById.get(pair.parentId);
          if (!parent?.email) continue;
          const { from_name, subject, body } = reminderEmail(event, studentById.get(pair.studentId));
          try {
            await base44.integrations.Core.SendEmail({ from_name, to: parent.email, subject, body });
          } catch (sendError) {
            console.error('Event reminder email failed for parent', pair.parentId, sendError);
          }
        }
      }

      await base44.entities.Event.update(event.id, { reminder_sent: true });
      remindedEvents += 1;
    } catch (error) {
      console.error('Event confirmation reminder failed for event', event?.id, error);
    }
  }
  return remindedEvents;
}
