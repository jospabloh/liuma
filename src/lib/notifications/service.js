import { base44 } from '@/api/base44Client';
import { NOTIFICATION_TEMPLATES } from './templates';

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
    await base44.entities.AuditLog.create({
      school_id: payload.schoolId,
      user_id: payload.userId,
      action: 'NOTIFICATION_DELIVERY_FAILED',
      target_type: payload.eventType,
      target_id: payload.recipientId || payload.email || 'unknown',
      details: payload,
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

  async sendEmail({ schoolId, email, subject, body, eventType, actorUserId }) {
    return deliverWithRetry({
      schoolId,
      userId: actorUserId,
      email,
      eventType,
      channel: 'email',
      execute: async () => {
        await base44.integrations.Core.SendEmail({ to: email, subject, body });
      },
    });
  },

  async sendHighPriorityAlert({ schoolId, title, content, actorUserId }) {
    return deliverWithRetry({
      schoolId,
      userId: actorUserId,
      eventType: 'emergency_alert',
      channel: 'high_priority_alert',
      execute: async () => {
        await base44.entities.Notice.create({
          school_id: schoolId,
          scope: 'SCHOOL',
          title,
          content,
          priority: 'URGENT',
          is_emergency: true,
          author_id: actorUserId,
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
          subject: template.subject(templateContext),
          body: template.emailBody(templateContext),
          eventType,
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
