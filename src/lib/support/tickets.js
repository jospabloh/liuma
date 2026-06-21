import { base44 } from '@/api/base44Client';
import { AUDIT_ENTITIES, logAuditEvent } from '@/lib/audit';
import { notificationService } from '@/lib/notifications/service';
import {
  SUPPORT_STATUS,
  SUPPORT_AUTHOR_ROLE,
  SUPPORT_CHANNEL,
  SUPPORT_TIER,
  SUPPORT_EMAIL,
  TERMINAL_STATUSES,
  DEFAULT_CATEGORY,
  DEFAULT_PRIORITY,
} from './constants.js';
import { resolveSupportRouting } from './routing.js';
import { computeSlaDueAt, selectTicketsToAutoEscalate } from './sla.js';
import { generateTicketNumber } from './ticketNumber.js';
import { assertTransition } from './statusMachine.js';

/**
 * Allocate the next per-year ticket number for a school.
 *
 * Note: the sequence is derived from a live count of the school's tickets for
 * the current year, so under heavy concurrency two tickets could in theory
 * collide. That is acceptable at current volume; if it ever matters, move the
 * counter to a Base44 server function with an atomic increment. See
 * docs/support-system.md.
 */
async function allocateTicketNumber(schoolId) {
  const year = new Date().getUTCFullYear();
  let sequence = 1;
  try {
    const existing = await base44.entities.SupportTicket.filter({ school_id: schoolId });
    const thisYear = (existing || []).filter((t) => {
      const created = t.created_date || t.created_at;
      return created && new Date(created).getUTCFullYear() === year;
    });
    sequence = thisYear.length + 1;
  } catch (error) {
    // If the count fails, fall back to a timestamp-based suffix so the ticket
    // still gets a unique-enough number rather than failing creation.
    sequence = Number(String(Date.now()).slice(-6));
  }
  return generateTicketNumber({ sequence, date: new Date() });
}

/**
 * Find the recipient profile(s) for an escalated ticket.
 *  - SCHOOL_ADMIN tier → active ADMIN profiles in the requester's school.
 *  - PLATFORM tier     → the super-admin owner profile(s).
 */
async function resolveAssigneeRecipients({ tier, schoolId }) {
  try {
    if (tier === SUPPORT_TIER.PLATFORM) {
      const owners = await base44.entities.UserProfile.filter({ is_super_admin: true });
      return owners || [];
    }
    const admins = await base44.entities.UserProfile.filter({
      school_id: schoolId,
      app_role: 'ADMIN',
      status: 'ACTIVE',
    });
    return admins || [];
  } catch (error) {
    return [];
  }
}

async function notifyAssignees({ recipients, schoolId, actorUserId, ticket, description, tier }) {
  const templateContext = {
    ticketNumber: ticket.ticket_number,
    subjectText: ticket.subject,
    requesterName: ticket.requester_name || 'Usuario',
    categoryLabel: ticket.category,
    priorityLabel: ticket.priority,
    slaDateLabel: ticket.sla_due_at ? new Date(ticket.sla_due_at).toLocaleString('es-MX') : 'N/D',
    description,
  };

  try {
    if (recipients.length) {
      await notificationService.sendByEvent({
        eventType: 'support_ticket_escalated',
        schoolId,
        actorUserId,
        recipients,
        channels: ['in_app', 'email'],
        priority: ticket.priority,
        templateContext,
      });
    }

    // Tier-2 (platform) escalations always email the fixed support inbox, so
    // "soporte" is notified even when no owner profile exists in the directory
    // (the is_super_admin lookup can legitimately return nobody).
    if (tier === SUPPORT_TIER.PLATFORM) {
      await notificationService.sendEventEmailTo({
        eventType: 'support_ticket_escalated',
        email: SUPPORT_EMAIL,
        schoolId,
        actorUserId,
        templateContext,
      });
    }
  } catch (error) {
    // Notification failures are logged inside the service; never block ticket creation.
    console.error('Error notifying support assignees:', error);
  }
}

/**
 * Create (and immediately escalate) a support ticket.
 *
 * The Lumi L0 deflection happens before this is called; by the time we create
 * a ticket the requester has confirmed the AI could not solve their problem.
 */
