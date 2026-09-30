import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// The REAL server helpers (Node 22 strips the types) — not a client look-alike.
import {
  countWithinWindow,
  escalationKey,
  isChannelEnabled,
  mapWithConcurrency as serverMapWithConcurrency,
  moneyLabel,
  selectNonResponders as serverSelectNonResponders,
  spanishDate,
} from '../../base44/functions/sendBulkNotification/_fanout.ts';
import {
  formatDeliverySummary,
  hasUndelivered,
  mapWithConcurrency as clientMapWithConcurrency,
} from '../../src/lib/notifications/fanout.js';
import { selectNonResponders as clientSelectNonResponders } from '../../src/lib/events/reminder-selection.js';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// Sales-readiness audit F24 (2026-09-29): the emergency alert and the bulk
// reminders used to be fanned out from the browser one recipient at a time,
// and the first recipient whose send failed threw out of the loop — every
// parent after them silently got nothing. Both fan-out helpers must deliver
// to everyone else no matter how many fail.
for (const [name, mapWithConcurrency] of [['server', serverMapWithConcurrency], ['client', clientMapWithConcurrency]]) {
  test(`${name} mapWithConcurrency keeps going after failures and preserves order`, async () => {
    const reached = [];
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      if (n === 2 || n === 5) throw new Error(`bad address ${n}`);
      reached.push(n);
      return n * 10;
    });
    assert.deepEqual(reached.sort(), [1, 3, 4, 6]);
    assert.deepEqual(results.map((r) => r.ok), [true, false, true, true, false, true]);
    assert.equal(results[0].value, 10);
    assert.match(results[1].error, /bad address 2/);
  });

  test(`${name} mapWithConcurrency never exceeds its concurrency limit`, async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
    });
    assert.ok(peak <= 3, `peak concurrency was ${peak}`);
    assert.ok(peak >= 2, 'expected real parallelism, not a serial loop');
  });

  test(`${name} mapWithConcurrency tolerates empty / non-array input`, async () => {
    assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []);
    assert.deepEqual(await mapWithConcurrency(null, 4, async () => 1), []);
  });
}

test('the server non-responder selection matches the client one it mirrors', () => {
  const pairs = [
    { parentId: 'p1', studentId: 's1' },
    { parentId: 'p1', studentId: 's2' },
    { parentId: 'p2', studentId: 's3' },
    { parentId: '', studentId: 's4' },
  ];
  const responses = [{ parent_id: 'p1', student_id: 's1' }, { parent_id: 'p2', student_id: 'other' }];
  assert.deepEqual(serverSelectNonResponders(pairs, responses), clientSelectNonResponders(pairs, responses));
  assert.deepEqual(serverSelectNonResponders(pairs, responses).map((p) => p.studentId), ['s2', 's3']);
});

test('channel preferences: off at school or user level wins, emergencies cannot be muted', () => {
  assert.equal(isChannelEnabled({ channel: 'email', role: 'PARENT' }), true);
  assert.equal(isChannelEnabled({ schoolPrefs: { email: false }, channel: 'email', role: 'PARENT' }), false);
  assert.equal(isChannelEnabled({ userPrefs: { role_parent: false }, channel: 'in_app', role: 'PARENT' }), false);
  assert.equal(isChannelEnabled({ userPrefs: { email: false }, channel: 'in_app', role: 'PARENT' }), true);
  assert.equal(isChannelEnabled({ userPrefs: { email: false }, channel: 'email', role: 'PARENT', forceOn: true }), true);
});

test('escalation idempotency is per tier and per recipient, case-insensitive', () => {
  assert.equal(escalationKey('platform', ' Soporte@AcaciaCo.com.mx '), 'PLATFORM:soporte@acaciaco.com.mx');
  assert.notEqual(escalationKey('SCHOOL_ADMIN', 'a@x.mx'), escalationKey('PLATFORM', 'a@x.mx'));
});

test('rate-limit window counts only timestamps inside the last 24 h', () => {
  const now = new Date('2026-09-29T12:00:00.000Z');
  const day = 24 * 60 * 60 * 1000;
  const stamps = ['2026-09-29T11:00:00.000Z', '2026-09-28T12:30:00.000Z', '2026-09-28T11:59:00.000Z', null, 'junk'];
  assert.equal(countWithinWindow(stamps, now, day), 2);
});

test('spanishDate never shifts a date-only value to the previous day', () => {
  // new Date('2027-03-05') is UTC midnight = 4 March in Mexico; the label must say 5.
  assert.equal(spanishDate('2027-03-05'), '5 de marzo, 2027');
  assert.equal(spanishDate('2027-03-05T00:00:00.000Z', false), '5 de marzo');
  assert.equal(spanishDate(''), '');
  assert.equal(spanishDate('2027-13-01'), '');
  assert.equal(moneyLabel(1250), '$1,250.00');
  assert.equal(moneyLabel('x'), '');
});

test('the director is told how many people the alert actually reached', () => {
  assert.equal(formatDeliverySummary({ total: 40, reached: 38 }), 'Enviado a 38 de 40 personas.');
  assert.equal(formatDeliverySummary({ total: 1, reached: 1 }), 'Enviado a 1 de 1 persona.');
  assert.equal(formatDeliverySummary({ total: 0, reached: 0 }), 'No hay destinatarios activos para este aviso.');
  assert.equal(formatDeliverySummary({ skipped: true }), '');
  assert.equal(hasUndelivered({ total: 40, reached: 38 }), true);
  assert.equal(hasUndelivered({ total: 40, reached: 40 }), false);
});

