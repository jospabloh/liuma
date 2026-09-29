import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FOLLOW_UPS_BY_ROLE,
  QUICK_ACTIONS_BY_ROLE,
  conversationStorageKey,
  followUpsFor,
  getDisplayPayload,
  hasReplyForTurn,
  mergeTimeline,
  pendingToolLabel,
  visibleMessages,
} from '../../src/lib/lumi/chat.js';
import { buildCapabilityRequest, evaluateCapabilityAccess } from '../../src/lib/lumi/capabilities.js';

const user = (id, prompt) => ({ id, role: 'user', content: JSON.stringify({ prompt }) });
const assistant = (id, content, tool_calls) => ({ id, role: 'assistant', content, tool_calls });

test('typing indicator survives the echo of the user\'s own message', () => {
  // Turn 1 already answered; the user sends turn 2. The first update back is
  // just their own message — the previous answer must not end the wait.
  const before = [user('u1', 'Hola'), assistant('a1', '¡Hola!')];
  assert.equal(hasReplyForTurn(before, 2), false, 'nothing sent yet for turn 2');
  const echo = [...before, user('u2', '¿Qué tarea hay?')];
  assert.equal(hasReplyForTurn(echo, 2), false, 'echo alone is not a reply');
  const toolOnly = [...echo, assistant('a2', '', [{ name: 'read_Homework', status: 'running' }])];
  assert.equal(hasReplyForTurn(toolOnly, 2), false, 'a tool call with no text is not a reply');
  const answered = [...echo, assistant('a2', 'Hay 2 tareas.', [{ name: 'read_Homework', status: 'success' }])];
  assert.equal(hasReplyForTurn(answered, 2), true);
});

test('tool-call-only and system messages never render as empty bubbles', () => {
  const shown = visibleMessages([
    user('u1', 'Asistencia'),
    assistant('a1', '', [{ name: 'read_Attendance', status: 'success' }]),
    assistant('a2', null),
    { id: 's1', role: 'system', content: 'internal' },
    assistant('a3', 'Todos presentes.'),
  ]);
  assert.deepEqual(shown.map((m) => m.id), ['u1', 'a3']);
});

test('the pending chip names what Lumi is consulting', () => {
  const messages = [user('u1', 'x'), assistant('a1', '', [{ name: 'read_Attendance', status: 'running' }])];
  assert.equal(pendingToolLabel(messages), 'Consultando la asistencia…');
  assert.equal(pendingToolLabel([user('u1', 'x'), assistant('a1', '', [{ name: 'mystery_tool', status: 'running' }])]), 'Consultando…');
  assert.equal(pendingToolLabel([user('u1', 'x'), assistant('a1', 'Listo')]), null);
});

test('local notices survive a subscription update that replaces every message', () => {
  const notices = [{ id: 1, kind: 'denied', afterMessageId: 'a1' }];
  const first = mergeTimeline([user('u1', 'a'), assistant('a1', 'b')], notices);
  assert.deepEqual(first.map((i) => i.key), ['u1', 'a1', 'notice-1']);
  // The server pushes the whole list again with a new turn: the notice stays
  // where it was raised instead of vanishing.
  const next = mergeTimeline([user('u1', 'a'), assistant('a1', 'b'), user('u2', 'c')], notices);
  assert.deepEqual(next.map((i) => i.key), ['u1', 'a1', 'notice-1', 'u2']);
  // Raised on an empty chat: shows first.
  assert.deepEqual(mergeTimeline([], [{ id: 2, afterMessageId: null }]).map((i) => i.key), ['notice-2']);
});

test('user bubbles show the prompt, not the JSON envelope', () => {
  assert.equal(getDisplayPayload(JSON.stringify({ prompt: 'Hola', context: {} }), 'user').text, 'Hola');
  assert.equal(getDisplayPayload('**hola**', 'assistant').text, '**hola**');
  assert.equal(getDisplayPayload('{"message":"Hola","meta":{"sources":["Notice"]}}', 'assistant').meta.sources[0], 'Notice');
  assert.equal(getDisplayPayload('{no json', 'assistant').text, '{no json');
});

