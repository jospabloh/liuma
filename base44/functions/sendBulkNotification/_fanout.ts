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
