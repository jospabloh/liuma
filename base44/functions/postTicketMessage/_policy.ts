// Pure rule for postTicketMessage — no Deno globals, no SDK, no imports, so
// node --test (tests/unit/post-ticket-message.test.js) loads this same file.
//
// Before P7 the client chose `author_role` itself, so a parent could post
// into a ticket thread as 'SCHOOL_ADMIN' or 'OWNER' — impersonating the
// director inside a thread Mission Control's support desk also reads. The
// role is now derived here from who the caller actually is.

export const MESSAGE_KINDS = ['reply', 'note', 'ai_summary'];
export const MAX_BODY = 10000;

export type AuthorDecision =
  | { ok: true; authorRole: string; attributeToCaller: boolean }
  | { ok: false; code: string; message: string };

/**
 * kind:
 *  - 'reply'      a message typed by the caller;
 *  - 'note'       a status/escalation note written by staff (shown as SYSTEM);
 *  - 'ai_summary' the Lumi attempt that preceded the ticket, posted once by
 *                 the requester right after creating it (shown as AI).
 *
 * The requester is always REQUESTER in their own ticket, even if they are
 * also staff — the platform owner filing a ticket is a requester there.
 */
export function decideTicketAuthor(input: {
  kind: string;
  isRequester: boolean;
  isPlatformOwner: boolean;
  isSchoolAdmin: boolean;
  aiAttempted: boolean;
  hasAiMessage: boolean;
}): AuthorDecision {
  const { kind, isRequester, isPlatformOwner, isSchoolAdmin } = input;
  if (!MESSAGE_KINDS.includes(kind)) return { ok: false, code: 'BAD_KIND', message: 'Unsupported message kind' };

  if (kind === 'ai_summary') {
    if (!isRequester) return { ok: false, code: 'FORBIDDEN', message: 'Only the requester may attach the Lumi summary' };
    if (!input.aiAttempted || input.hasAiMessage) {
      return { ok: false, code: 'AI_SUMMARY_NOT_ALLOWED', message: 'This ticket has no pending Lumi summary' };
    }
    // Attributed to the requester who posted it: SupportTicketMessage.read
    // keys on data.author_user_id (a service-role create has no useful
    // created_by_id), so a null author would hide the summary from the very
    // person whose ticket it is. author_role still says it was Lumi.
    return { ok: true, authorRole: 'AI', attributeToCaller: true };
  }

  const isStaff = isPlatformOwner || isSchoolAdmin;
  if (kind === 'note') {
    if (!isStaff) return { ok: false, code: 'FORBIDDEN', message: 'Only support staff may add a note' };
    return { ok: true, authorRole: 'SYSTEM', attributeToCaller: true };
  }

  // reply
  if (isRequester) return { ok: true, authorRole: 'REQUESTER', attributeToCaller: true };
  if (isPlatformOwner) return { ok: true, authorRole: 'OWNER', attributeToCaller: true };
  if (isSchoolAdmin) return { ok: true, authorRole: 'SCHOOL_ADMIN', attributeToCaller: true };
  return { ok: false, code: 'FORBIDDEN', message: 'You are not part of this ticket' };
}
