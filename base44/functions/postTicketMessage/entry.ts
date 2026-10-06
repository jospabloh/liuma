// postTicketMessage — the only write path for SupportTicketMessage.
//
// WHY THIS EXISTS (P7, 2026-09-29 — Base44 scan fingerprint efa41dd4)
// SupportTicketMessage's create RLS checked only author_user_id == caller,
// so the client picked author_role, ticket_id and school_id freely: a parent
// could reply to any ticket whose id they knew, posing as 'SCHOOL_ADMIN' or
// 'OWNER'. Create is now service-role only, and this function:
//
//   - re-reads the ticket (school and requester come from it, not the body);
//   - lets in only the requester, the platform owner, or an ACTIVE ADMIN of
//     the ticket's school;
//   - derives author_role from which of those the caller is (./_policy.ts).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';
import { withDeletionGuard } from './_deletionGuard.ts';
import { MAX_BODY, decideTicketAuthor } from './_policy.ts';

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

function bad(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, code, error: message }, { status });
}

Deno.serve(withDeletionGuard(async (req, guarded) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return bad(401, 'UNAUTHENTICATED', 'Unauthorized');
    // A deletion of this account started or finished (deleteMyAccount): no
    // access here, whatever consent stamp a race may have left behind.
    // auth.me() returns the User's custom fields, so this costs no read.
    if (accountDeletionBlocked(user)) return Response.json({ ok: false, code: 'ACCOUNT_DELETION_IN_PROGRESS', error: 'ACCOUNT_DELETION_IN_PROGRESS' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const ticketId = String(body?.ticketId || '');
    const kind = String(body?.kind || 'reply');
    const text = typeof body?.body === 'string' ? body.body.trim() : '';
    if (!ticketId) return bad(400, 'MISSING_TICKET', 'ticketId is required');
    if (!text) return bad(400, 'EMPTY_BODY', 'body is required');
    if (text.length > MAX_BODY) return bad(400, 'BODY_TOO_LONG', `body exceeds ${MAX_BODY} characters`);

    // Every write checked against a concurrent deletion (./_deletionGuard.ts).
    const sr = guarded(base44.asServiceRole, String(user.id));
    const ticket: Record<string, unknown> | null = await sr.entities.SupportTicket.get(ticketId).catch(() => null);
    if (!ticket) return bad(404, 'NOT_FOUND', 'Ticket not found');
    const schoolId = String(ticket.school_id || '');

    const isPlatformOwner = user.role === 'admin';
    const isRequester = String(ticket.requester_user_id || '') === String(user.id);
    let isSchoolAdmin = false;
    // A 'note' needs staff standing even from the requester (a director
    // moving a ticket they filed themselves), so look it up in that case too.
    if (!isPlatformOwner && schoolId && (!isRequester || kind === 'note')) {
      const profiles: Array<{ app_role?: string; status?: string; consent_notice_version?: string; consent_terms_version?: string }> = await sr.entities.UserProfile.filter({
        user_id: user.id,
        school_id: schoolId,
      });
      // Staff standing needs the current consent (v1.9.0). The requester's own
      // replies do not: a ticket is how someone who declined asks for help
      // (guardedEntityWrite/_policy.ts#consentExempt).
      isSchoolAdmin = profiles.some((p) => p.app_role === 'ADMIN' && p.status === 'ACTIVE' && profileConsentIsCurrent(p));
    }

    let hasAiMessage = false;
    if (kind === 'ai_summary') {
      const aiMessages: unknown[] = await sr.entities.SupportTicketMessage.filter({ ticket_id: ticketId, author_role: 'AI' });
      hasAiMessage = aiMessages.length > 0;
    }

    const decision = decideTicketAuthor({
      kind,
      isRequester,
      isPlatformOwner,
      isSchoolAdmin,
      aiAttempted: ticket.ai_attempted === true,
      hasAiMessage,
    });
    if (!decision.ok) return bad(403, decision.code, decision.message);

    const message = await sr.entities.SupportTicketMessage.create({
      ticket_id: ticketId,
      school_id: schoolId,
      // Denormalized so the thread's read RLS can scope to the requester.
      requester_user_id: ticket.requester_user_id || null,
      author_user_id: decision.attributeToCaller ? user.id : null,
      author_role: decision.authorRole,
      body: text,
    });
    return Response.json({ ok: true, message });
  } catch (e) {
    // The detail goes to the log; a raw SDK error can name entities or ids.
    console.error('postTicketMessage failed', (e as Error)?.message);
    return Response.json({ ok: false, code: 'INTERNAL', error: 'INTERNAL' }, { status: 500 });
  }
}));

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
