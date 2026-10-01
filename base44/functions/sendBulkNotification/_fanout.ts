// _fanout.ts — the pure half of sendBulkNotification (plus the reminder
// claim, which takes its store as a parameter). Kept in its
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

/**
 * "$1,350.00 MXN" — the amount every payment email shows (es-MX: comma for
 * thousands, point for cents, currency named).
 *
 * Built by hand, not with toLocaleString: live QA of v1.8.2 received
 * "$1350.00" from the deployed function, i.e. the runtime's Intl did not group
 * thousands for es-MX (CLDR's Spanish "minimum grouping digits" of 2, or a
 * runtime without full locale data — either way, not ours to depend on). A
 * money label must read the same on every runtime.
 */
export function moneyLabel(amount: unknown): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  const cents = Math.round(Math.abs(n) * 100);
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = String(cents % 100).padStart(2, '0');
  return `${n < 0 && cents > 0 ? '-' : ''}$${whole}.${frac} MXN`;
}

/**
 * The breakdown a payment email shows next to the balance: the charge's total
 * and what is already paid — only when something IS paid. Empty strings
 * otherwise, which the templates skip.
 */
export function paymentLabels(charge: Record<string, unknown> | null | undefined): { totalLabel: string; paidLabel: string } {
  const cents = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  };
  const paid = cents(charge?.amount_paid);
  if (paid <= 0) return { totalLabel: '', paidLabel: '' };
  return { totalLabel: moneyLabel(cents(charge?.amount) / 100), paidLabel: moneyLabel(paid / 100) };
}

/**
 * The author line of the emergency alert's Notice. The planner used to set
 * only author_id, so the director's AvisosAdmin showed a blank author; every
 * other notice carries the author's name. A director with no name on their
 * account still gets a meaningful line, never an email local part.
 */
export function emergencyAuthorName(user: { full_name?: unknown } | null | undefined): string {
  const name = typeof user?.full_name === 'string' ? user.full_name.trim() : '';
  return (name && !name.includes('@') ? name : 'Dirección de la escuela').slice(0, 200);
}

/**
 * Today's calendar day in Mexico, 'YYYY-MM-DD'. MIRRORS
 * guardedEntityWrite/_money.ts#mexicoToday (functions cannot import across
 * directories; tests/unit/payments-money.test.js compares the two).
 */
export function mexicoToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export const MANUAL_REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * What a payment reminder may say about one stored charge, or why it must not
 * go out. Pure, so the rules are tested rather than grepped:
 *   - only a charge that still owes money (PENDING / PARTIAL / OVERDUE with a
 *     balance) is reminded — never a paid or cancelled one;
 *   - the amount in the email is the BALANCE, so a family that already paid
 *     $400 of $1,000 is asked for $600, not the full amount again;
 *   - an overdue charge gets the "vencido" email, not "vence pronto";
 *   - the automatic reminder is once per charge (reminder_sent); a director's
 *     manual reminder may repeat, but at most once per charge per day
 *     (last_reminder_at), so a double click cannot mail a family twice.
 */
export function planChargeReminder(
  charge: Record<string, unknown>,
  opts: { manual: boolean; now: Date },
): { send: false; reason: string } | { send: true; overdue: boolean; balance: number } {
  const status = String(charge.status || '');
  if (!['PENDING', 'PARTIAL', 'OVERDUE'].includes(status)) return { send: false, reason: 'not_pending' };
  const cents = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  };
  const balanceCents = Math.max(0, cents(charge.amount) - cents(charge.amount_paid));
  if (balanceCents === 0) return { send: false, reason: 'not_pending' };
  if (opts.manual) {
    const last = Date.parse(String(charge.last_reminder_at || ''));
    if (!Number.isNaN(last) && last + MANUAL_REMINDER_COOLDOWN_MS > opts.now.getTime()) return { send: false, reason: 'cooldown' };
  } else if (charge.reminder_sent) {
    return { send: false, reason: 'already_sent' };
  }
  const due = String(charge.due_date || '');
  const overdue = status === 'OVERDUE' || (/^\d{4}-\d{2}-\d{2}$/.test(due) && due < mexicoToday(opts.now));
  return { send: true, overdue, balance: balanceCents / 100 };
}

