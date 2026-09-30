// _fanout.ts — the pure, IO-free half of sendBulkNotification. Kept in its
// own file with no imports so tests/unit/notifications-fanout.test.js can load
// the REAL server code under `node --test` (Node 22 strips the types), rather
// than a client-side look-alike that could drift from it.

export type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Runs `fn` over `items` with at most `limit` calls in flight, and never
 * throws: every item gets a settled result, in input order. This is the whole
 * point of moving the fan-out server-side — the old browser loop awaited each
 * recipient in turn and aborted on the first failure, so one bad address (or
 * a closed tab) silently stopped delivery to everyone after it.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Settled<R>[]> {
  const list = Array.isArray(items) ? items : [];
  const results: Settled<R>[] = new Array(list.length);
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, list.length || 1));
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { ok: true, value: await fn(list[index], index) };
      } catch (error) {
        results[index] = { ok: false, error: String((error as Error)?.message || error) };
      }
    }
  }
  await Promise.all(Array.from({ length: width }, () => worker()));
  return results;
}

/**
 * Mirrors src/lib/notifications/service.js's isChannelEnabled: a channel is on
 * unless the school OR the recipient explicitly turned it off, globally or for
 * the recipient's role. `forceOn` is for emergency alerts, which a family
 * must not be able to mute — the same reason a fire alarm has no snooze.
 */
// deno-lint-ignore no-explicit-any
export function isChannelEnabled(opts: { schoolPrefs?: any; userPrefs?: any; channel: string; role?: string; forceOn?: boolean }): boolean {
  if (opts.forceOn) return true;
  const role = String(opts.role || '').toLowerCase();
  const roleKey = role ? `role_${role}` : null;
  const school = opts.schoolPrefs || {};
  const own = opts.userPrefs || {};
  const on = (prefs: Record<string, unknown>) =>
    prefs[opts.channel] !== false && (roleKey ? prefs[roleKey] !== false : true);
  return on(school) && on(own);
}

/**
 * Mirrors src/lib/events/reminder-selection.js's selectNonResponders: the
 * {parentId, studentId} pairs with no EventResponse for that same pair. The
 * app never writes a 'PENDING' response row, so absence is the only signal.
 */
export function selectNonResponders(
  pairs: Array<{ parentId?: string; studentId?: string }>,
  responses: Array<{ parent_id?: string; student_id?: string }>,
): Array<{ parentId: string; studentId: string }> {
  const responded = new Set(
    (responses || [])
      .filter((r) => r && r.parent_id && r.student_id)
      .map((r) => `${r.parent_id}::${r.student_id}`),
  );
  return (pairs || []).filter(
    (p) => p && p.parentId && p.studentId && !responded.has(`${p.parentId}::${p.studentId}`),
  ) as Array<{ parentId: string; studentId: string }>;
}

/**
 * The idempotency key for one escalation email/notice: ticket tier + address.
 * Per recipient (not one flag per ticket) so a send that failed for admin #2
 * is retried without re-mailing admin #1 — the lesson notifyParents and
 * new_user_pending already learned. Per tier so the director-tier notice and
 * the later hand-off to soporte (PLATFORM) are two distinct, legitimate sends.
 */
export function escalationKey(tier: string, recipient: string): string {
  return `${String(tier || '').toUpperCase()}:${String(recipient || '').trim().toLowerCase()}`;
}

/** How many of `timestamps` fall inside the `windowMs` ending at `now`. */
export function countWithinWindow(timestamps: Array<string | undefined | null>, now: Date, windowMs: number): number {
  const floor = now.getTime() - windowMs;
  return (timestamps || []).filter((t) => {
    if (!t) return false;
    const at = new Date(t).getTime();
    return Number.isFinite(at) && at > floor && at <= now.getTime();
  }).length;
}

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * 'YYYY-MM-DD' (or the date part of an ISO datetime) → "5 de marzo, 2027".
 * Pure string ops, no `new Date('YYYY-MM-DD')` — that parses as UTC midnight
 * and prints the previous day in Mexico (the bug the shared date helper
 * fixed client-side). Unparseable input returns ''.
 */
export function spanishDate(value: string | undefined | null, withYear = true): string {
  const datePart = String(value || '').slice(0, 10);
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return '';
  const month = MONTHS_ES[m - 1];
  return withYear ? `${d} de ${month}, ${y}` : `${d} de ${month}`;
}

