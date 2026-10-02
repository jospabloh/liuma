// Pure rule for recordAuditEvent — no Deno globals, no SDK, no imports, so
// node --test (tests/unit/record-audit-event.test.js) loads this same file.
//
// Before P7 AuditLog create RLS was "data.user_id is you": anyone could write
// any action ('USER_APPROVED', 'ROLE_CHANGE', ...) into any school's log.
// Now the row's actor, e-mail and role come from the server, the caller must
// belong to the school, and an action may only be logged by a role that can
// actually perform it.

// Minimum standing per action.
//   ANY_PROFILE  any profile in the school, even PENDING (consent is given
//                during onboarding, before approval; a denied route is
//                logged for whoever hit it)
//   ACTIVE       an ACTIVE profile in the school
//   STAFF        ACTIVE ADMIN or TEACHER
//   ADMIN        ACTIVE ADMIN
//   SERVER       never from a client — written by backend functions only
export const ACTION_TIER: Record<string, string> = {
  PRIVACY_CONSENT_ACCEPTED: 'ANY_PROFILE',
  access_denied: 'ANY_PROFILE',
  // createSupportTicket / addSupportMessage await this row AFTER the ticket
  // or message exists, and postTicketMessage lets any requester write
  // (asking why one's approval is stuck is a real ticket). Refusing the audit
  // row would surface an error for a write that already happened and invite
  // a duplicate retry.
  SUPPORT_TICKET_CREATED: 'ANY_PROFILE',
  SUPPORT_TICKET_MESSAGE: 'ANY_PROFILE',

  POLICY_DECISION: 'ACTIVE',
  owner_override: 'ACTIVE',
  AI_REQUEST_ALLOWED: 'ACTIVE',
  AI_REQUEST_DENIED: 'ACTIVE',
  SUPPORT_TICKET_STATUS_CHANGE: 'ACTIVE',
  NOTIFICATION_DELIVERY_FAILED: 'ACTIVE',

  NOTICE_SENT: 'STAFF',
  DIARY_CREATED: 'STAFF',
  DIARY_SENT: 'STAFF',
  ATTENDANCE_BULK_PRESENT: 'STAFF',
  ATTENDANCE_CREATED: 'STAFF',
  ATTENDANCE_UPDATED: 'STAFF',

  USER_APPROVED: 'ADMIN',
  USER_SUSPENDED: 'ADMIN',
  PARENT_LINKED: 'ADMIN',
  PARENT_UNLINKED: 'ADMIN',
  PAYMENT_RECORDED: 'ADMIN',
  CHARGE_CREATED: 'ADMIN',
  EMERGENCY_ALERT: 'ADMIN',
  STUDENT_CREATED: 'ADMIN',
  CLASSROOM_CREATED: 'ADMIN',
  PERMISSION_CHANGE: 'ADMIN',
  ROLE_CHANGE: 'ADMIN',
  ROLE_CHANGE_REQUESTED: 'ADMIN',
  ROLE_CHANGE_REVIEW: 'ADMIN',
  ROLE_CHANGED_OWNER_BYPASS: 'ADMIN',
  LICENSE_UPDATED: 'ADMIN',
  THEME_CREATED_OR_UPDATED: 'ADMIN',

  RECORD_CREATED: 'SERVER',
  RECORD_UPDATED: 'SERVER',
  RECORD_DELETED: 'SERVER',
  // deleteMyAccount writes these (v1.9.0); a client claiming them would be
  // forging the evidence of a withdrawal.
  PRIVACY_CONSENT_WITHDRAWN: 'SERVER',
  ACCOUNT_DELETED: 'SERVER',
  // A write that landed during a deletion and could not be compensated
  // (_deletionGuard.ts), and an onboarding that raced a deletion and could
  // not undo itself (provisionOnboardingProfile): for the owner to fix.
  DELETION_STRAGGLER_UNRESOLVED: 'SERVER',
  ONBOARDING_COMPENSATION_UNRESOLVED: 'SERVER',
};

export const MAX_DETAILS_CHARS = 16000;

export type AuditDecision = { ok: true } | { ok: false; code: string; message: string };

/**
 * `profiles` are the caller's UserProfile rows IN THE TARGET SCHOOL (looked
 * up server-side). The platform owner may log any client action anywhere.
 */
export function decideAuditWrite(input: {
  action: string;
  isPlatformOwner: boolean;
  profiles: Array<{ app_role?: string; status?: string }>;
}): AuditDecision {
  const tier = ACTION_TIER[input.action];
  if (!tier) return { ok: false, code: 'UNKNOWN_ACTION', message: 'Unknown audit action' };
  if (tier === 'SERVER') return { ok: false, code: 'SERVER_ONLY_ACTION', message: 'This action is written by the server only' };
  if (input.isPlatformOwner) return { ok: true };

  const profiles = input.profiles || [];
  if (profiles.length === 0) return { ok: false, code: 'NO_PROFILE', message: 'No profile in this school' };
  if (tier === 'ANY_PROFILE') return { ok: true };

  const active = profiles.filter((p) => p.status === 'ACTIVE');
  if (active.length === 0) return { ok: false, code: 'NO_ACTIVE_PROFILE', message: 'No active profile in this school' };
  if (tier === 'ACTIVE') return { ok: true };

  const roles = active.map((p) => String(p.app_role || ''));
  if (tier === 'STAFF' && roles.some((r) => r === 'ADMIN' || r === 'TEACHER')) return { ok: true };
  if (tier === 'ADMIN' && roles.includes('ADMIN')) return { ok: true };
  return { ok: false, code: 'ROLE_NOT_ALLOWED', message: 'Your role cannot log this action' };
}

/** Details are capped so the log can't be used as free storage. */
export function boundDetails(details: unknown): Record<string, unknown> | null {
  if (details === undefined || details === null) return null;
  if (typeof details !== 'object' || Array.isArray(details)) return { value: String(details).slice(0, 500) };
  let serialized = '';
  try {
    serialized = JSON.stringify(details);
  } catch {
    return { truncated: true };
  }
  if (serialized.length > MAX_DETAILS_CHARS) return { truncated: true, size: serialized.length };
  return details as Record<string, unknown>;
}
