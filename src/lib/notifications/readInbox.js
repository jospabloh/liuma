// A person's own notice inbox, read through schoolRead: their NoticeDelivery
// rows (schoolRead only ever returns the caller's own copies to a parent, and
// to a teacher their own plus their families') joined to the notices they
// can read, one entry per notice (collapseInbox).
//
// Kept out of the pages on purpose: a notice page never names recipients
// itself (tests/unit/write-path-p10b.test.js — the server picks them on
// publish), and this is the one place a page asks "which of these are mine".
//
// One schoolReadMany request, not two schoolRead calls: the platform rate
// limit (live QA of v1.8.2) is per request, and a failed half used to leave
// the teacher's "Recibidos de la escuela" silently empty.
import { schoolReadMany } from '@/lib/data/schoolRead';
import { collapseInbox } from './inbox';

export async function readNoticeInbox({ schoolId, userId, limit = 50 }) {
  if (!schoolId || !userId) return [];
  const { deliveries, notices } = await schoolReadMany({
    deliveries: ['NoticeDelivery', { school_id: schoolId, recipient_user_id: userId }, '-created_date', limit],
    notices: ['Notice', { school_id: schoolId }, '-created_date', limit],
  });
  return collapseInbox(deliveries, new Map(notices.map((notice) => [notice.id, notice])));
}
