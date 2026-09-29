import { escapeHtml } from '@/lib/htmlEscape';

// `subject`/`emailBody` below are mirrored server-side in
// base44/functions/sendNotificationEmail/_templates.ts, which is now the
// only place that actually RENDERS and SENDS these (see that function's
// header comment — Base44 security scan, "Evitar el uso no autorizado de
// créditos"). `inAppTitle`/`inAppContent` are not sent anywhere since P10b
// removed the in-app channel (see notificationService). Keep the subject/emailBody halves of the two files in sync by
// hand; each carries a comment pointing at the other.
//
// The four events that fan out to many recipients (emergency_alert,
// payment_due, event_confirmation_reminder, support_ticket_escalated) are
// now sent entirely server-side by base44/functions/sendBulkNotification,
// by email only (its `_templates.ts` is a byte-identical copy of
// sendNotificationEmail's, enforced by a test). Their `inAppTitle`/
// `inAppContent` halves below are not used for those four any more.
//
// All interpolated values below are escaped before landing in an HTML email
// body — several of them (userName/userEmail at signup, free-text ticket
// fields, the emergency-alert message) originate from user input, so an
// unescaped template would let that input inject HTML/script into a
// recipient's email client (OWASP A03 / CWE-79). Escaping every interpolated
// value uniformly, including the ones that are normally safe, keeps this
// file safe by default as new templates/fields are added.
export const NOTIFICATION_TEMPLATES = {
  new_user_pending: {
    subject: ({ schoolName }) => `Nuevo usuario pendiente de aprobación - ${schoolName || 'LIUMA'}`,
    emailBody: ({ userName, userEmail, roleName }) => `
      <h2>Nuevo registro pendiente de aprobación</h2>
      <p>Un nuevo usuario se ha registrado y necesita tu aprobación:</p>
      <ul>
        <li><strong>Nombre:</strong> ${escapeHtml(userName)}</li>
        <li><strong>Email:</strong> ${escapeHtml(userEmail)}</li>
        <li><strong>Rol:</strong> ${escapeHtml(roleName)}</li>
      </ul>
      <p>Por favor, ingresa a la aplicación para aprobar o rechazar esta solicitud.</p>
    `,
    inAppTitle: () => 'Nuevo usuario pendiente',
    inAppContent: ({ userName, roleName }) => `${userName} (${roleName}) está pendiente de aprobación.`,
  },
  payment_due: {
    subject: ({ studentName }) => `Recordatorio: Pago próximo a vencer - ${studentName}`,
    emailBody: ({ studentName, conceptName, amountLabel, dueDateLabel }) => `
      <h2>Recordatorio de Pago</h2>
      <p>Estimado padre/madre de familia:</p>
      <p>Le recordamos que tiene un pago pendiente que vence pronto:</p>
      <div style="background: #fef3c7; padding: 16px; border-radius: 8px; border: 1px solid #fbbf24; margin: 16px 0;">
        <p><strong>Estudiante:</strong> ${escapeHtml(studentName)}</p>
        <p><strong>Concepto:</strong> ${escapeHtml(conceptName)}</p>
        <p><strong>Monto:</strong> ${escapeHtml(amountLabel)}</p>
        <p><strong>Fecha de vencimiento:</strong> ${escapeHtml(dueDateLabel)}</p>
      </div>
      <p>Por favor, realice su pago antes de la fecha de vencimiento para evitar recargos.</p>
      <p>Atentamente,<br>Equipo LIUMA</p>
    `,
    inAppTitle: () => 'Pago por vencer',
    inAppContent: ({ studentName, dueDateLabel }) => `Tienes un pago pendiente de ${studentName} con vencimiento ${dueDateLabel}.`,
  },
  event_confirmation_reminder: {
    subject: ({ eventTitle }) => `Recordatorio: Confirma asistencia a ${eventTitle}`,
    emailBody: ({ studentName, eventTitle, dateLabel, timeLabel, locationLabel, deadlineLabel }) => `
      <h2>Recordatorio de Confirmación</h2>
      <p>Estimado padre/madre de familia:</p>
      <p>Le recordamos confirmar la asistencia de <strong>${escapeHtml(studentName)}</strong> al siguiente evento:</p>
      <div style="background: #dbeafe; padding: 16px; border-radius: 8px; border: 1px solid #3b82f6; margin: 16px 0;">
        <p><strong>${escapeHtml(eventTitle)}</strong></p>
        <p><strong>Fecha:</strong> ${escapeHtml(dateLabel)}</p>
        ${timeLabel ? `<p><strong>Hora:</strong> ${escapeHtml(timeLabel)}</p>` : ''}
        ${locationLabel ? `<p><strong>Lugar:</strong> ${escapeHtml(locationLabel)}</p>` : ''}
        <p><strong>Fecha límite:</strong> ${escapeHtml(deadlineLabel)}</p>
      </div>
      <p>Por favor, confirme su asistencia lo antes posible.</p>
      <p>Atentamente,<br>Equipo LIUMA</p>
    `,
    inAppTitle: ({ eventTitle }) => `Confirma asistencia a ${eventTitle}`,
    inAppContent: ({ studentName, deadlineLabel }) => `Confirma la asistencia de ${studentName} antes del ${deadlineLabel}.`,
  },
  emergency_alert: {
    subject: ({ schoolName }) => `🚨 Alerta de emergencia - ${schoolName || 'Escuela'}`,
    emailBody: ({ message }) => `
      <h2>🚨 Alerta de emergencia</h2>
      <p>${escapeHtml(message)}</p>
      <p>Por favor, siga las instrucciones del personal de la escuela.</p>
    `,
    inAppTitle: () => '🚨 Alerta de emergencia',
    inAppContent: ({ message }) => message,
  },
  support_ticket_escalated: {
    subject: ({ ticketNumber, subjectText }) => `Nuevo ticket de soporte ${ticketNumber}: ${subjectText}`,
    emailBody: ({ ticketNumber, subjectText, requesterName, categoryLabel, priorityLabel, slaDateLabel, description }) => `
      <h2>Nuevo ticket de soporte escalado</h2>
      <p>Se ha escalado una solicitud que requiere tu atención.</p>
      <div style="background: #eef2ff; padding: 16px; border-radius: 8px; border: 1px solid #c7d2fe; margin: 16px 0;">
        <p><strong>Ticket:</strong> ${escapeHtml(ticketNumber)}</p>
        <p><strong>Asunto:</strong> ${escapeHtml(subjectText)}</p>
        <p><strong>Solicitante:</strong> ${escapeHtml(requesterName)}</p>
        <p><strong>Categoría:</strong> ${escapeHtml(categoryLabel)}</p>
        <p><strong>Prioridad:</strong> ${escapeHtml(priorityLabel)}</p>
        <p><strong>Compromiso de primera respuesta:</strong> ${escapeHtml(slaDateLabel)}</p>
      </div>
      <p>${escapeHtml(description || '')}</p>
      <p>Ingresa a LIUMA &gt; Soporte para responder.</p>
    `,
    inAppTitle: ({ ticketNumber }) => `Nuevo ticket ${ticketNumber}`,
    inAppContent: ({ subjectText, priorityLabel }) => `${subjectText} (prioridad ${priorityLabel}).`,
  },
  support_ticket_reply: {
    subject: ({ ticketNumber }) => `Respuesta a tu ticket de soporte ${ticketNumber}`,
    emailBody: ({ ticketNumber, subjectText, replyBody }) => `
      <h2>Tienes una respuesta en tu ticket de soporte</h2>
      <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; border: 1px solid #bbf7d0; margin: 16px 0;">
        <p><strong>Ticket:</strong> ${escapeHtml(ticketNumber)}</p>
        <p><strong>Asunto:</strong> ${escapeHtml(subjectText)}</p>
      </div>
      <p>${escapeHtml(replyBody || '')}</p>
      <p>Ingresa a LIUMA &gt; Soporte para ver la conversación completa.</p>
    `,
    inAppTitle: ({ ticketNumber }) => `Respuesta en ${ticketNumber}`,
    inAppContent: ({ subjectText }) => `Tu ticket "${subjectText}" tiene una nueva respuesta.`,
  },
  support_ticket_resolved: {
    subject: ({ ticketNumber }) => `Ticket de soporte ${ticketNumber} resuelto`,
    emailBody: ({ ticketNumber, subjectText, resolutionNote }) => `
      <h2>Tu ticket de soporte fue marcado como resuelto</h2>
      <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; border: 1px solid #bbf7d0; margin: 16px 0;">
        <p><strong>Ticket:</strong> ${escapeHtml(ticketNumber)}</p>
        <p><strong>Asunto:</strong> ${escapeHtml(subjectText)}</p>
      </div>
      <p>${escapeHtml(resolutionNote || 'Si tu problema continúa, puedes reabrir el ticket desde la app.')}</p>
    `,
    inAppTitle: ({ ticketNumber }) => `Ticket ${ticketNumber} resuelto`,
    inAppContent: ({ subjectText }) => `Tu ticket "${subjectText}" fue marcado como resuelto.`,
  },
};
