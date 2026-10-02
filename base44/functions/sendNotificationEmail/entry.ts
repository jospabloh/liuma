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
//      where PENDING is REQUIRED instead: that's the one event a
//      *self-registering* user triggers, to notify the school's admins of
//      their own pending approval — they have no ACTIVE profile yet by
//      definition, and an already-ACTIVE profile has nothing pending to
//      report. `new_user_pending` additionally re-derives userName/userEmail/
//      roleName from the caller's own identity (never templateContext) and
//      is idempotent PER RECIPIENT (UserProfile.pending_notification_recipients)
//      — 2026-09-28, Base44 security scan; per-recipient rather than a
//      single flag per a same-day Codex review catching that a school with
//      several admins would otherwise only notify the first one.
//   3. The caller's `app_role` must be allowed to trigger this eventType
//      (CALLER_ROLES below).
//   4. The recipient email must resolve to a real User who has a
//      UserProfile in `schoolId`, whose `app_role` is allowed to RECEIVE this
//      eventType (RECIPIENT_ROLES below). Any other address is rejected — the
//      whole point is that a client can't turn this into a relay to an
//      address of its choosing.
//
// `support_ticket_escalated` is NOT sent from here any more (2026-09-29,
// sales-readiness audit F30): this path let any ACTIVE user email the
// support inbox or their school's admins any number of times with free-text
// fields of their own. It now goes through sendBulkNotification, keyed on a
// stored SupportTicket id, once per (ticket, tier, recipient) and rate
// limited per requester. A call for it here is refused with MOVED so an old
// client can't keep using the unbounded path.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';
import { NOTIFICATION_TEMPLATES } from './_templates.ts';

// Accepting the current Aviso de Privacidad and Términos is mandatory to use
// LIUMA (v1.9.0). MIRRORS schoolRead/_scope.ts#profileConsentIsCurrent and
// src/lib/consent/privacyNotice.js; tests/unit/consent-gate.test.js checks
// every copy of the versions.
const CONSENT_NOTICE_VERSION = '2026-10-02';
const CONSENT_TERMS_VERSION = '2026-10-02';
function profileConsentIsCurrent(profile: { consent_notice_version?: unknown; consent_terms_version?: unknown } | null): boolean {
  return Boolean(profile)
    && profile!.consent_notice_version === CONSENT_NOTICE_VERSION
    && profile!.consent_terms_version === CONSENT_TERMS_VERSION;
}

// Events that fan out server-side in sendBulkNotification and must not be
// sent one address at a time from here. emergency_alert / reminders stay
// accepted for now: they are ADMIN-only and recipient-checked, and refusing
// them before the new site is deployed would take the emergency alert down
// in the gap between `npm run deploy` and `npm run deploy:site`.
const BULK_ONLY_EVENTS = ['support_ticket_escalated'];
const MAX_CONTEXT_STRING_LEN = 4000;

// Mirrors onboardingTenantCreation.js's own roleNames map — the label shown
// to admins for a pending signup's role. Kept server-side and NOT trusted
// from templateContext.roleName (same reasoning as userName/userEmail
// below): a self-registering caller could otherwise claim any role label.
const PENDING_ROLE_LABELS_ES: Record<string, string> = {
  TEACHER: 'Maestro/a',
  PARENT: 'Padre/Madre',
  ADMIN: 'Administrador/a',
};

