// sendNotificationEmail — server-authoritative sender for every templated
// transactional email in the app (new-user-pending, payment-due, event
// confirmation reminders, emergency alerts, and the three support-ticket
// lifecycle emails).
//
// WHY THIS EXISTS (Base44 security scan, "Evitar el uso no autorizado de
// créditos", High). base44.integrations.Core.SendEmail is a credit-consuming
// integration. src/lib/notifications/service.js used to call it directly
// from the browser with a client-built subject/body/recipient — anyone
// holding a valid token could invoke it with arbitrary content to an
// arbitrary address and burn credits (or run a free mail relay) with no
// server-side check at all. This function is now the only caller of
// SendEmail for this path: the client sends an `eventType` + a plain-value
// `templateContext`, and BOTH the subject/body (via `_templates.ts`, the
// server-side mirror of templates.js's subject/emailBody) and the recipient
// address are validated/derived here — nothing in the request body reaches
// the outgoing message unchecked.
//
// Authority model, in order:
//   1. Caller must be authenticated.
//   2. Caller must have a UserProfile in `schoolId` (platform owner —
//      user.role === 'admin' — bypasses this, same convention as every other
//      function in this app). Status must be ACTIVE, except `new_user_pending`,
//      where PENDING is also allowed: that's the one event a *self-registering*
//      user triggers, to notify the school's admins of their own pending
//      approval — they have no ACTIVE profile yet by definition.
//   3. The caller's `app_role` must be allowed to trigger this eventType
//      (CALLER_ROLES below).
//   4. The recipient email must resolve to either the fixed Tier-2 support
//      inbox (only for `support_ticket_escalated`) or a real User who has a
//      UserProfile in `schoolId`, whose `app_role` is allowed to RECEIVE this
//      eventType (RECIPIENT_ROLES below). Any other address is rejected — the
//      whole point is that a client can't turn this into a relay to an
//      address of its choosing.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';
import { NOTIFICATION_TEMPLATES } from './_templates.ts';

const SUPPORT_EMAIL = 'soporte@acaciaco.com.mx';
const MAX_CONTEXT_STRING_LEN = 4000;

// Which caller app_role(s) may trigger each event. `null` = any role (still
// requires an ACTIVE — or, for new_user_pending, PENDING — UserProfile, or
// the platform-owner bypass).
const CALLER_ROLES: Record<string, string[] | null> = {
  new_user_pending: null,
  payment_due: ['ADMIN'],
  event_confirmation_reminder: ['ADMIN'],
  emergency_alert: ['ADMIN'],
  support_ticket_escalated: null,
  support_ticket_reply: ['ADMIN'],
  support_ticket_resolved: ['ADMIN'],
};

// Which app_role(s) the RECIPIENT must have. `null` = any role, as long as
// they have a UserProfile in schoolId at all.
const RECIPIENT_ROLES: Record<string, string[] | null> = {
  new_user_pending: ['ADMIN'],
  payment_due: ['PARENT'],
  event_confirmation_reminder: ['PARENT'],
  emergency_alert: null,
  support_ticket_escalated: ['ADMIN'],
  support_ticket_reply: null,
  support_ticket_resolved: null,
};

function bad(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, code, error: message }, { status });
}

// Only plain string/number values survive into the rendered email — an
// object, array, or function in templateContext is silently dropped rather
// than reaching a template's interpolation. Strings are capped so a caller
// can't ask this function to send a multi-megabyte email.
// deno-lint-ignore no-explicit-any
function sanitizeContext(raw: any): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      out[key] = value.slice(0, MAX_CONTEXT_STRING_LEN);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    }
    // booleans/null/objects/arrays: dropped, not passed to the template.
  }
  return out;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return bad(401, 'UNAUTHENTICATED', 'Unauthorized');

    const body = await req.json().catch(() => ({}));
    const eventType = String(body?.eventType || '');
    const schoolId = String(body?.schoolId || '');
    const email = String(body?.email || '').trim().toLowerCase();
    const template = NOTIFICATION_TEMPLATES[eventType];
    if (!template) return bad(400, 'UNKNOWN_EVENT', 'Unknown eventType');
    if (!schoolId) return bad(400, 'MISSING_SCHOOL', 'schoolId is required');
    if (!email) return bad(400, 'MISSING_EMAIL', 'email is required');

    const sr = base44.asServiceRole;
    const isPlatformOwner = user.role === 'admin';

    if (!isPlatformOwner) {
      const profiles = await sr.entities.UserProfile.filter({ user_id: user.id, school_id: schoolId });
      const allowedStatuses = eventType === 'new_user_pending' ? ['ACTIVE', 'PENDING'] : ['ACTIVE'];
      const callerProfile = profiles.find((p: { status?: string }) => allowedStatuses.includes(String(p.status))) || null;
      if (!callerProfile) return bad(403, 'NO_PROFILE', 'No qualifying profile in this school');

      const allowedCallerRoles = CALLER_ROLES[eventType];
      if (allowedCallerRoles && !allowedCallerRoles.includes(String((callerProfile as { app_role?: string }).app_role))) {
        return bad(403, 'FORBIDDEN', 'Not permitted to trigger this notification');
      }
    }

    // Recipient authorization — never trust the caller's claim about who this
    // email is "for"; re-derive it from the address itself.
    if (email === SUPPORT_EMAIL) {
      if (eventType !== 'support_ticket_escalated') {
        return bad(403, 'BAD_RECIPIENT', 'This event may not email the support inbox');
      }
    } else {
      // Stored emails may carry the casing the user typed at signup; try the
      // address as sent first, then lowercased.
      const rawEmail = String(body?.email || '').trim();
      let users = await sr.entities.User.filter({ email: rawEmail });
      if (!users?.length && rawEmail !== email) users = await sr.entities.User.filter({ email });
      const recipientUser = users?.[0] || null;
      if (!recipientUser) return bad(403, 'BAD_RECIPIENT', 'Recipient is not a known user');
      const recipientProfiles = await sr.entities.UserProfile.filter({ user_id: recipientUser.id, school_id: schoolId });
      const allowedRecipientRoles = RECIPIENT_ROLES[eventType];
      let recipientProfile = allowedRecipientRoles
        ? recipientProfiles.find((p: { app_role?: string }) => allowedRecipientRoles.includes(String(p.app_role)))
        : recipientProfiles[0];
      // Tier-2 escalations go to the platform owners (tickets.js's
      // resolveAssigneeRecipients: UserProfile.is_super_admin), who normally
      // have no profile in the ticket's school.
      if (!recipientProfile && eventType === 'support_ticket_escalated') {
        const ownerProfiles = await sr.entities.UserProfile.filter({ user_id: recipientUser.id, is_super_admin: true });
        recipientProfile = ownerProfiles?.[0] || (recipientUser.role === 'admin' ? recipientUser : null);
      }
      if (!recipientProfile) return bad(403, 'BAD_RECIPIENT', 'Recipient has no qualifying profile in this school');
    }

    const templateContext = sanitizeContext(body?.templateContext);
    const subject = template.subject(templateContext);
    const emailBody = template.emailBody(templateContext);

    await sr.integrations.Core.SendEmail({ to: email, subject, body: emailBody });

    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, code: 'INTERNAL', error: (e as Error).message }, { status: 500 });
  }
});
