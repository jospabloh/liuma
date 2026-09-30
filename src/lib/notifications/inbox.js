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
