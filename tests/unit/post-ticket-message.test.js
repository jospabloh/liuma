import test from 'node:test';
import assert from 'node:assert/strict';
import { decideTicketAuthor } from '../../base44/functions/postTicketMessage/_policy.ts';

// P7 (2026-09-29, finding SEC-06 / Base44 scan efa41dd4): the client used to
// choose SupportTicketMessage.author_role itself, so a parent could reply in
// a thread as 'SCHOOL_ADMIN' or 'OWNER' — impersonating the director in a
// thread Mission Control's support desk also reads. postTicketMessage now
// derives the role from who the caller is.

const base = { kind: 'reply', isRequester: false, isPlatformOwner: false, isSchoolAdmin: false, aiAttempted: false, hasAiMessage: false };

test('the requester always posts as REQUESTER', () => {
  const d = decideTicketAuthor({ ...base, isRequester: true });
  assert.deepEqual(d, { ok: true, authorRole: 'REQUESTER', attributeToCaller: true });
  // Even when the requester is also staff: in their own ticket they are the requester.
  assert.equal(decideTicketAuthor({ ...base, isRequester: true, isPlatformOwner: true }).authorRole, 'REQUESTER');
});

test('staff roles come from who the caller is, not from anything they send', () => {
  assert.equal(decideTicketAuthor({ ...base, isPlatformOwner: true }).authorRole, 'OWNER');
  assert.equal(decideTicketAuthor({ ...base, isSchoolAdmin: true }).authorRole, 'SCHOOL_ADMIN');
});

test('someone unrelated to the ticket cannot post in it at all', () => {
  const d = decideTicketAuthor(base);
  assert.equal(d.ok, false);
  assert.equal(d.code, 'FORBIDDEN');
});

test('SYSTEM notes are staff-only', () => {
  assert.equal(decideTicketAuthor({ ...base, kind: 'note', isRequester: true }).ok, false);
  assert.equal(decideTicketAuthor({ ...base, kind: 'note', isSchoolAdmin: true }).authorRole, 'SYSTEM');
});

test('the Lumi summary is posted once, by the requester, only on a ticket that went through Lumi', () => {
  assert.deepEqual(
    decideTicketAuthor({ ...base, kind: 'ai_summary', isRequester: true, aiAttempted: true }),
    { ok: true, authorRole: 'AI', attributeToCaller: false },
  );
  assert.equal(decideTicketAuthor({ ...base, kind: 'ai_summary', isRequester: true, aiAttempted: true, hasAiMessage: true }).ok, false);
  assert.equal(decideTicketAuthor({ ...base, kind: 'ai_summary', isRequester: true, aiAttempted: false }).ok, false);
  assert.equal(decideTicketAuthor({ ...base, kind: 'ai_summary', isSchoolAdmin: true, aiAttempted: true }).ok, false);
});

test('unknown kinds are refused', () => {
  assert.equal(decideTicketAuthor({ ...base, kind: 'OWNER', isRequester: true }).code, 'BAD_KIND');
});
