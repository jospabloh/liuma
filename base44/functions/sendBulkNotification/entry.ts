// sendBulkNotification — server-side fan-out for the four notifications that
// go to MANY people: the emergency alert, the payment-due reminder, the event
// confirmation reminder and the support-ticket escalation.
//
// WHY THIS EXISTS (sales-readiness audit, findings F09 / F24 / F30, 2026-09-29).
// All four used to be fanned out from the browser:
//   - recipients' emails came from a client-side `User.list()`, which under
//     Base44's default User visibility returns only the caller's own row — so
//     the emergency alert and the reminders were mailed to `undefined`,
//     silently (F09);
//   - `sendByEvent` awaited one recipient at a time and `deliverWithRetry`
//     re-threw after its last attempt, so the first bad address — or the
//     director closing the tab — stopped delivery to everyone after it, on
//     the one feature a school can least afford to lose (F24);
//   - `support_ticket_escalated` let any ACTIVE user email the support inbox
//     or a school's admins any number of times with free-text fields they
//     wrote themselves (F30).
// Here the client sends only WHAT happened — a school id + message for an
// alert, or the id of a stored ChargeItem / Event / SupportTicket — and this
// function derives everything else from stored records with the service role:
// who the recipients are, their addresses, and the text of the message.
// Delivery runs with bounded concurrency, never aborts on one failure, and
// reports how many recipients were actually reached ("enviado a X de Y").
//
// Authority, per event:
//   emergency_alert           ACTIVE ADMIN of `schoolId`.
//   payment_due               ACTIVE ADMIN of the charge's STORED school.
//   event_confirmation_reminder ACTIVE ADMIN of the event's STORED school.
//   support_ticket_escalated  the ticket's own requester, or an ACTIVE ADMIN
//                             of the ticket's STORED school.
//   Platform owner (user.role === 'admin') bypasses, as everywhere else.
//
// Idempotency / rate limits:
//   payment_due and event_confirmation_reminder are once per record
//   (`reminder_sent`, which this function now owns). An escalation is once
//   per (ticket, tier, recipient) — `SupportTicket.escalation_notified_recipients`,
//   a server-only field — and a requester can trigger escalation notices for
//   at most ESCALATION_TICKETS_PER_DAY tickets in 24 h. The emergency alert
//   is deliberately NOT rate limited: it is ADMIN-only, and a limiter that
//   blocks the second alert of a real emergency is worse than the spam it
//   would prevent.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';
import { NOTIFICATION_TEMPLATES } from './_templates.ts';
import { IN_APP_TEMPLATES } from './_inApp.ts';
import {
  countWithinWindow,
  escalationKey,
  isChannelEnabled,
  mapWithConcurrency,
  moneyLabel,
  selectNonResponders,
  spanishDate,
} from './_fanout.ts';

const SUPPORT_EMAIL = 'soporte@acaciaco.com.mx';
const CONCURRENCY = 8;
const SEND_ATTEMPTS = 2;
const MAX_RECIPIENTS = 2000;
const MAX_MESSAGE_LEN = 2000;
const MAX_DESCRIPTION_LEN = 4000;
const ESCALATION_TICKETS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EMERGENCY_MESSAGE =
  'Se ha activado una alerta de emergencia. Por favor, siga las instrucciones del personal de la escuela.';

const CATEGORY_LABELS_ES: Record<string, string> = {
  ACADEMIC: 'Académico', PAYMENTS: 'Pagos', ACCOUNT: 'Cuenta', TECHNICAL: 'Técnico',
  FEATURE: 'Nueva función', BILLING: 'Facturación', OTHER: 'Otro',
};
const PRIORITY_LABELS_ES: Record<string, string> = {
  LOW: 'baja', NORMAL: 'normal', HIGH: 'alta', URGENT: 'urgente',
};