// Which caller app_role(s) may trigger each event. `null` = any role (still
// requires an ACTIVE — or, for new_user_pending, PENDING — UserProfile, or
// the platform-owner bypass).
const CALLER_ROLES: Record<string, string[] | null> = {
  new_user_pending: null,
  payment_due: ['ADMIN'],
  event_confirmation_reminder: ['ADMIN'],
  emergency_alert: ['ADMIN'],
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
    // A deletion of this account started or finished (deleteMyAccount): no
    // access here, whatever consent stamp a race may have left behind.
    // auth.me() returns the User's custom fields, so this costs no read.
    if (accountDeletionBlocked(user)) return Response.json({ ok: false, code: 'ACCOUNT_DELETION_IN_PROGRESS', error: 'ACCOUNT_DELETION_IN_PROGRESS' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const eventType = String(body?.eventType || '');
    const schoolId = String(body?.schoolId || '');
    const email = String(body?.email || '').trim().toLowerCase();
    if (BULK_ONLY_EVENTS.includes(eventType)) {
      return bad(410, 'MOVED', 'This notification is sent by sendBulkNotification');
    }
    const template = NOTIFICATION_TEMPLATES[eventType];
    if (!template || !(eventType in CALLER_ROLES)) return bad(400, 'UNKNOWN_EVENT', 'Unknown eventType');
    if (!schoolId) return bad(400, 'MISSING_SCHOOL', 'schoolId is required');
    if (!email) return bad(400, 'MISSING_EMAIL', 'email is required');

    const sr = base44.asServiceRole;
    const isPlatformOwner = user.role === 'admin';

    type CallerProfileRecord = { id?: string; status?: string; app_role?: string; pending_notification_recipients?: string[] };
    let callerProfileRecord: CallerProfileRecord | null = null;
    if (!isPlatformOwner) {
      const profiles = await sr.entities.UserProfile.filter({ user_id: user.id, school_id: schoolId });
      // new_user_pending is a self-registration notice: it only makes sense
      // for the one profile that IS pending, never for someone with an
      // already-ACTIVE profile notifying about themselves.
      const allowedStatuses = eventType === 'new_user_pending' ? ['PENDING'] : ['ACTIVE'];
      const callerProfile = profiles.find((p: { status?: string }) => allowedStatuses.includes(String(p.status))) || null;
      if (!callerProfile) return bad(403, 'NO_PROFILE', 'No qualifying profile in this school');
      // new_user_pending comes right after onboarding, which stamps the
      // profile; every event here mails other people's data (v1.9.0).
      if (!profileConsentIsCurrent(callerProfile)) return bad(403, 'CONSENT_REQUIRED', 'Accept the current privacy notice first');
      callerProfileRecord = callerProfile as CallerProfileRecord;

      const allowedCallerRoles = CALLER_ROLES[eventType];
      if (allowedCallerRoles && !allowedCallerRoles.includes(String((callerProfile as { app_role?: string }).app_role))) {
        return bad(403, 'FORBIDDEN', 'Not permitted to trigger this notification');
      }
    }

    // new_user_pending-specific hardening (Base44 security scan, 2026-09-28,
    // corrected same day per a Codex review on the fix's own PR). The only
    // legitimate caller (onboardingTenantCreation.js) always sends the
    // caller's OWN name/email as templateContext.userName/userEmail — never
    // trust those strings as free text, or a self-registering user could
    // phish the school's admins with an arbitrary display name/address.
    //
    // Idempotency is tracked PER RECIPIENT (pending_notification_recipients,
    // an array on the pending user's own UserProfile), not a single
    // sent/not-sent flag: a school can have several ACTIVE admins, and
    // sendByEvent (src/lib/notifications/service.js) calls this function
    // once per recipient. A single boolean would let the first successful
    // send block every later admin in the same fan-out from ever being
    // notified — the array lets each admin be notified exactly once, and
    // still blocks an outright replay of an admin who already got the mail.
    const notifiedRecipients: string[] = Array.isArray(callerProfileRecord?.pending_notification_recipients)
      ? callerProfileRecord!.pending_notification_recipients!
      : [];
    if (eventType === 'new_user_pending' && !isPlatformOwner) {
      if (notifiedRecipients.includes(email)) {
        return Response.json({ ok: true, skipped: true, reason: 'already_notified' });
      }
      const ctx = body?.templateContext;
      const claimedName = typeof ctx?.userName === 'string' ? ctx.userName : '';
      const claimedEmail = typeof ctx?.userEmail === 'string' ? ctx.userEmail.trim().toLowerCase() : '';
      if (claimedName !== String(user.full_name || '') || claimedEmail !== String(user.email || '').trim().toLowerCase()) {
        return bad(403, 'CONTEXT_MISMATCH', 'templateContext.userName/userEmail must match the caller');
      }
    }

    // Recipient authorization — never trust the caller's claim about who this
    // email is "for"; re-derive it from the address itself.
    {
      // Stored emails may carry the casing the user typed at signup; try the
      // address as sent first, then lowercased.
      const rawEmail = String(body?.email || '').trim();
      let users = await sr.entities.User.filter({ email: rawEmail });
      if (!users?.length && rawEmail !== email) users = await sr.entities.User.filter({ email });
      const recipientUser = users?.[0] || null;
      if (!recipientUser) return bad(403, 'BAD_RECIPIENT', 'Recipient is not a known user');
      const recipientProfiles = await sr.entities.UserProfile.filter({ user_id: recipientUser.id, school_id: schoolId });
      const allowedRecipientRoles = RECIPIENT_ROLES[eventType];
      const recipientProfile = allowedRecipientRoles
        ? recipientProfiles.find((p: { app_role?: string }) => allowedRecipientRoles.includes(String(p.app_role)))
        : recipientProfiles[0];
      if (!recipientProfile) return bad(403, 'BAD_RECIPIENT', 'Recipient has no qualifying profile in this school');
    }

    const templateContext = sanitizeContext(body?.templateContext);
    if (eventType === 'new_user_pending') {
      // Never the client's claimed label — derive it from the caller's own
      // (already-verified-PENDING) app_role.
      templateContext.roleName = PENDING_ROLE_LABELS_ES[String(callerProfileRecord?.app_role)] || 'Usuario';
    }
    const subject = template.subject(templateContext);
    const emailBody = template.emailBody(templateContext);

    await sr.integrations.Core.SendEmail({ to: email, subject, body: emailBody });

    if (eventType === 'new_user_pending' && callerProfileRecord?.id) {
      await sr.entities.UserProfile.update(callerProfileRecord.id, {
        pending_notification_recipients: [...notifiedRecipients, email],
      });
    }

    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, code: 'INTERNAL', error: (e as Error).message }, { status: 500 });
  }
});

// MIRRORS myConsent/_consent.ts#accountDeletionStartedAt/accountDeletedAt.
// Identical in every consent-gated function; tests/unit/account-deletion.test.js
// checks the copies and where each one is called.
function accountDeletionBlocked(user: unknown): boolean {
  const u = (user ?? {}) as {
    account_deletion_started_at?: unknown;
    account_deleted_at?: unknown;
    data?: { account_deletion_started_at?: unknown; account_deleted_at?: unknown } | null;
  };
  const started = u.account_deletion_started_at ?? u.data?.account_deletion_started_at;
  const deleted = u.account_deleted_at ?? u.data?.account_deleted_at;
  return (typeof started === 'string' && started !== '') || (typeof deleted === 'string' && deleted !== '');
}
