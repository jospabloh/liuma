// Pure helpers for a person's notice inbox (their own NoticeDelivery rows
// joined to the notices). No imports, so `node --test` loads it directly.
//
// One notice can reach the same person more than once: every notice fans out
// one delivery per (parent, child) — so the teacher's home can count the
// unread ones among their own families — and a parent with two children in
// the school gets two copies of a school-wide notice or of the emergency
// alert. An inbox is about notices, not copies: it shows each notice once,
// unread while any copy is unread, and "Marcar como leído" marks every copy.

/**
 * @param {Array<object>} deliveries the caller's own NoticeDelivery rows, newest first
 * @param {Map<string, object>} noticesById the notices the caller can read
 * @returns {Array<{ notice: object, delivery: object, copies: object[] }>}
 *   one entry per notice, in delivery order; `delivery` is the copy that
 *   represents it (an unread one when there is any), `copies` all of them.
 *   A delivery whose notice is not readable is dropped.
 */
export function collapseInbox(deliveries, noticesById) {
  const groups = new Map();
  for (const delivery of Array.isArray(deliveries) ? deliveries : []) {
    const noticeId = delivery?.notice_id;
    const notice = noticeId ? noticesById?.get(noticeId) : null;
    if (!notice) continue;
    if (!groups.has(noticeId)) groups.set(noticeId, { notice, copies: [] });
    groups.get(noticeId).copies.push(delivery);
  }
  return [...groups.values()].map(({ notice, copies }) => {
    const unread = copies.find((d) => d.status === 'SENT');
    const escalated = copies.some((d) => d.escalation_status === 'ESCALATED');
    const representative = unread || copies[0];
    return {
      notice,
      delivery: escalated && representative.escalation_status !== 'ESCALATED'
        ? { ...representative, escalation_status: 'ESCALATED' }
        : representative,
      copies,
    };
  });
}

/** The copies still to mark read ("Marcar como leído" marks all of them). */
export function unreadCopies(entry) {
  return (entry?.copies || []).filter((d) => d.status === 'SENT');
}

/**
 * The "N urgentes sin leer" badge on a home screen, counted exactly the way
 * the inbox it leads to shows them: the viewer's OWN copies only, one per
 * notice, unread while any of their copies is unread.
 *
 * Live QA of v1.8.2: one emergency alert showed on a teacher's home as
 * "4 urgentes sin leer". The teacher's home counted every unread copy it could
 * read — the three per-child copies the families got, plus the teacher's own
 * — so the number was neither "notices" nor "mine", and three of the four
 * were copies the teacher can never mark read, so the badge could not clear.
 *
 * @param {Array<object>} deliveries NoticeDelivery rows (others' are ignored)
 * @param {Array<object>} notices the notices the viewer can read
 * @param {{ userId: string, priority?: string }} opts
 */
export function unreadNoticeCount(deliveries, notices, { userId, priority = 'URGENT' } = {}) {
  if (!userId) return 0;
  const wanted = new Set((Array.isArray(notices) ? notices : [])
    .filter((notice) => notice && notice.priority === priority)
    .map((notice) => notice.id));
  const unread = new Set();
  for (const row of Array.isArray(deliveries) ? deliveries : []) {
    if (row && row.recipient_user_id === userId && row.status === 'SENT' && wanted.has(row.notice_id)) {
      unread.add(row.notice_id);
    }
  }
  return unread.size;
}