// deno-lint-ignore no-explicit-any
type Any = any;
type Ctx = Record<string, string | number>;
type Recipient = {
  key: string;          // idempotency identity: email if known, else user id
  userId?: string;      // in-app Notice target (omitted for the support inbox)
  email?: string;
  role?: string;
  prefs?: Any;
  ctx: Ctx;
};
type Plan = {
  schoolId: string;
  eventType: string;
  schoolPrefs?: Any;
  forceOn?: boolean;
  priority?: string;
  recipients: Recipient[];
  finalize?: (delivered: Recipient[], summary: Summary) => Promise<void>;
};
type Summary = {
  total: number; reached: number; emailed: number; emailFailed: number;
  inApp: number; inAppFailed: number; noChannel: number;
};

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

function bad(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, code, error: message }, { status });
}

async function requireActiveAdmin(sr: Any, user: Any, schoolId: string) {
  if (user.role === 'admin') return null;
  const profiles: Any[] = await sr.entities.UserProfile.filter({ user_id: user.id, school_id: schoolId }, '-created_date');
  const admin = profiles.find((p) => p.app_role === 'ADMIN' && p.status === 'ACTIVE');
  if (!admin) throw new HttpError(403, 'NOT_ADMIN', 'Requires an active ADMIN profile in this school');
  return admin;
}

async function usersByIds(sr: Any, ids: string[]): Promise<Map<string, Any>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const byId = new Map<string, Any>();
  if (unique.length === 0) return byId;
  const rows: Any[] = await sr.entities.User.filter({ id: { $in: unique } }, undefined, MAX_RECIPIENTS).catch(() => []);
  for (const u of rows || []) if (u?.id) byId.set(String(u.id), u);
  return byId;
}