test('every suggestion chip is one the role is allowed to ask', () => {
  // A chip that Lumi then refuses is worse than no chip.
  for (const table of [QUICK_ACTIONS_BY_ROLE, FOLLOW_UPS_BY_ROLE]) {
    for (const [role, chips] of Object.entries(table)) {
      for (const chip of chips) {
        const request = buildCapabilityRequest({
          intent: chip.intent,
          prompt: chip.label,
          userProfile: { app_role: role, school_id: 'school-a' },
        });
        const decision = evaluateCapabilityAccess({ intent: chip.intent, request });
        assert.equal(decision.allowed, true, `${role} would be denied "${chip.label}"`);
      }
    }
  }
});

test('follow-ups skip what was just asked and stay at three or fewer', () => {
  const asked = FOLLOW_UPS_BY_ROLE.PARENT[0].label;
  const chips = followUpsFor('PARENT', asked);
  assert.equal(chips.some((c) => c.label === asked), false);
  assert.ok(chips.length <= 3 && chips.length > 0);
  assert.deepEqual(followUpsFor('UNKNOWN_ROLE'), FOLLOW_UPS_BY_ROLE.PARENT.slice(0, 3));
});

test('the stored conversation is per user', () => {
  assert.notEqual(conversationStorageKey('user-a'), conversationStorageKey('user-b'));
});

test('the corner ThemeSwitcher sits above the Lumi bubble on phones and desktop', () => {
  // Module 12 regression: at 5.25rem the switcher (z-50) covered Lumi's
  // centre on phones, so tapping Lumi opened the theme selector. Derive both
  // positions from source so moving either one without the other fails here.
  const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');
  const bubble = readFileSync(new URL('../../src/components/lumi/GlobalLumiBubble.jsx', import.meta.url), 'utf8');
  const button = readFileSync(new URL('../../src/components/ui/LumiButton.jsx', import.meta.url), 'utf8');

  const rem = (tailwindStep) => Number(tailwindStep) / 4;
  const cls = bubble.match(/<LumiButton[^>]*className="([^"]+)"/)[1];
  const mobileBottom = rem(cls.match(/(?:^|\s)bottom-(\d+)/)[1]);
  const desktopBottom = rem(cls.match(/md:bottom-(\d+)/)[1]);
  const mobileHeight = rem(button.match(/(?:\s)h-(\d+)/)[1]);
  const desktopHeight = rem(button.match(/md:h-(\d+)/)[1]);

  // The lift applies only while the bubble is on screen (html[data-lumi-bubble]
  // is set by GlobalLumiBubble), so read the values under that selector.
  const desktopVar = Number(css.match(/^html\[data-lumi-bubble\]\s*\{\s*--theme-switcher-bottom:\s*([\d.]+)rem/m)[1]);
  const mobileVar = Number(css.match(/max-width:\s*767px\)\s*\{\s*html\[data-lumi-bubble\]\s*\{\s*--theme-switcher-bottom:\s*([\d.]+)rem/)[1]);

  assert.ok(mobileVar >= mobileBottom + mobileHeight + 0.5, `phone: switcher ${mobileVar}rem vs Lumi top ${mobileBottom + mobileHeight}rem`);
  assert.ok(desktopVar >= desktopBottom + desktopHeight + 0.5, `desktop: switcher ${desktopVar}rem vs Lumi top ${desktopBottom + desktopHeight}rem`);
  assert.match(css, /html\[data-lumi-open\] \[data-theme-switcher\]\s*\{\s*visibility:\s*hidden/);
  assert.match(bubble, /'data-lumi-bubble'/, 'GlobalLumiBubble must set the attribute the CSS keys off');
});