// --- claiming a payment reminder before sending it ----------------------------
// (Codex review on PR #190, 2026-09-30.)
//
// The 24 h cooldown used to be written only AFTER delivery, so two clicks on
// "Enviar recordatorio" (two tabs, two directors, a double tap on a slow
// phone) both read "no reminder yet", both passed planChargeReminder and both
// mailed the family. Base44 has no conditional write, so the claim is a
// write-then-verify:
//
//   1. re-read the charge and re-run planChargeReminder on the FRESH copy
//      (and refuse while another claim younger than REMINDER_CLAIM_TTL_MS is
//      still open);
//   2. write last_reminder_at = now and reminder_claim_id = a random id;
//   3. wait REMINDER_CLAIM_SETTLE_MS and re-read: whoever's claim id is
//      stored won (last writer wins); everyone else backs off untouched;
//   4. after delivery: success clears the claim id (and sets reminder_sent);
//      a pass that reached nobody puts last_reminder_at back as it was, so
//      the director can retry now instead of in 24 h.
//
// What this does NOT close, stated plainly: a request whose fresh read (1)
// lands before a rival's claim write but whose own write (2) lands more than
// REMINDER_CLAIM_SETTLE_MS after that rival re-read (3) finds its own claim
// and sends too. That needs one request to stall for over a second between
// two consecutive calls — the old window was the whole email fan-out. And if
// the reminder_claim_id field is not deployed yet (deploy:entities), the
// store may drop it: the verify then falls back to comparing
// last_reminder_at, which two claims in the same millisecond would share.

export const REMINDER_CLAIM_SETTLE_MS = 1000;
export const REMINDER_CLAIM_TTL_MS = 5 * 60 * 1000;

// deno-lint-ignore no-explicit-any
type ClaimDb = { entities: { ChargeItem: { get(id: string): Promise<any>; update(id: string, patch: Record<string, unknown>): Promise<any> } } };

export type ReminderClaim = {
  chargeId: string;
  claimId: string;
  claimedAt: string;
  previousLastReminderAt: unknown;
  // deno-lint-ignore no-explicit-any
  charge: Record<string, any>;
  overdue: boolean;
  balance: number;
};

function ownsClaim(stored: Record<string, unknown> | null, claimId: string, claimedAt: string): boolean {
  if (!stored) return false;
  const id = stored.reminder_claim_id;
  if (typeof id === 'string' && id) return id === claimId;
  // Field dropped by a store that does not know it yet: weaker fallback.
  return Date.parse(String(stored.last_reminder_at || '')) === Date.parse(claimedAt);
}

export async function claimChargeReminder(
  db: ClaimDb,
  chargeId: string,
  opts: { manual: boolean; now: Date; claimId: string; sleep: (ms: number) => Promise<void>; settleMs?: number },
): Promise<{ ok: true; claim: ReminderClaim } | { ok: false; reason: string }> {
  const fresh = await db.entities.ChargeItem.get(chargeId).catch(() => null);
  if (!fresh) return { ok: false, reason: 'not_found' };
  const openClaim = typeof fresh.reminder_claim_id === 'string' && fresh.reminder_claim_id !== '';
  const openSince = Date.parse(String(fresh.last_reminder_at || ''));
  if (openClaim && !Number.isNaN(openSince) && opts.now.getTime() - openSince < REMINDER_CLAIM_TTL_MS) {
    return { ok: false, reason: 'in_progress' };
  }
  const plan = planChargeReminder(fresh, { manual: opts.manual, now: opts.now });
  if (!plan.send) return { ok: false, reason: plan.reason };

  const claimedAt = opts.now.toISOString();
  await db.entities.ChargeItem.update(chargeId, { last_reminder_at: claimedAt, reminder_claim_id: opts.claimId });
  await opts.sleep(opts.settleMs ?? REMINDER_CLAIM_SETTLE_MS);
  const after = await db.entities.ChargeItem.get(chargeId).catch(() => null);
  if (!ownsClaim(after, opts.claimId, claimedAt)) return { ok: false, reason: 'in_progress' };
  return {
    ok: true,
    claim: {
      chargeId,
      claimId: opts.claimId,
      claimedAt,
      previousLastReminderAt: fresh.last_reminder_at ?? null,
      charge: fresh,
      overdue: plan.overdue,
      balance: plan.balance,
    },
  };
}

/**
 * Close a claim. `sent`: the reminder reached somebody (or there was nobody
 * to reach) — keep last_reminder_at, mark reminder_sent. Otherwise roll
 * last_reminder_at back, but only while the claim is still ours.
 */
export async function releaseChargeReminder(db: ClaimDb, claim: ReminderClaim, sent: boolean): Promise<void> {
  if (sent) {
    await db.entities.ChargeItem.update(claim.chargeId, { reminder_sent: true, reminder_claim_id: null });
    return;
  }
  const stored = await db.entities.ChargeItem.get(claim.chargeId).catch(() => null);
  if (!ownsClaim(stored, claim.claimId, claim.claimedAt)) return;
  await db.entities.ChargeItem.update(claim.chargeId, {
    last_reminder_at: claim.previousLastReminderAt ?? null,
    reminder_claim_id: null,
  });
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
