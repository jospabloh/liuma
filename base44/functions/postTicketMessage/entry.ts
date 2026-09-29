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
import { MAX_BODY, decideTicketAuthor } from './_policy.ts';

function bad(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, code, error: message }, { status });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return bad(401, 'UNAUTHENTICATED', 'Unauthorized');

    const body = await req.json().catch(() => ({}));
    const ticketId = String(body?.ticketId || '');
    const kind = String(body?.kind || 'reply');
    const text = typeof body?.body === 'string' ? body.body.trim() : '';
    if (!ticketId) return bad(400, 'MISSING_TICKET', 'ticketId is required');
    if (!text) return bad(400, 'EMPTY_BODY', 'body is required');
    if (text.length > MAX_BODY) return bad(400, 'BODY_TOO_LONG', `body exceeds ${MAX_BODY} characters`);

    const sr = base44.asServiceRole;
    const ticket: Record<string, unknown> | null = await sr.entities.SupportTicket.get(ticketId).catch(() => null);
    if (!ticket) return bad(404, 'NOT_FOUND', 'Ticket not found');
    const schoolId = String(ticket.school_id || '');

    const isPlatformOwner = user.role === 'admin';
    const isRequester = String(ticket.requester_user_id || '') === String(user.id);
    let isSchoolAdmin = false;
    // A 'note' needs staff standing even from the requester (a director
    // moving a ticket they filed themselves), so look it up in that case too.
    if (!isPlatformOwner && schoolId && (!isRequester || kind === 'note')) {
      const profiles: Array<{ app_role?: string; status?: string }> = await sr.entities.UserProfile.filter({
        user_id: user.id,
        school_id: schoolId,
      });
      isSchoolAdmin = profiles.some((p) => p.app_role === 'ADMIN' && p.status === 'ACTIVE');
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
    return Response.json({ ok: false, code: 'INTERNAL', error: (e as Error).message }, { status: 500 });
  }
});
