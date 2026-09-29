import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { escapeHtml } from '../../src/lib/htmlEscape.js';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// Parent- and staff-facing transactional emails interpolate entity/user data
// (names, free-text notes, ticket bodies) into an HTML body. Unescaped, that
// lets user input (e.g. a signup name, an attendance reason, a support
// ticket description) inject HTML/script into a recipient's email client —
// CWE-79. escapeHtml() is the one sanctioned defense; every email-body
// template must route its interpolations through it.

test('escapeHtml neutralizes HTML metacharacters', () => {
  assert.equal(
    escapeHtml('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;'
  );
  assert.equal(escapeHtml(`"quoted" & 'single'`), '&quot;quoted&quot; &amp; &#39;single&#39;');
});

test('escapeHtml tolerates null/undefined/non-string input', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '42');
});

test('notification email templates escape every interpolated field', () => {
  const source = read('src/lib/notifications/templates.js');
  assert.match(source, /import \{ escapeHtml \} from '@\/lib\/htmlEscape'/);

  // Every field known to reach an emailBody template — including
  // signup-time userName/userEmail, which an unauthenticated registrant
  // controls — must be wrapped in escapeHtml(...) before interpolation.
  const mustBeEscaped = [
    'userName', 'userEmail', 'roleName',
    'studentName', 'conceptName', 'amountLabel', 'dueDateLabel',
    'eventTitle', 'dateLabel', 'timeLabel', 'locationLabel', 'deadlineLabel',
    'message',
    'ticketNumber', 'subjectText', 'requesterName', 'categoryLabel', 'priorityLabel', 'slaDateLabel', 'description',
    'replyBody', 'resolutionNote',
  ];
  for (const field of mustBeEscaped) {
    assert.match(
      source,
      new RegExp(`escapeHtml\\(${field}(\\s*\\|\\|[^)]*)?\\)`),
      `expected ${field} to be routed through escapeHtml(...) in templates.js`
    );
  }
});

// 2026-09-24: the absence and diary parent emails moved server-side, into
// base44/functions/notifyParents/entry.ts (Base44 security scan, "Evitar el
// uso no autorizado de créditos" — SendEmail/InvokeLLM can no longer be
// called from the browser with a client-built body). Asistencia.jsx and
// CrearBitacora.jsx now only pass a record id; the escaping guarantee these
// two tests used to check on the client lives in notifyParents/entry.ts
// instead.

test('Asistencia.jsx no longer builds the absence email client-side', () => {
  const source = read('src/pages/Asistencia.jsx');
  assert.doesNotMatch(source, /integrations\.Core\.SendEmail/);
  assert.match(source, /invokeFunction\(base44, 'notifyParents', \{ kind: 'absence', recordId: record\.id \}\)/);
});

test('CrearBitacora.jsx no longer builds the diary email or the AI prompt client-side', () => {
  const source = read('src/pages/CrearBitacora.jsx');
  assert.doesNotMatch(source, /integrations\.Core\.(SendEmail|InvokeLLM)/);
  assert.match(source, /invokeFunction\(base44, 'notifyParents', \{ kind: 'diary', recordId: entry\.id \}\)/);
  assert.match(source, /invokeFunction\(base44, 'aiAssist', \{/);
});

test('notifyParents/entry.ts escapes student name, reason and diary fields', () => {
  const source = read('base44/functions/notifyParents/entry.ts');
  assert.match(source, /function escapeHtml\(/);
  assert.match(source, /escapeHtml\(student\?\.first_name\)/);
  assert.match(source, /escapeHtml\(student\?\.last_name\)/);
  assert.match(source, /escapeHtml\(reason\)/);
  assert.match(source, /escapeHtml\(record\.notes_text\)/);
  assert.match(source, /escapeHtml\(record\.teacher_message\)/);
  assert.match(source, /escapeHtml\(record\.teacher_name\)/);
});

test('sendNotificationEmail/_templates.ts escapes every interpolated field (server-side mirror of templates.js)', () => {
  const source = read('base44/functions/sendNotificationEmail/_templates.ts');
  const mustBeEscaped = [
    'userName', 'userEmail', 'roleName',
    'studentName', 'conceptName', 'amountLabel', 'dueDateLabel',
    'eventTitle', 'dateLabel', 'timeLabel', 'locationLabel', 'deadlineLabel',
    'message',
    'ticketNumber', 'subjectText', 'requesterName', 'categoryLabel', 'priorityLabel', 'slaDateLabel', 'description',
    'replyBody', 'resolutionNote',
  ];
  for (const field of mustBeEscaped) {
    assert.match(
      source,
      new RegExp(`escapeHtml\\(${field}(\\s*\\|\\|[^)]*)?\\)`),
      `expected ${field} to be routed through escapeHtml(...) in _templates.ts`
    );
  }
});