export async function createSupportTicket({
  user,
  userProfile,
  subject,
  description,
  category = DEFAULT_CATEGORY,
  priority = DEFAULT_PRIORITY,
  channelOrigin = SUPPORT_CHANNEL.MANUAL,
  aiAttempted = false,
  aiResolutionSummary = null,
}) {
  if (!user || !userProfile || !subject || !description) {
    throw new Error('createSupportTicket requires user, userProfile, subject and description');
  }

  const schoolId = userProfile.school_id;
  const routing = resolveSupportRouting({ requesterRole: userProfile.app_role, category });
  const slaDueAt = computeSlaDueAt({ priority, tier: routing.tier });
  const ticketNumber = await allocateTicketNumber(schoolId);
  const nowIso = new Date().toISOString();

  const ticket = await base44.entities.SupportTicket.create({
    ticket_number: ticketNumber,
    school_id: schoolId,
    requester_user_id: user.id,
    requester_profile_id: userProfile.id,
    requester_role: userProfile.app_role,
    requester_name: user.full_name || user.email || 'Usuario',
    subject,
    category,
    priority,
    status: SUPPORT_STATUS.ESCALATED,
    tier: routing.tier,
    assignee_role: routing.assigneeRole,
    channel_origin: channelOrigin,
    ai_attempted: aiAttempted,
    ai_resolution_summary: aiResolutionSummary,
    sla_due_at: slaDueAt,
    first_response_at: null,
    resolved_at: null,
    escalated_at: nowIso,
  });

  // Seed the thread: the requester's description (and the AI attempt, if any).
  // `requester_user_id` is denormalized onto every message so Base44 RLS can
  // scope reads to the ticket's own requester (it can't join to the parent).
  await base44.entities.SupportTicketMessage.create({
    ticket_id: ticket.id,
    school_id: schoolId,
    requester_user_id: user.id,
    author_user_id: user.id,
    author_role: SUPPORT_AUTHOR_ROLE.REQUESTER,
    body: description,
  });

  if (aiAttempted && aiResolutionSummary) {
    await base44.entities.SupportTicketMessage.create({
      ticket_id: ticket.id,
      school_id: schoolId,
      requester_user_id: user.id,
      author_user_id: null,
      author_role: SUPPORT_AUTHOR_ROLE.AI,
      body: aiResolutionSummary,
    });
  }

  const recipients = await resolveAssigneeRecipients({ tier: routing.tier, schoolId });
  await notifyAssignees({ recipients, schoolId, actorUserId: user.id, ticket, description, tier: routing.tier });

  await logAuditEvent({
    user,
    userProfile,
    entity: AUDIT_ENTITIES.SUPPORT_TICKET,
    entityId: ticket.id,
    action: 'SUPPORT_TICKET_CREATED',
    reason: `Ticket ${ticketNumber} escalated to ${routing.tier}`,
    context: {
      ticket_number: ticketNumber,
      category,
      priority,
      tier: routing.tier,
      assignee_role: routing.assigneeRole,
      channel_origin: channelOrigin,
      ai_attempted: aiAttempted,
    },
  });

  return ticket;
}

/** Append a reply to a ticket thread and notify the other party. */
export async function addSupportMessage({ user, userProfile, ticket, body, authorRole }) {
  if (!user || !userProfile || !ticket || !body) {
    throw new Error('addSupportMessage requires user, userProfile, ticket and body');
  }

  const message = await base44.entities.SupportTicketMessage.create({
    ticket_id: ticket.id,
    school_id: ticket.school_id,
    requester_user_id: ticket.requester_user_id,
    author_user_id: user.id,
    author_role: authorRole,
    body,
  });

  const isStaffReply = authorRole !== SUPPORT_AUTHOR_ROLE.REQUESTER;

  // First staff reply stops the SLA clock.
  if (isStaffReply && !ticket.first_response_at) {
    try {
      await base44.entities.SupportTicket.update(ticket.id, {
        first_response_at: new Date().toISOString(),
        status: ticket.status === SUPPORT_STATUS.ESCALATED ? SUPPORT_STATUS.IN_PROGRESS : ticket.status,
      });
    } catch (error) {
      console.error('Error stamping support first response:', error);
    }
  }

  // Notify the requester when staff replies.
  if (isStaffReply && ticket.requester_user_id) {
    try {
      const requesterProfiles = await base44.entities.UserProfile.filter({ user_id: ticket.requester_user_id });
      await notificationService.sendByEvent({
        eventType: 'support_ticket_reply',
        schoolId: ticket.school_id,
        actorUserId: user.id,
        recipients: requesterProfiles || [],
        channels: ['in_app', 'email'],
        templateContext: { ticketNumber: ticket.ticket_number, subjectText: ticket.subject, replyBody: body },
      });
    } catch (error) {
      console.error('Error notifying requester of support reply:', error);
    }
  }

  await logAuditEvent({
    user,
    userProfile,
    entity: AUDIT_ENTITIES.SUPPORT_TICKET,
    entityId: ticket.id,
    action: 'SUPPORT_TICKET_MESSAGE',
    reason: `Reply by ${authorRole} on ${ticket.ticket_number}`,
    context: { ticket_number: ticket.ticket_number, author_role: authorRole },
  });

  return message;
}

