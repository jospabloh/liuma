// _bridgeGuard.ts — pure guards for acaciaControl's entry.ts, split out so
// node --test can load them directly (no Deno globals, no SDK import; same
// reasoning as _lumiCore.ts and _exportGate.ts).
//
// Security scan 2026-10-12, finding 1: `sr.entities[entity]` let a valid
// signature read or write ANY entity by name — the signature proves "this is
// Mission Control", not "MC should be touching this entity". ENTITY_ALLOWLIST
// is the exact entity names Mission Control's own config actually sends for
// THIS app (acacia-mission-control: supabase/migrations/0002_seed_apps.sql,
// 0004/0010_*_field_map.sql, 0006_usage_entities.sql,
// 0021_seed_session_entities.sql, api/_lib/messaging.js#liuma) — read from
// that repo, not guessed. liuma has no email_log config
// (0008_email_log_config.sql: it tracks last_reminder_sent on the
// subscription instead), so emails.status and the optional `log` on
// license.set/emails.sendFollowup have no valid entity and are intentionally
// rejected, not left open for a future config to land on unreviewed.
export const ENTITY_ALLOWLIST: Record<string, string[]> = {
  'licenses.list': ['SchoolSubscription'],
  'usage.summary': ['Student', 'Attendance', 'PaymentRecord'],
  'emails.status': [],
  'license.set': ['SchoolSubscription'],
  'license.set.log': [],
  'emails.sendFollowup.log': [],
  'tenants.contacts': ['SchoolSubscription'],
  'tenants.contacts.related': ['School'],
  'usage.byTenant': ['Student', 'Attendance', 'PaymentRecord'],
  'tickets.list': ['SupportTicket'],
  'tickets.thread': ['SupportTicketMessage'],
  'tickets.update': ['SupportTicket'],
  'tickets.update.message': ['SupportTicketMessage'],
  'sessions.list': ['AppSession'],
  'sessions.revoke': ['AppSession'],
};

export function entityAllowed(key: string, entity: unknown): boolean {
  return typeof entity === 'string' && (ENTITY_ALLOWLIST[key] ?? []).includes(entity);
}

// Security scan 2026-10-12, static finding: verifyAs() (in _acaciaSign.ts)
// only checks the HMAC and the freshness window — it has no nonce, so a
// captured legitimate request stays replayable for the rest of that window.
// A Deno-KV-backed dedup would survive across isolates, but Base44 does not
// document Deno KV for functions (same limitation schoolRead/_userLimit.ts
// already accepted for its own in-memory rate limit); this is the same
// proportionate call — an in-memory, per-isolate seen-signatures cache,
// pruned to the freshness window. It does not stop a replay that lands on a
// DIFFERENT warm isolate, but it closes the common case (the same request
// replayed in a loop, or re-sent by a confused client) without new
// infrastructure, and is strictly additive to the signature check.
//
// Pure: the caller owns the Map (entry.ts keeps one at module scope across
// requests in the same isolate); `now`/`windowMs` are passed in so this is
// testable without faking the clock globally.
export function pruneAndCheckReplay(seen: Map<string, number>, sig: string, now: number, windowMs: number): boolean {
  for (const [s, expiry] of seen) if (expiry <= now) seen.delete(s);
  if (seen.has(sig)) return true;
  seen.set(sig, now + windowMs);
  return false;
}
