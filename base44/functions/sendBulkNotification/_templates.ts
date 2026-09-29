// _templates.ts — server-side mirror of src/lib/notifications/templates.js's
// `subject`/`emailBody` renderers ONLY (the `inAppTitle`/`inAppContent` half
// stays client-side, unchanged — sendInApp writes a Notice row directly via
// RLS, it never touches a credit-consuming integration, so it isn't in scope
// for this move). Deno functions can't import across function directories
// (same constraint documented on guardedEntityWrite/entry.ts), so this is a
// hand-kept copy, not a shared module — src/lib/notifications/templates.js
// carries a comment pointing back here, and this file points back at it.
// Keep the two in sync by hand whenever a template's copy or fields change.
//
// This file is ALSO copied, byte for byte, to
// base44/functions/sendBulkNotification/_templates.ts (server-side fan-out
// for emergency alerts, reminders and ticket escalations — same
// no-cross-directory-import constraint). Edit it here, then `cp` it there;
// tests/unit/notifications-fanout.test.js fails if the two copies differ.
//
// escapeHtml is duplicated rather than imported for the same reason
// src/lib/htmlEscape.js exists standalone: several interpolated fields
// (userName/userEmail at signup, free-text ticket bodies, the emergency
// message) trace back to end-user input, so every interpolation is escaped
// uniformly (OWASP A03 / CWE-79), even fields that are normally safe.
export function escapeHtml(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// deno-lint-ignore no-explicit-any
type Ctx = Record<string, any>;

export const NOTIFICATION_TEMPLATES: Record<string, { subject: (ctx: Ctx) => string; emailBody: (ctx: Ctx) => string }> = {
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
  },
  emergency_alert: {
    subject: ({ schoolName }) => `🚨 Alerta de emergencia - ${schoolName || 'Escuela'}`,
    emailBody: ({ message }) => `
      <h2>🚨 Alerta de emergencia</h2>
      <p>${escapeHtml(message)}</p>
      <p>Por favor, siga las instrucciones del personal de la escuela.</p>
    `,
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
  },
};