async function withRetry(fn: () => Promise<unknown>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt += 1) {
    try {
      await fn();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < SEND_ATTEMPTS) await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Per-event planners: authorize, then resolve recipients from stored records.
// ---------------------------------------------------------------------------

async function planEmergency(sr: Any, user: Any, body: Any): Promise<Plan> {
  const schoolId = String(body?.schoolId || '');
  if (!schoolId) throw new HttpError(400, 'MISSING_SCHOOL', 'schoolId is required');
  await requireActiveAdmin(sr, user, schoolId);

  const school: Any = await sr.entities.School.get(schoolId).catch(() => null);
  if (!school) throw new HttpError(404, 'SCHOOL_NOT_FOUND', 'School not found');
  const message = (typeof body?.message === 'string' && body.message.trim())
    ? body.message.trim().slice(0, MAX_MESSAGE_LEN)
    : DEFAULT_EMERGENCY_MESSAGE;

  // The school-wide banner first: it is what every open app shows, so it must
  // exist even if every individual email below fails.
  await sr.entities.Notice.create({
    school_id: schoolId,
    scope: 'SCHOOL',
    title: '🚨 ALERTA DE EMERGENCIA',
    content: message,
    priority: 'URGENT',
    is_emergency: true,
    author_id: user.id,
    sent_at: new Date().toISOString(),
  });

  const profiles: Any[] = await sr.entities.UserProfile.filter({ school_id: schoolId, status: 'ACTIVE' }, undefined, MAX_RECIPIENTS);
  const targets = profiles.filter((p) => ['PARENT', 'TEACHER'].includes(String(p.app_role)));
  const users = await usersByIds(sr, targets.map((p) => String(p.user_id)));
  const ctx: Ctx = { schoolName: String(school.name || ''), message };
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  for (const p of targets) {
    const u = users.get(String(p.user_id));
    const id = String(p.user_id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    recipients.push({ key: u?.email || id, userId: id, email: u?.email, role: p.app_role, prefs: p.notification_preferences, ctx });
  }

  return {
    schoolId,
    eventType: 'emergency_alert',
    schoolPrefs: school.notification_preferences,
    // A family must not be able to mute an emergency — the only notification
    // that ignores preferences.
    forceOn: true,
    priority: 'URGENT',
    recipients,
    finalize: async (_delivered, summary) => {
      await sr.entities.AuditLog.create({
        school_id: schoolId,
        user_id: user.id,
        user_email: user.email,
        action: 'EMERGENCY_ALERT',
        target_type: 'Notice',
        details: { message, total: summary.total, reached: summary.reached, email_failed: summary.emailFailed },
      }).catch(() => null);
    },
  };
}

async function parentRecipientsForStudent(sr: Any, schoolId: string, studentId: string, ctx: Ctx): Promise<Recipient[]> {
  const links: Any[] = await sr.entities.ParentStudent.filter({ student_id: studentId, status: 'ACTIVE' });
  const parentIds = [...new Set(links.map((l) => String(l.parent_id || '')).filter(Boolean))];
  const users = await usersByIds(sr, parentIds);
  const profiles: Any[] = parentIds.length
    ? await sr.entities.UserProfile.filter({ school_id: schoolId, user_id: { $in: parentIds } }).catch(() => [])
    : [];
  return parentIds.map((id) => {
    const u = users.get(id);
    const profile = profiles.find((p) => String(p.user_id) === id);
    return { key: u?.email || id, userId: id, email: u?.email, role: 'PARENT', prefs: profile?.notification_preferences, ctx };
  });
}

async function planPaymentDue(sr: Any, user: Any, body: Any): Promise<Plan | { skipped: string }> {
  const chargeId = String(body?.chargeId || '');
  if (!chargeId) throw new HttpError(400, 'MISSING_CHARGE', 'chargeId is required');
  const charge: Any = await sr.entities.ChargeItem.get(chargeId).catch(() => null);
  if (!charge?.school_id) throw new HttpError(404, 'NOT_FOUND', 'Charge not found');
  await requireActiveAdmin(sr, user, charge.school_id);
  if (charge.reminder_sent) return { skipped: 'already_sent' };
  if (!['PENDING', 'OVERDUE'].includes(String(charge.status))) return { skipped: 'not_pending' };

  const student: Any = await sr.entities.Student.get(charge.student_id).catch(() => null);
  const school: Any = await sr.entities.School.get(charge.school_id).catch(() => null);
  const ctx: Ctx = {
    studentName: student ? `${student.first_name || ''} ${student.last_name || ''}`.trim() : 'su hijo(a)',
    conceptName: String(charge.concept_name || ''),
    amountLabel: moneyLabel(charge.amount),
    dueDateLabel: spanishDate(charge.due_date),
  };
  const recipients = student ? await parentRecipientsForStudent(sr, charge.school_id, student.id, ctx) : [];
  return {
    schoolId: charge.school_id,
    eventType: 'payment_due',
    schoolPrefs: school?.notification_preferences,
    recipients,
    finalize: async (_delivered, summary) => {
      // Mark it only if somebody got it (or there was nobody to tell): a pass
      // where every send failed stays retryable on the next load.
      if (summary.reached > 0 || summary.total === 0) {
        await sr.entities.ChargeItem.update(charge.id, { reminder_sent: true });
      }
    },
  };
}

async function planEventReminder(sr: Any, user: Any, body: Any): Promise<Plan | { skipped: string }> {
  const eventId = String(body?.eventId || '');
  if (!eventId) throw new HttpError(400, 'MISSING_EVENT', 'eventId is required');
  const event: Any = await sr.entities.Event.get(eventId).catch(() => null);
  if (!event?.school_id) throw new HttpError(404, 'NOT_FOUND', 'Event not found');
  await requireActiveAdmin(sr, user, event.school_id);
  if (!event.requires_confirmation) return { skipped: 'no_confirmation' };
  if (event.reminder_sent) return { skipped: 'already_sent' };

  const students: Any[] = event.scope === 'CLASSROOM'
    ? (event.classroom_id
      ? await sr.entities.Student.filter({ classroom_id: event.classroom_id, school_id: event.school_id, is_active: true }, undefined, MAX_RECIPIENTS)
      : [])
    : await sr.entities.Student.filter({ school_id: event.school_id, is_active: true }, undefined, MAX_RECIPIENTS);
  const studentById = new Map(students.map((s) => [String(s.id), s]));
  const studentIds = [...studentById.keys()];
  const links: Any[] = studentIds.length
    ? await sr.entities.ParentStudent.filter({ student_id: { $in: studentIds }, status: 'ACTIVE' }, undefined, MAX_RECIPIENTS)
    : [];
  const responses: Any[] = await sr.entities.EventResponse.filter({ event_id: event.id }, undefined, MAX_RECIPIENTS);
  const pending = selectNonResponders(
    links.map((l) => ({ parentId: String(l.parent_id || ''), studentId: String(l.student_id || '') })),
    responses,
  );
  const parentIds = pending.map((p) => p.parentId);
  const users = await usersByIds(sr, parentIds);
  const profiles: Any[] = parentIds.length
    ? await sr.entities.UserProfile.filter({ school_id: event.school_id, user_id: { $in: [...new Set(parentIds)] } }).catch(() => [])
    : [];
  const school: Any = await sr.entities.School.get(event.school_id).catch(() => null);

  const base = {
    eventTitle: String(event.title || ''),
    dateLabel: spanishDate(event.date),
    timeLabel: String(event.time || ''),
    locationLabel: String(event.location || ''),
    deadlineLabel: spanishDate(event.confirmation_deadline, false),
  };
  const recipients: Recipient[] = pending.map((pair) => {
    const u = users.get(pair.parentId);
    const s = studentById.get(pair.studentId);
    const profile = profiles.find((p) => String(p.user_id) === pair.parentId);
    return {
      // One parent with two children gets one reminder per child, as before.
      key: `${u?.email || pair.parentId}::${pair.studentId}`,
      userId: pair.parentId,
      email: u?.email,
      role: 'PARENT',
      prefs: profile?.notification_preferences,
      ctx: { ...base, studentName: s ? `${s.first_name || ''} ${s.last_name || ''}`.trim() : 'su hijo(a)' },
    };
  });

  return {
    schoolId: event.school_id,
    eventType: 'event_confirmation_reminder',
    schoolPrefs: school?.notification_preferences,
    recipients,
    finalize: async (_delivered, summary) => {
      if (summary.reached > 0 || summary.total === 0) {
        await sr.entities.Event.update(event.id, { reminder_sent: true });
      }
    },
  };
}

async function planEscalation(sr: Any, user: Any, body: Any): Promise<Plan | { skipped: string }> {
  const ticketId = String(body?.ticketId || '');
  if (!ticketId) throw new HttpError(400, 'MISSING_TICKET', 'ticketId is required');
  const ticket: Any = await sr.entities.SupportTicket.get(ticketId).catch(() => null);
  if (!ticket?.school_id) throw new HttpError(404, 'NOT_FOUND', 'Ticket not found');

  const isOwner = user.role === 'admin';
  const isRequester = String(ticket.requester_user_id || '') === String(user.id);
  let isSchoolAdmin = false;
  if (!isOwner) {
    const profiles: Any[] = await sr.entities.UserProfile.filter({ user_id: user.id, school_id: ticket.school_id });
    isSchoolAdmin = profiles.some((p) => p.app_role === 'ADMIN' && p.status === 'ACTIVE');
    const isActiveRequester = isRequester && profiles.some((p) => p.status === 'ACTIVE');
    if (!isSchoolAdmin && !isActiveRequester) {
      throw new HttpError(403, 'FORBIDDEN', 'Only the requester or an admin of the ticket\'s school may notify it');
    }
  }

  // Rate limit the requester path: how many of their own tickets opened in
  // the last 24 h. An admin escalating to soporte is bounded by the
  // once-per-(ticket, tier, recipient) key instead.
  if (!isOwner && !isSchoolAdmin) {
    const recent: Any[] = await sr.entities.SupportTicket.filter({ requester_user_id: user.id }, '-created_date', ESCALATION_TICKETS_PER_DAY + 5);
    if (countWithinWindow(recent.map((t) => t.created_date), new Date(), DAY_MS) > ESCALATION_TICKETS_PER_DAY) {
      throw new HttpError(429, 'RATE_LIMITED', 'Too many tickets in the last 24 hours');
    }
  }

  const tier = String(ticket.tier || 'SCHOOL_ADMIN');
  const already: string[] = Array.isArray(ticket.escalation_notified_recipients) ? ticket.escalation_notified_recipients : [];

  // The description is read from the ticket's own thread, never the request:
  // the hand-off note for a soporte escalation, otherwise what the requester wrote.
  const messages: Any[] = await sr.entities.SupportTicketMessage.filter({ ticket_id: ticket.id }, 'created_date', 50).catch(() => []);
  const systemNotes = messages.filter((m) => m.author_role === 'SYSTEM');
  const requesterMsg = messages.find((m) => m.author_role === 'REQUESTER');
  const descriptionSource = tier === 'PLATFORM' && systemNotes.length ? systemNotes[systemNotes.length - 1] : requesterMsg;
  const ctx: Ctx = {
    ticketNumber: String(ticket.ticket_number || ''),
    subjectText: String(ticket.subject || '').slice(0, 300),
    requesterName: String(ticket.requester_name || 'Usuario'),
    categoryLabel: CATEGORY_LABELS_ES[String(ticket.category)] || String(ticket.category || ''),
    priorityLabel: PRIORITY_LABELS_ES[String(ticket.priority)] || String(ticket.priority || ''),
    slaDateLabel: ticket.sla_due_at
      ? new Date(ticket.sla_due_at).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })
      : 'N/D',
    description: String(descriptionSource?.body || '').slice(0, MAX_DESCRIPTION_LEN),
  };

  const assigneeProfiles: Any[] = tier === 'PLATFORM'
    ? await sr.entities.UserProfile.filter({ is_super_admin: true })
    : await sr.entities.UserProfile.filter({ school_id: ticket.school_id, app_role: 'ADMIN', status: 'ACTIVE' });
  const users = await usersByIds(sr, assigneeProfiles.map((p) => String(p.user_id)));
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  for (const p of assigneeProfiles) {
    const id = String(p.user_id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const u = users.get(id);
    recipients.push({ key: escalationKey(tier, u?.email || id), userId: id, email: u?.email, role: 'ADMIN', prefs: p.notification_preferences, ctx });
  }
  // Tier-2 always reaches the fixed inbox, even when no owner profile exists.
  if (tier === 'PLATFORM' && !recipients.some((r) => String(r.email || '').toLowerCase() === SUPPORT_EMAIL)) {
    recipients.push({ key: escalationKey(tier, SUPPORT_EMAIL), email: SUPPORT_EMAIL, role: 'ADMIN', ctx });
  }
  const fresh = recipients.filter((r) => !already.includes(r.key));
  if (fresh.length === 0) return { skipped: 'already_notified' };

  return {
    schoolId: ticket.school_id,
    eventType: 'support_ticket_escalated',
    priority: String(ticket.priority || 'NORMAL'),
    recipients: fresh,
    finalize: async (delivered) => {
      if (delivered.length === 0) return;
      await sr.entities.SupportTicket.update(ticket.id, {
        escalation_notified_recipients: [...already, ...delivered.map((r) => r.key)],
      });
    },
  };
}

const PLANNERS: Record<string, (sr: Any, user: Any, body: Any) => Promise<Plan | { skipped: string }>> = {
  emergency_alert: planEmergency,
  payment_due: planPaymentDue,
  event_confirmation_reminder: planEventReminder,
  support_ticket_escalated: planEscalation,
};

// ---------------------------------------------------------------------------

async function deliver(sr: Any, user: Any, plan: Plan): Promise<Summary> {
  const emailTemplate = NOTIFICATION_TEMPLATES[plan.eventType];
  const inAppTemplate = IN_APP_TEMPLATES[plan.eventType];
  const recipients = plan.recipients.slice(0, MAX_RECIPIENTS);

  const results = await mapWithConcurrency(recipients, CONCURRENCY, async (r) => {
    const channel = (name: string) => isChannelEnabled({
      schoolPrefs: plan.schoolPrefs, userPrefs: r.prefs, channel: name, role: r.role, forceOn: plan.forceOn,
    });
    const out = { email: 'skip', inApp: 'skip' } as Record<string, string>;
    if (r.email && channel('email')) {
      try {
        await withRetry(() => sr.integrations.Core.SendEmail({
          to: r.email,
          subject: emailTemplate.subject(r.ctx),
          body: emailTemplate.emailBody(r.ctx),
        }));
        out.email = 'ok';
      } catch (error) {
        out.email = 'fail';
        out.emailError = String((error as Error)?.message || error);
      }
    }
    if (r.userId && channel('in_app')) {
      try {
        await withRetry(() => sr.entities.Notice.create({
          school_id: plan.schoolId,
          scope: 'USER',
          user_id: r.userId,
          title: inAppTemplate.title(r.ctx),
          content: inAppTemplate.content(r.ctx),
          priority: plan.priority || 'NORMAL',
          sent_at: new Date().toISOString(),
        }));
        out.inApp = 'ok';
      } catch {
        out.inApp = 'fail';
      }
    }
    return out;
  });

  const summary: Summary = { total: recipients.length, reached: 0, emailed: 0, emailFailed: 0, inApp: 0, inAppFailed: 0, noChannel: 0 };
  const delivered: Recipient[] = [];
  const failures: Array<{ key: string; error: string }> = [];
  results.forEach((res, i) => {
    const r = recipients[i];
    const out = res.ok ? res.value : { email: 'fail', inApp: 'fail', emailError: res.error };
    if (out.email === 'ok') summary.emailed += 1;
    if (out.email === 'fail') { summary.emailFailed += 1; failures.push({ key: r.key, error: out.emailError || 'email' }); }
    if (out.inApp === 'ok') summary.inApp += 1;
    if (out.inApp === 'fail') summary.inAppFailed += 1;
    if (out.email === 'ok' || out.inApp === 'ok') { summary.reached += 1; delivered.push(r); }
    if (out.email === 'skip' && out.inApp === 'skip') summary.noChannel += 1;
  });

  if (failures.length) {
    // One row for the whole pass, not one per failure: an outage must not
    // multiply into hundreds of audit writes.
    await sr.entities.AuditLog.create({
      school_id: plan.schoolId,
      user_id: user.id,
      action: 'NOTIFICATION_DELIVERY_FAILED',
      target_type: plan.eventType,
      target_id: 'bulk',
      details: { failed: failures.length, total: summary.total, sample: failures.slice(0, 20) },
    }).catch(() => null);
  }

  if (plan.finalize) await plan.finalize(delivered, summary);
  return summary;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return bad(401, 'UNAUTHENTICATED', 'Unauthorized');

    const body = await req.json().catch(() => ({}));
    const eventType = String(body?.eventType || '');
    const planner = PLANNERS[eventType];
    if (!planner) return bad(400, 'UNKNOWN_EVENT', 'Unknown eventType');

    const sr = base44.asServiceRole;
    const plan = await planner(sr, user, body);
    if ('skipped' in plan) return Response.json({ ok: true, eventType, skipped: true, reason: plan.skipped, total: 0, reached: 0 });

    const summary = await deliver(sr, user, plan);
    return Response.json({ ok: true, eventType, ...summary });
  } catch (e) {
    if (e instanceof HttpError) return bad(e.status, e.code, e.message);
    return Response.json({ ok: false, code: 'INTERNAL', error: (e as Error).message }, { status: 500 });
  }
});
