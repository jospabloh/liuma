import { base44 } from '@/api/base44Client';
import { NOTIFICATION_TEMPLATES } from './templates';
import { recordAuditRow } from '@/lib/audit';
import { guardedCreate } from '@/lib/authorization/guardedWrite';

const MAX_RETRIES = 3;

const getRoleFlagKey = (role) => {
  const normalized = (role || '').toUpperCase();
  if (!normalized) return null;
  return `role_${normalized.toLowerCase()}`;
};

const isChannelEnabled = ({ schoolPrefs, userPrefs, channel, role }) => {
  const roleKey = getRoleFlagKey(role);
  const schoolChannelEnabled = schoolPrefs?.[channel] !== false;
  const schoolRoleEnabled = roleKey ? schoolPrefs?.[roleKey] !== false : true;
  const userChannelEnabled = userPrefs?.[channel] !== false;
  const userRoleEnabled = roleKey ? userPrefs?.[roleKey] !== false : true;
  return schoolChannelEnabled && schoolRoleEnabled && userChannelEnabled && userRoleEnabled;
};

const logDeliveryFailure = async (payload) => {
  try {
    // AuditLog create is service-role only (P7); the actor is whoever is
    // signed in, derived server-side by recordAuditEvent.
    await recordAuditRow({
      schoolId: payload.schoolId,
      action: 'NOTIFICATION_DELIVERY_FAILED',
      entity: payload.eventType,
      entityId: payload.recipientId || payload.email || 'unknown',
      context: payload,
    });
  } catch (error) {
    console.error('Error logging notification failure telemetry:', error);
  }
};

const deliverWithRetry = async ({ schoolId, userId, recipientId, email, eventType, channel, execute }) => {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      await execute();
      return true;
    } catch (error) {
      lastError = error;
      if (attempt === MAX_RETRIES) {
        await logDeliveryFailure({
          schoolId,
          userId,
          recipientId,
          email,
          eventType,
          channel,
          attempt,
          error: String(error?.message || error),
        });
      }
    }
  }
  throw lastError;
};

export const notificationService = {
  async sendInApp({ schoolId, recipientId, title, content, priority = 'NORMAL', eventType, actorUserId }) {
    return deliverWithRetry({
      schoolId,
      userId: actorUserId,
      recipientId,
      eventType,
      channel: 'in_app',
      execute: async () => {
        await base44.entities.Notice.create({
          school_id: schoolId,
          scope: 'USER',
          user_id: recipientId,
          title,
          content,
          priority,
          sent_at: new Date().toISOString(),
        });
      },
    });
  },

  /**
   * Sends a templated email via the sendNotificationEmail Safe function — the
   * sanctioned path for every credit-consuming SendEmail call in this app
   * (see base44/functions/sendNotificationEmail/entry.ts for why: subject,
   * body and recipient authorization are all derived/checked server-side, so
   * the client only ever supplies an eventType + plain-value templateContext,
   * never a subject/body). `base44.functions.invoke` throws on a non-2xx
   * response (`error.data.error`/`error.data.code`, same convention as
   * guardedEntityWrite/governRoleChange), so a rejected send still surfaces
   * here as a thrown error for deliverWithRetry to retry/log exactly as it
   * did when SendEmail itself could fail.
   */
  async sendEmail({ schoolId, email, eventType, templateContext, actorUserId }) {
    return deliverWithRetry({
      schoolId,
      userId: actorUserId,
      email,
      eventType,
      channel: 'email',
      execute: async () => {
        await base44.functions.invoke('sendNotificationEmail', { eventType, schoolId, email, templateContext });
      },
    });
  },

  /**
   * Send an event-templated email to a fixed address (not a user profile).
   * Used for the Tier-2 support inbox, which may not correspond to any
   * registered user. Returns false if the event has no email template.
   */
  async sendEventEmailTo({ eventType, email, schoolId, actorUserId, templateContext }) {
    const template = NOTIFICATION_TEMPLATES[eventType];
    if (!template || !email) return false;
    return this.sendEmail({
      schoolId,
      email,
      eventType,
      templateContext,
      actorUserId,
    });
  },

  async sendHighPriorityAlert({ schoolId, title, content, actorUserId }) {
    return deliverWithRetry({
      schoolId,
      userId: actorUserId,
      eventType: 'emergency_alert',
      channel: 'high_priority_alert',
      execute: async () => {
        // Notice create is service-role only since P7: guardedEntityWrite
        // checks the sender's role in this school and stamps author_id itself.
        await guardedCreate('Notice', {
          school_id: schoolId,
          scope: 'SCHOOL',
          title,
          content,
          priority: 'URGENT',
          is_emergency: true,
          sent_at: new Date().toISOString(),
        });
      },
    });
  },

  async sendByEvent({
    eventType,
    schoolId,
    actorUserId,
    recipients,
    templateContext,
    channels = ['email'],
    priority = 'NORMAL',
  }) {
    const template = NOTIFICATION_TEMPLATES[eventType];
    if (!template) throw new Error(`Missing notification template for event: ${eventType}`);

    for (const recipient of recipients) {
      const schoolPrefs = recipient.school_notification_preferences || {};
      const userPrefs = recipient.notification_preferences || {};

      if (channels.includes('email') && recipient.email && isChannelEnabled({ schoolPrefs, userPrefs, channel: 'email', role: recipient.app_role })) {
        await this.sendEmail({
          schoolId,
          email: recipient.email,
          eventType,
          templateContext,
          actorUserId,
        });
      }

      if (channels.includes('in_app') && recipient.user_id && isChannelEnabled({ schoolPrefs, userPrefs, channel: 'in_app', role: recipient.app_role })) {
        await this.sendInApp({
          schoolId,
          recipientId: recipient.user_id,
          title: template.inAppTitle(templateContext),
          content: template.inAppContent(templateContext),
          priority,
          eventType,
          actorUserId,
        });
      }
    }
  },
};