test('sendBulkNotification/_templates.ts is a byte-identical copy of sendNotificationEmail/_templates.ts', () => {
  // Deno functions cannot import across directories. Two copies of the email
  // templates only stay the same email if something asserts it.
  assert.equal(
    read('base44/functions/sendBulkNotification/_templates.ts'),
    read('base44/functions/sendNotificationEmail/_templates.ts'),
  );
});

test('sendBulkNotification derives recipients and text from stored records, never the request', () => {
  const source = read('base44/functions/sendBulkNotification/entry.ts');
  // Every planner authorizes against the STORED record's school.
  assert.match(source, /requireActiveAdmin\(sr, user, charge\.school_id\)/);
  assert.match(source, /requireActiveAdmin\(sr, user, event\.school_id\)/);
  assert.match(source, /sr\.entities\.SupportTicket\.get\(ticketId\)/);
  // Recipients' addresses come from User rows resolved server-side.
  assert.match(source, /sr\.entities\.User\.filter\(\{ id: \{ \$in: unique \} \}/);
  // No templateContext is accepted from the client.
  assert.doesNotMatch(source, /body\?\.templateContext/);
  // Once per record, and only marked when somebody was reached. For a charge
  // the once-per-record rule (and the manual reminder's daily limit) lives in
  // _fanout.ts#planChargeReminder, tested in payments-money.test.js.
  assert.match(source, /const reminder = planChargeReminder\(charge, \{ manual, now \}\);/);
  assert.match(source, /if \(!reminder\.send\) return \{ skipped: reminder\.reason \};/);
  assert.match(source, /if \(event\.reminder_sent\) return \{ skipped: 'already_sent' \}/);
  assert.match(source, /summary\.reached > 0 \|\| summary\.total === 0/);
  // Escalations: once per (ticket, tier, recipient), and requesters are rate limited.
  assert.match(source, /escalation_notified_recipients: \[\.\.\.already, \.\.\.delivered\.map\(\(r\) => r\.key\)\]/);
  assert.match(source, /throw new HttpError\(429, 'RATE_LIMITED'/);
});

test('sendNotificationEmail refuses support_ticket_escalated (the unbounded free-text path)', () => {
  const source = read('base44/functions/sendNotificationEmail/entry.ts');
  assert.match(source, /const BULK_ONLY_EVENTS = \['support_ticket_escalated'\];/);
  assert.match(source, /return bad\(410, 'MOVED'/);
  assert.doesNotMatch(source, /SUPPORT_EMAIL/);
});

test('the escalation idempotency field is server-only', () => {
  const schema = read('base44/entities/SupportTicket.jsonc');
  assert.match(schema, /"escalation_notified_recipients":[\s\S]{0,700}?"write": false/);
});

test('the emergency alert and event reminders go through the server fan-out', () => {
  const alert = read('src/pages/AlertaEmergencia.jsx');
  assert.match(alert, /sendBulk\(\{\s*eventType: 'emergency_alert'/);
  assert.match(alert, /formatDeliverySummary\(delivery\)/);
  assert.doesNotMatch(alert, /sendByEvent|sendHighPriorityAlert/);

  const reminders = read('src/lib/events/reminders.js');
  assert.match(reminders, /sendBulk\(\{ eventType: 'event_confirmation_reminder', eventId: event\.id \}\)/);
  // The server owns reminder_sent now; the client must not mark it itself.
  assert.doesNotMatch(reminders, /Event\.update/);
});

test('sendByEvent no longer aborts the whole fan-out on one failed recipient', () => {
  const source = read('src/lib/notifications/service.js');
  assert.match(source, /mapWithConcurrency\(list, SEND_CONCURRENCY/);
  assert.doesNotMatch(source, /for \(const recipient of recipients\)/);
});

// Reviewer pass (2026-09-29): "Enviado a X de Y" must count only what a person
// can actually receive. Notice has no 'USER' scope, no user_id and requires
// author_id, and no screen shows a USER-scoped notice, so counting one as
// "reached" reported 300 de 300 with every email failed.
test('sendBulkNotification counts only delivered emails as reached, and never creates per-user notices', () => {
  const source = read('base44/functions/sendBulkNotification/entry.ts');
  assert.doesNotMatch(source, /scope: 'USER'/);
  assert.doesNotMatch(source, /_inApp/);
  assert.match(source, /if \(out\.email === 'ok'\) \{ summary\.emailed \+= 1; summary\.reached \+= 1; delivered\.push\(r\); \}/);
  // The only Notice it creates is the school-wide emergency banner.
  assert.equal((source.match(/Notice\.create\(/g) || []).length, 1);
  assert.match(source, /scope: 'SCHOOL',[\s\S]{0,120}is_emergency: true/);
});

test('sendBulkNotification keeps recipients inside the stored record\'s school', () => {
  const source = read('base44/functions/sendBulkNotification/entry.ts');
  // A charge pointing at another school's student mails nobody.
  assert.match(source, /String\(fetchedStudent\.school_id\) === String\(charge\.school_id\)/);
  assert.match(source, /ParentStudent\.filter\(\{ school_id: schoolId, student_id: studentId, status: 'ACTIVE' \}\)/);
  assert.match(source, /ParentStudent\.filter\(\{ school_id: event\.school_id, student_id: \{ \$in: studentIds \}/);
  // Whoever opened the ticket is rate limited, a school ADMIN included.
  assert.match(source, /if \(!isOwner && isRequester\) \{/);
});
