// _inApp.ts — server-side mirror of the `inAppTitle`/`inAppContent` halves of
// src/lib/notifications/templates.js, for the four events this function fans
// out. Plain text (a Notice is rendered by React as text, never as HTML), so
// no escaping here — the HTML email bodies are in `_templates.ts`, which
// escapes everything. Keep in sync with templates.js by hand; it points back
// here.

// deno-lint-ignore no-explicit-any
type Ctx = Record<string, any>;

export const IN_APP_TEMPLATES: Record<string, { title: (ctx: Ctx) => string; content: (ctx: Ctx) => string }> = {
  payment_due: {
    title: () => 'Pago por vencer',
    content: ({ studentName, dueDateLabel }) => `Tienes un pago pendiente de ${studentName} con vencimiento ${dueDateLabel}.`,
  },
  event_confirmation_reminder: {
    title: ({ eventTitle }) => `Confirma asistencia a ${eventTitle}`,
    content: ({ studentName, deadlineLabel }) => `Confirma la asistencia de ${studentName} antes del ${deadlineLabel}.`,
  },
  emergency_alert: {
    title: () => '🚨 Alerta de emergencia',
    content: ({ message }) => String(message || ''),
  },
  support_ticket_escalated: {
    title: ({ ticketNumber }) => `Nuevo ticket ${ticketNumber}`,
    content: ({ subjectText, priorityLabel }) => `${subjectText} (prioridad ${priorityLabel}).`,
  },
};