/** "$1,250.00" — the amount label the payment reminder has always shown. */
export function moneyLabel(amount: unknown): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/**
 * The in-app half of the emergency alert: the NoticeDelivery rows that put
 * the alert in each recipient's Avisos list and unread badge.
 *
 * WHY (loose-ends audit, 2026-09-30). The parent's Avisos page lists the
 * caller's NoticeDelivery rows joined to their Notice — a Notice with no
 * delivery for you is not on your list. The alert only ever created the
 * school-wide Notice, so it showed on the parent's home card and nowhere
 * else: no Avisos entry, no unread badge, and none of the "urgentes sin
 * leer" counters on the teacher's and director's homes saw it.
 *
 * The rows, for the recipients the email half already targets (ACTIVE
 * PARENT and TEACHER profiles of THIS school):
 *   - a PARENT gets one row per ACTIVE link to an ACTIVE student of this
 *     school — the same (parent, student) shape guardedEntityWrite's
 *     planNoticeDeliveries gives every other notice, so the teacher's home
 *     counts the unread ones among their own families;
 *   - a PARENT with no such link still gets one row (no student): an
 *     emergency reaches every active member, not only linked ones;
 *   - a TEACHER gets one row addressed to them (no student).
 * Rows that already exist for this notice are skipped, so a retry never
 * duplicates. School, recipients and dates never come from the request.
 */
export function planEmergencyDeliveries(input: {
  notice: Row;
  schoolId: string;
  now: Date;
  profiles: Row[];
  links: Row[];
  students: Row[];
  existing?: Row[];
}): Row[] {
  const { notice, schoolId, now } = input;
  if (!schoolId || !notice?.id || String(notice.school_id || '') !== schoolId) return [];
  const activeStudents = new Set(
    (input.students || [])
      .filter((s) => s && String(s.school_id || '') === schoolId && s.is_active !== false)
      .map((s) => String(s.id)),
  );
  const keyOf = (recipient: string, student: string) => `${recipient}|${student}`;
  const seen = new Set(
    (input.existing || [])
      .filter((d) => d && String(d.notice_id || '') === String(notice.id))
      .map((d) => keyOf(String(d.recipient_user_id || ''), String(d.student_id || ''))),
  );
  const sentAt = notice.sent_at || now.toISOString();
  const escalationDueAt = notice.priority === 'URGENT' ? new Date(now.getTime() + 24 * 3600 * 1000).toISOString() : null;
  const rows: Row[] = [];
  const push = (recipient: string, role: string, studentId: string) => {
    const key = keyOf(recipient, studentId);
    if (seen.has(key)) return;
    seen.add(key);
    const row: Row = {
      school_id: schoolId,
      notice_id: String(notice.id),
      recipient_user_id: recipient,
      recipient_role: role,
      status: 'SENT',
      sent_at: sentAt,
      escalation_due_at: escalationDueAt,
    };
    if (studentId) row.student_id = studentId;
    rows.push(row);
  };

  const members = new Map<string, string>();
  for (const p of input.profiles || []) {
    if (!p || String(p.school_id || '') !== schoolId || p.status !== 'ACTIVE') continue;
    const id = String(p.user_id || '');
    const role = String(p.app_role || '');
    if (!id || !['PARENT', 'TEACHER'].includes(role) || members.has(id)) continue;
    members.set(id, role);
  }
  for (const [userId, role] of members) {
    if (role === 'TEACHER') {
      push(userId, 'TEACHER', '');
      continue;
    }
    const children = [...new Set((input.links || [])
      .filter((l) => l && String(l.parent_id || '') === userId && l.status === 'ACTIVE')
      .filter((l) => !l.school_id || String(l.school_id) === schoolId)
      .map((l) => String(l.student_id || ''))
      .filter((id) => activeStudents.has(id)))];
    if (children.length === 0) push(userId, 'PARENT', '');
    for (const studentId of children) push(userId, 'PARENT', studentId);
  }
  return rows;
}

/** How many distinct people a set of delivery rows reaches. */
export function distinctRecipients(rows: Row[]): number {
  return new Set((rows || []).map((r) => String(r?.recipient_user_id || '')).filter(Boolean)).size;
}
