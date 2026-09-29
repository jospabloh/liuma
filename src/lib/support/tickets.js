import { base44 } from '@/api/base44Client';
import { invokeFunction } from '@/lib/functionResponse';
import { AUDIT_ENTITIES, logAuditEvent } from '@/lib/audit';
import { notificationService } from '@/lib/notifications/service';
import {
  SUPPORT_STATUS,
  SUPPORT_AUTHOR_ROLE,
  SUPPORT_CHANNEL,
  SUPPORT_TIER,
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
 * Append a message to a ticket thread through the postTicketMessage function.
 * SupportTicketMessage create is service-role only since P7 (2026-09-29): the
 * server re-reads the ticket, checks the caller is its requester, the
 * platform owner or an ACTIVE ADMIN of its school, and DERIVES author_role —
 * the client no longer gets to say who it is.
 *
 * @param {{ ticketId: string, body: string, kind?: 'reply'|'note'|'ai_summary' }} args
 */
async function postTicketMessage({ ticketId, body, kind = 'reply' }) {
  const result = await invokeFunction(base44, 'postTicketMessage', { ticketId, body, kind });
  return result?.message;
}

/**
 * Notify whoever owns an escalated ticket: the school's ACTIVE ADMINs for the
 * SCHOOL_ADMIN tier, or the platform owners plus the fixed Tier-2 inbox
 * (soporte@…, SUPPORT_EMAIL) for the PLATFORM tier.
 *
 * All of it happens server-side in sendBulkNotification, keyed on the stored
 * ticket id: the recipients, their addresses and the email text are read from
 * the ticket and its thread, never sent from here. That closes three things
 * the old client fan-out had wrong (sales-readiness audit F09/F30): the
 * admins' emails came from a User.list() that returns nobody but yourself; any
 * user could email soporte any number of times with free text of their own;
 * and the same ticket could be re-announced on every call. The server sends
 * once per (ticket, tier, recipient) and rate-limits requesters.
 *
 * Never throws: a notification failure must not block ticket creation.
 */
async function notifyAssignees({ ticket }) {
  try {
    await notificationService.sendBulk({ eventType: 'support_ticket_escalated', ticketId: ticket.id });
  } catch (error) {
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
  clientContext = null,
  aiBrief = null,
}) {
  if (!user || !userProfile || !subject || !description) {
    throw new Error('createSupportTicket requires user, userProfile, subject and description');
  }

  const schoolId = userProfile.school_id;
  const routing = resolveSupportRouting({ requesterRole: userProfile.app_role, category });
  const slaDueAt = computeSlaDueAt({ priority, tier: routing.tier });
  const ticketNumber = await allocateTicketNumber(schoolId);
  const nowIso = new Date().toISOString();

  /** @type {Record<string, any>} */
  const ticketPayload = {
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
    // Diagnostics captured client-side at submit time (route, app version,
    // browser, recent console warnings/errors). Stored as a JSON string so the
    // entity stays a flat scalar shape; staff see it parsed in the thread view.
    client_context: clientContext ? JSON.stringify(clientContext) : null,
  };

  // Structured brief from the AI BA/PO intake (FEATURE / TECHNICAL tickets). It
  // is additive: the same content is also embedded as Markdown in `description`
  // (the seed message body), so it survives even if the schema field isn't
  // deployed yet in Base44.
  if (aiBrief) ticketPayload.ai_brief = aiBrief;

  const ticket = await base44.entities.SupportTicket.create(ticketPayload);

  // Seed the thread: the requester's description (and the AI attempt, if any).
  // The function denormalizes `requester_user_id` onto every message so Base44
  // RLS can scope reads to the ticket's own requester (it can't join to the
  // parent).
  await postTicketMessage({ ticketId: ticket.id, body: description, kind: 'reply' });

  if (aiAttempted && aiResolutionSummary) {
    await postTicketMessage({ ticketId: ticket.id, body: aiResolutionSummary, kind: 'ai_summary' });
  }

  await notifyAssignees({ ticket });

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

  // Push en tiempo real a ACACIA Mission Control (no bloquea el flujo): refleja
  // el ticket sin sincronización manual y dispara la alerta unificada al soporte.
  invokeFunction(base44, 'notifyTicketCreated', { ticketId: ticket.id }).catch(() => {});

  return ticket;
}

/**
 * Append a reply to a ticket thread and notify the other party.
 *
 * `authorRole` is only the caller's expectation (and the fallback if the
 * server response carries no message): the role actually stored is the one
 * postTicketMessage derives, and that is what decides whether this was a
 * staff reply.
 */
export async function addSupportMessage({ user, userProfile, ticket, body, authorRole }) {
  if (!user || !userProfile || !ticket || !body) {
    throw new Error('addSupportMessage requires user, userProfile, ticket and body');
  }

  const message = await postTicketMessage({ ticketId: ticket.id, body, kind: 'reply' });
  const storedRole = message?.author_role || authorRole;

  const isStaffReply = storedRole !== SUPPORT_AUTHOR_ROLE.REQUESTER;

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
    reason: `Reply by ${storedRole} on ${ticket.ticket_number}`,
    context: { ticket_number: ticket.ticket_number, author_role: storedRole },
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
    await postTicketMessage({ ticketId: ticket.id, body: note, kind: 'note' });
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
  await postTicketMessage({ ticketId: ticket.id, body: systemNote, kind: 'note' });

  // Notify soporte (tier: SUPPORT_TIER.PLATFORM now that the patch above is
  // stored): the fixed Tier-2 inbox always, plus any owner profiles. The
  // server reads the tier and the hand-off note from the stored ticket.
  await notifyAssignees({ ticket: updated });

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