/** Transition a ticket's status, enforcing the lifecycle state machine. */
export async function transitionTicketStatus({ user, userProfile, ticket, toStatus, note }) {
  const check = assertTransition(ticket.status, toStatus);
  if (!check.valid) {
    throw new Error(check.reason);
  }

  const patch = { status: toStatus };
  if (toStatus === SUPPORT_STATUS.RESOLVED) patch.resolved_at = new Date().toISOString();

  await base44.entities.SupportTicket.update(ticket.id, patch);

  if (note) {
    await base44.entities.SupportTicketMessage.create({
      ticket_id: ticket.id,
      school_id: ticket.school_id,
      requester_user_id: ticket.requester_user_id,
      author_user_id: user.id,
      author_role: SUPPORT_AUTHOR_ROLE.SYSTEM,
      body: note,
    });
  }

  if (toStatus === SUPPORT_STATUS.RESOLVED && ticket.requester_user_id) {
    try {
      const requesterProfiles = await base44.entities.UserProfile.filter({ user_id: ticket.requester_user_id });
      await notificationService.sendByEvent({
        eventType: 'support_ticket_resolved',
        schoolId: ticket.school_id,
        actorUserId: user.id,
        recipients: requesterProfiles || [],
        channels: ['in_app', 'email'],
        templateContext: { ticketNumber: ticket.ticket_number, subjectText: ticket.subject, resolutionNote: note },
      });
    } catch (error) {
      console.error('Error notifying requester of resolution:', error);
    }
  }

  await logAuditEvent({
    user,
    userProfile,
    entity: AUDIT_ENTITIES.SUPPORT_TICKET,
    entityId: ticket.id,
    action: 'SUPPORT_TICKET_STATUS_CHANGE',
    reason: `${ticket.status} → ${toStatus} on ${ticket.ticket_number}`,
    context: { ticket_number: ticket.ticket_number, from: ticket.status, to: toStatus },
  });

  return { ...ticket, ...patch };
}

/**
 * Escalate a director-tier (SCHOOL_ADMIN / L1) ticket up to soporte (the
 * platform owner, L2). This is the sequential handoff: Lumi (L0) → director
 * (L1) → soporte (L2). It re-tiers the ticket, restarts the SLA clock at the
 * fixed 48-hour platform target, drops a system note in the thread, emails the
 * Tier-2 inbox (soporte@…) and audit-logs the handoff.
 *
 * Cross-tier escalation intentionally bypasses the status state machine and
 * sets the ticket back to ESCALATED ("awaiting staff"), because soporte now
 * owns it regardless of where the director left it (in progress, waiting, …).
 *
 * @param {{ trigger?: 'manual'|'sla_lapse', note?: string }} opts
 */
