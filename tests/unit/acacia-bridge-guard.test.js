import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ENTITY_ALLOWLIST,
  entityAllowed,
  pruneAndCheckReplay,
} from '../../base44/functions/acaciaControl/_bridgeGuard.ts';

// Security scan 2026-10-12, finding 1: a valid HMAC signature proved "this is
// Mission Control", never "MC should be touching THIS entity" — `sr.entities
// [entity]` let a signed body name any entity in the app. ENTITY_ALLOWLIST is
// read from acacia-mission-control's own config for liuma (seed migrations +
// api/_lib/messaging.js), not guessed, so these assertions double as a record
// of what that config actually sends.

const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

test('each action only allows the entity names Mission Control actually sends for this app', () => {
  assert.deepEqual(ENTITY_ALLOWLIST['licenses.list'], ['SchoolSubscription']);
  assert.deepEqual(ENTITY_ALLOWLIST['usage.summary'], ['Student', 'Attendance', 'PaymentRecord']);
  assert.deepEqual(ENTITY_ALLOWLIST['usage.byTenant'], ['Student', 'Attendance', 'PaymentRecord']);
  assert.deepEqual(ENTITY_ALLOWLIST['license.set'], ['SchoolSubscription']);
  assert.deepEqual(ENTITY_ALLOWLIST['tenants.contacts'], ['SchoolSubscription']);
  assert.deepEqual(ENTITY_ALLOWLIST['tenants.contacts.related'], ['School']);
  assert.deepEqual(ENTITY_ALLOWLIST['tickets.list'], ['SupportTicket']);
  assert.deepEqual(ENTITY_ALLOWLIST['tickets.update'], ['SupportTicket']);
  assert.deepEqual(ENTITY_ALLOWLIST['tickets.thread'], ['SupportTicketMessage']);
  assert.deepEqual(ENTITY_ALLOWLIST['tickets.update.message'], ['SupportTicketMessage']);
  assert.deepEqual(ENTITY_ALLOWLIST['sessions.list'], ['AppSession']);
  assert.deepEqual(ENTITY_ALLOWLIST['sessions.revoke'], ['AppSession']);
  // liuma has no email_log config (acacia-mission-control's
  // 0008_email_log_config.sql) — these must stay empty, not "whatever MC sends".
  assert.deepEqual(ENTITY_ALLOWLIST['emails.status'], []);
  assert.deepEqual(ENTITY_ALLOWLIST['license.set.log'], []);
  assert.deepEqual(ENTITY_ALLOWLIST['emails.sendFollowup.log'], []);
});

test('entityAllowed accepts only the listed entity for that action, and nothing for an empty list', () => {
  assert.equal(entityAllowed('licenses.list', 'SchoolSubscription'), true);
  assert.equal(entityAllowed('licenses.list', 'UserProfile'), false, 'a different, real entity is still not this action\'s');
  assert.equal(entityAllowed('licenses.list', 'AuditLog'), false, 'not even a sensitive entity gets a free pass');
  assert.equal(entityAllowed('emails.status', 'SchoolSubscription'), false, 'empty allowlist refuses everything');
  assert.equal(entityAllowed('usage.summary', 'Classroom'), false, 'usage.summary is scoped to the three usage entities only');
  for (const junk of [undefined, null, 42, {}, []]) {
    assert.equal(entityAllowed('licenses.list', junk), false, String(junk));
  }
  assert.equal(entityAllowed('made.up.action', 'SchoolSubscription'), false, 'an action with no entry allows nothing');
});

test('pruneAndCheckReplay: the same signature a second time is a replay; a different one is not', () => {
  const seen = new Map();
  assert.equal(pruneAndCheckReplay(seen, 'sig-a', 1000, 300_000), false, 'first time through');
  assert.equal(pruneAndCheckReplay(seen, 'sig-a', 1500, 300_000), true, 'same signature again, still in the window');
  assert.equal(pruneAndCheckReplay(seen, 'sig-b', 1500, 300_000), false, 'a different signature is unaffected');
});

test('pruneAndCheckReplay: an entry expires and is pruned, so the signature can be seen again only after it ages out', () => {
  const seen = new Map();
  pruneAndCheckReplay(seen, 'sig-a', 0, 300_000);
  assert.equal(pruneAndCheckReplay(seen, 'sig-a', 299_999, 300_000), true, 'still inside the window');
  assert.equal(pruneAndCheckReplay(seen, 'sig-a', 300_001, 300_000), false, 'window passed: pruned, so this looks like a fresh signature');
  // Pruning on every call keeps the map from growing without bound across a
  // long-lived isolate: an old, expired entry from a different signature is
  // gone by the time anyone asks again.
  const seen2 = new Map();
  pruneAndCheckReplay(seen2, 'old', 0, 300_000);
  pruneAndCheckReplay(seen2, 'new', 999_999, 300_000);
  assert.equal(seen2.has('old'), false);
  assert.equal(seen2.has('new'), true);
});

test('entry.ts rejects an entity outside the allowlist before touching sr.entities, on every action', () => {
  const src = read('base44/functions/acaciaControl/entry.ts');
  for (const action of [
    'licenses.list', 'license.set', 'tenants.contacts', 'usage.byTenant',
    'tickets.list', 'tickets.thread', 'tickets.update', 'sessions.list', 'sessions.revoke',
  ]) {
    assert.match(src, new RegExp(`entityAllowed\\('${action.replace('.', '\\.')}', `), `${action} is checked`);
  }
  assert.match(src, /pruneAndCheckReplay\(seenSignatures, String\(sig\), Date\.now\(\), MAX_SKEW_MS\)/);
  // ping never needs a fresh signature check — Mission Control's health probe
  // (syncHealth.js) can legitimately be called back-to-back.
  assert.match(src, /action !== 'ping' && pruneAndCheckReplay/);
});

// _acaciaSign.ts's own header says it is byte-identical in every portfolio
// app; nothing in this repo previously checked even the two LOCAL copies
// (acaciaControl and notifyTicketCreated) against each other.
test('_acaciaSign.ts is byte-identical between acaciaControl and notifyTicketCreated', () => {
  const canonical = read('base44/functions/acaciaControl/_acaciaSign.ts');
  assert.match(canonical, /CANONICAL SOURCE\. This file is byte-identical in every portfolio app/);
  assert.equal(read('base44/functions/notifyTicketCreated/_acaciaSign.ts'), canonical);
});
