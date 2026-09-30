// A person's own notice inbox, read through schoolRead: their NoticeDelivery
// rows (schoolRead only ever returns the caller's own copies to a parent, and
// to a teacher their own plus their families') joined to the notices they
// can read, one entry per notice (collapseInbox).
//
// Kept out of the pages on purpose: a notice page never names recipients
// itself (tests/unit/write-path-p10b.test.js — the server picks them on
// publish), and this is the one place a page asks "which of these are mine".
import { schoolRead } from '@/lib/data/schoolRead';
import { collapseInbox } from './inbox';

export async function readNoticeInbox({ schoolId, userId, limit = 50 }) {
  if (!schoolId || !userId) return [];
  const [deliveries, notices] = await Promise.all([
    schoolRead('NoticeDelivery', { school_id: schoolId, recipient_user_id: userId }, '-created_date', limit),
    schoolRead('Notice', { school_id: schoolId }, '-created_date', limit),
  ]);
  return collapseInbox(deliveries, new Map(notices.map((notice) => [notice.id, notice])));
}
