export const NOTIFICATION_TEMPLATES = {
  new_user_pending: {
    subject: ({ schoolName }) => `Nuevo usuario pendiente de aprobación - ${schoolName || 'LIUMA'}`,
    emailBody: ({ userName, userEmail, roleName }) => `
      <h2>Nuevo registro pendiente de aprobación</h2>
      <p>Un nuevo usuario se ha registrado y necesita tu aprobación:</p>
      <ul>
        <li><strong>Nombre:</strong> ${userName}</li>
        <li><strong>Email:</strong> ${userEmail}</li>
        <li><strong>Rol:</strong> ${roleName}</li>
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
        <p><strong>Estudiante:</strong> ${studentName}</p>
        <p><strong>Concepto:</strong> ${conceptName}</p>
        <p><strong>Monto:</strong> ${amountLabel}</p>
        <p><strong>Fecha de vencimiento:</strong> ${dueDateLabel}</p>
      </div>
      <p>Por favor, realice su pago antes de la fecha de vencimiento para evitar recargos.</p>
      <p>Atentamente,<br>Equipo LIUMA</p>
    `,
    inAppTitle: () => 'Pago por vencer',
    inAppContent: ({ studentName, dueDateLabel }) => `Tienes un pago pendiente de ${studentName} con vencimiento ${dueDateLabel}.`,
  },
  emergency_alert: {
    subject: ({ schoolName }) => `🚨 Alerta de emergencia - ${schoolName || 'Escuela'}`,
    emailBody: ({ message }) => `
      <h2>🚨 Alerta de emergencia</h2>
      <p>${message}</p>
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
        <p><strong>Ticket:</strong> ${ticketNumber}</p>
        <p><strong>Asunto:</strong> ${subjectText}</p>
        <p><strong>Solicitante:</strong> ${requesterName}</p>
        <p><strong>Categoría:</strong> ${categoryLabel}</p>
        <p><strong>Prioridad:</strong> ${priorityLabel}</p>
        <p><strong>Compromiso de primera respuesta:</strong> ${slaDateLabel}</p>
      </div>
      <p>${description || ''}</p>
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
        <p><strong>Ticket:</strong> ${ticketNumber}</p>
        <p><strong>Asunto:</strong> ${subjectText}</p>
      </div>
      <p>${replyBody || ''}</p>
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
        <p><strong>Ticket:</strong> ${ticketNumber}</p>
        <p><strong>Asunto:</strong> ${subjectText}</p>
      </div>
      <p>${resolutionNote || 'Si tu problema continúa, puedes reabrir el ticket desde la app.'}</p>
    `,
    inAppTitle: ({ ticketNumber }) => `Ticket ${ticketNumber} resuelto`,
    inAppContent: ({ subjectText }) => `Tu ticket "${subjectText}" fue marcado como resuelto.`,
  },
};
