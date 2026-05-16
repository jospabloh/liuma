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
};
