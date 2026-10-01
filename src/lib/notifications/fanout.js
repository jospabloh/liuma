// Pure helpers for client-side notification delivery. No imports, so
// `node --test` loads it directly.
//
// The bulk sends (emergency alert, reminders, ticket escalation) now fan out
// server-side in base44/functions/sendBulkNotification, whose own
// `_fanout.ts` has the server twin of mapWithConcurrency below. This copy
// serves the small per-event sends that still go through
// notificationService.sendByEvent (ticket reply/resolved, new user pending),
// so they get the same never-abort-on-one-failure behavior.

/**
 * Runs `fn` over `items` with at most `limit` in flight and never throws:
 * every item gets `{ ok: true, value }` or `{ ok: false, error }`, in input
 * order. The old loop awaited recipients one by one and let the first
 * failure escape, which skipped every recipient after it.
 */
export async function mapWithConcurrency(items, limit, fn) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, list.length || 1));
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { ok: true, value: await fn(list[index], index) };
      } catch (error) {
        results[index] = { ok: false, error: String(error?.message || error) };
      }
    }
  }
  await Promise.all(Array.from({ length: width }, () => worker()));
  return results;
}

/**
 * "Enviado a X de Y personas." — what a director needs to know after an
 * alert: not just that it "worked", but whether anyone was left out.
 * Returns '' when there is nothing to report (skipped / no summary).
 */
export function formatDeliverySummary(summary) {
  const total = Number(summary?.total) || 0;
  const reached = Math.min(Number(summary?.reached) || 0, total);
  if (!summary || summary.skipped) return '';
  if (total === 0) return 'No hay destinatarios activos para este aviso.';
  const noun = total === 1 ? 'persona' : 'personas';
  return `Enviado a ${reached} de ${total} ${noun}.`;
}

/** True when some recipients were not reached — the UI must say so, not hide it. */
export function hasUndelivered(summary) {
  const total = Number(summary?.total) || 0;
  const reached = Number(summary?.reached) || 0;
  return total > 0 && reached < total;
}

/**
 * "También quedó en Avisos de N personas." — the emergency alert's in-app
 * half (one NoticeDelivery per recipient, sendBulkNotification). Separate
 * from formatDeliverySummary on purpose: that line counts emails, and an
 * Avisos row is not an email. '' when the server did not report it (an
 * older deploy) or nobody got one.
 */
export function formatInAppSummary(summary) {
  if (!summary || summary.skipped) return '';
  if (Number(summary.inAppFailed) > 0) {
    return 'No se pudo agregar la alerta a los Avisos de cada persona; sigue visible en la pantalla de inicio.';
  }
  const people = Number(summary.inAppRecipients) || 0;
  if (people <= 0) return '';
  return `También quedó en los Avisos de ${people} ${people === 1 ? 'persona' : 'personas'}.`;
}