export async function escalateTicketToSupport({ user, userProfile, ticket, trigger = 'manual', note } = {}) {
  if (!ticket) throw new Error('escalateTicketToSupport requires a ticket');
  if (ticket.tier === SUPPORT_TIER.PLATFORM) return ticket; // already with soporte
  if (TERMINAL_STATUSES.includes(ticket.status)) {
    throw new Error('No se puede escalar un ticket cerrado o resuelto.');
  }

  const nowIso = new Date().toISOString();
  const patch = {
    tier: SUPPORT_TIER.PLATFORM,
    assignee_role: SUPPORT_AUTHOR_ROLE.OWNER,
    status: SUPPORT_STATUS.ESCALATED,
    // Soporte gets a fresh 48-hour clock; the director's response window is over.
    sla_due_at: computeSlaDueAt({ priority: ticket.priority, tier: SUPPORT_TIER.PLATFORM, from: new Date() }),
    first_response_at: null,
    escalated_at: nowIso,
  };
  const updated = { ...ticket, ...patch };
  await base44.entities.SupportTicket.update(ticket.id, patch);

  const systemNote =
    note ||
    (trigger === 'sla_lapse'
      ? 'Escalado automáticamente a soporte: el director no respondió dentro del SLA.'
      : 'Escalado a soporte por la dirección de la escuela.');
  await base44.entities.SupportTicketMessage.create({
    ticket_id: ticket.id,
    school_id: ticket.school_id,
    requester_user_id: ticket.requester_user_id,
    author_user_id: user?.id || null,
    author_role: SUPPORT_AUTHOR_ROLE.SYSTEM,
    body: systemNote,
  });

  // Notify soporte: the fixed Tier-2 inbox always, plus any owner profiles.
  const recipients = await resolveAssigneeRecipients({ tier: SUPPORT_TIER.PLATFORM, schoolId: ticket.school_id });
  await notifyAssignees({
    recipients,
    schoolId: ticket.school_id,
    actorUserId: user?.id || null,
    ticket: updated,
    description: systemNote,
    tier: SUPPORT_TIER.PLATFORM,
  });

  if (user && userProfile) {
    await logAuditEvent({
      user,
      userProfile,
      entity: AUDIT_ENTITIES.SUPPORT_TICKET,
      entityId: ticket.id,
      action: 'SUPPORT_TICKET_STATUS_CHANGE',
      reason: `Ticket ${ticket.ticket_number} escalado a soporte (${trigger})`,
      context: { ticket_number: ticket.ticket_number, trigger, from_tier: ticket.tier, to_tier: SUPPORT_TIER.PLATFORM },
    });
  }

  return updated;
}

/**
 * Opportunistic auto-escalation: given the director's queue, roll up every
 * director-tier ticket whose SLA has lapsed without a first response to soporte.
 * Called when the support queue loads (the app has no cron), so the handoff
 * happens the next time anyone with access opens the panel. Returns the number
 * escalated.
 */
export async function autoEscalateBreachedTickets({ user, userProfile, tickets, now = new Date() } = {}) {
  const due = selectTicketsToAutoEscalate(tickets, now);
  let escalated = 0;
  for (const ticket of due) {
    try {
      await escalateTicketToSupport({ user, userProfile, ticket, trigger: 'sla_lapse' });
      escalated += 1;
    } catch (error) {
      console.error('Auto-escalation to soporte failed for ticket', ticket?.id, error);
    }
  }
  return escalated;
}

/** Tickets opened by the current user (requester view). */
export async function listMyTickets(user) {
  if (!user) return [];
  const tickets = await base44.entities.SupportTicket.filter({ requester_user_id: user.id }, '-created_date');
  return tickets || [];
}

/**
 * Management-queue tickets. A school director sees their school's tickets; the
 * platform owner sees every ticket across all tenants.
 *
 * Ownership is passed in explicitly because it can't be derived from
 * `UserProfile` alone: the deployed Base44 schema may not expose an
 * `is_super_admin` field, so the caller also considers the authenticated
 * Base44 `User.role` (the app creator is `admin`). The owner branch relies on
 * Base44 RLS allowing the owner to read all rows.
 */
export async function listQueueTickets(userProfile, { isOwner } = {}) {
  if (!userProfile) return [];
  const ownerAccess = isOwner ?? !!userProfile.is_super_admin;
  if (ownerAccess) {
    const all = await base44.entities.SupportTicket.list('-created_date');
    return all || [];
  }
  const scoped = await base44.entities.SupportTicket.filter({ school_id: userProfile.school_id }, '-created_date');
  return scoped || [];
}

/** Full message thread for a ticket. */
export async function listTicketMessages(ticketId) {
  if (!ticketId) return [];
  const messages = await base44.entities.SupportTicketMessage.filter({ ticket_id: ticketId }, 'created_date');
  return messages || [];
}
