import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FOLLOW_UPS_BY_ROLE,
  QUICK_ACTIONS_BY_ROLE,
  conversationStorageKey,
  followUpsFor,
  getDisplayPayload,
  canAskNewQuestion,
  hasReplyForTurn,
  mergeConversationMessages,
  mergeTimeline,
  messagesFromResponse,
  nextPollDelay,
  pendingToolLabel,
  pollDelayWithBackoff,
  LUMI_POLL_MAX_BACKOFF_MS,
  shouldPoll,
  userMessageIdForTurn,
  visibleMessages,
  LUMI_POLL_GIVE_UP_MS,
  LUMI_POLL_INTERVAL_MS,
  LUMI_POLL_SLOW_INTERVAL_MS,
  LUMI_REPLY_TIMEOUT_MS,
  LUMI_SOCKET_FRESH_MS,
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

// --- QA r5 on v1.8.2: the socket never connected ------------------------------
// The user sent a question, nothing came back over the socket, and 30s later
// the question was gone behind "Lumi está tardando…" — while GET conversation
// already held the full answer.

test('while a reply is owed the chat polls, faster before the timeout, then gives up', () => {
  assert.equal(nextPollDelay(0), LUMI_POLL_INTERVAL_MS);
  assert.ok(LUMI_POLL_INTERVAL_MS < LUMI_REPLY_TIMEOUT_MS / 5, 'several polls before the timeout notice');
  assert.equal(nextPollDelay(LUMI_REPLY_TIMEOUT_MS + 1), LUMI_POLL_SLOW_INTERVAL_MS);
  assert.equal(nextPollDelay(LUMI_POLL_GIVE_UP_MS), null);
  // A live socket makes polling unnecessary; a quiet one does not.
  assert.equal(shouldPoll(10_000, 0), true);
  assert.equal(shouldPoll(10_000, 10_000 - 1000), false);
  assert.equal(shouldPoll(10_000, 10_000 - LUMI_SOCKET_FRESH_MS), true);
});

test('a polled conversation puts the question and the reply on screen', () => {
  const before = [user('u1', 'Hola'), assistant('a1', '¡Hola!')];
  const polled = [...before, user('u2', '¿Qué tarea hay?'), assistant('a2', 'Hay 2 tareas.')];
  const merged = mergeConversationMessages(before, messagesFromResponse({ id: 'conv', messages: polled }));
  assert.deepEqual(merged.map((m) => m.id), ['u1', 'a1', 'u2', 'a2']);
  assert.equal(hasReplyForTurn(merged, 2), true);
});

test('a stale socket snapshot never removes what a poll already showed', () => {
  // The SDK's socket keeps its own copy from when it subscribed: after a poll
  // added u2/a2, its next update can arrive without u2.
  const onScreen = [user('u1', 'Hola'), assistant('a1', '¡Hola!'), user('u2', '¿Tareas?'), assistant('a2', 'Hay 2')];
  const socket = [user('u1', 'Hola'), assistant('a1', '¡Hola!'), assistant('a2', 'Hay 2 tareas.')];
  const merged = mergeConversationMessages(onScreen, socket);
  assert.deepEqual(merged.map((m) => m.id), ['u1', 'a1', 'u2', 'a2']);
  assert.equal(merged[3].content, 'Hay 2 tareas.');
});

test('a poll never rewinds a reply the socket is streaming', () => {
  const streaming = [user('u1', 'x'), assistant('a1', 'Hay 2 tareas para el martes')];
  const olderPoll = [user('u1', 'x'), assistant('a1', 'Hay 2 tar')];
  assert.equal(mergeConversationMessages(streaming, olderPoll), streaming, 'unchanged list, no re-render');
  const edited = [user('u1', 'x'), assistant('a1', 'Corregido')];
  assert.equal(mergeConversationMessages(streaming, edited)[1].content, 'Corregido');
});

test('the addMessage response is merged whether it is a message or a conversation', () => {
  assert.deepEqual(messagesFromResponse(user('u9', 'hola')).map((m) => m.id), ['u9']);
  assert.equal(messagesFromResponse({ id: 'conv', messages: [] }).length, 0);
  assert.equal(messagesFromResponse(undefined), null);
  assert.equal(messagesFromResponse({ ok: true }), null);
  const merged = mergeConversationMessages([user('u1', 'a'), assistant('a1', 'b')], [user('u2', 'c')]);
  assert.deepEqual(merged.map((m) => m.id), ['u1', 'a1', 'u2']);
  assert.deepEqual(mergeConversationMessages([], [user('u1', 'a')]).map((m) => m.id), ['u1']);
  assert.deepEqual(mergeConversationMessages([user('u1', 'a')], null).map((m) => m.id), ['u1']);
});

test('the timeout notice is anchored under the question once the server has it', () => {
  const messages = [user('u1', 'a'), assistant('a1', 'b'), user('u2', 'c')];
  assert.equal(userMessageIdForTurn(messages, 2), 'u2');
  assert.equal(userMessageIdForTurn(messages, 3), null);
});

test('LumiChat keeps the question, polls without the socket and checks before re-asking', () => {
  const src = readFileSync(new URL('../../src/components/lumi/LumiChat.jsx', import.meta.url), 'utf8');
  // Polling while a reply is owed, through the SDK's HTTPS read.
  assert.match(src, /base44\.agents\.getConversation\(id\)/);
  assert.match(src, /nextPollDelay\(Date\.now\(\) - pendingReply\.sentAt\)/);
  assert.match(src, /shouldPoll\(Date\.now\(\), lastSocketUpdateRef\.current\)/);
  // Socket updates merge; they no longer replace the list.
  assert.doesNotMatch(src, /setMessages\(data\?\.messages \|\| \[\]\)/);
  assert.match(src, /mergeConversationMessages\(prev, data\?\.messages\)/);
  // The timeout notice carries the question and renders it until the echo.
  assert.match(src, /prompt: awaiting\.prompt,\n\s+text: 'Lumi está tardando/);
  assert.match(src, /unconfirmedPrompt/);
  // Reintentar looks for a late answer before asking twice.
  assert.match(src, /if \(merged && hasReplyForTurn\(merged, notice\.expectedUserTurns\)\) return;/);
});

test('polling backs off on failed reads and is jittered, never faster than ±20%', () => {
  const mid = () => 0.5;
  assert.equal(pollDelayWithBackoff(LUMI_POLL_INTERVAL_MS, 0, mid), LUMI_POLL_INTERVAL_MS);
  assert.equal(pollDelayWithBackoff(LUMI_POLL_INTERVAL_MS, 1, mid), LUMI_POLL_INTERVAL_MS * 2);
  assert.equal(pollDelayWithBackoff(LUMI_POLL_INTERVAL_MS, 50, mid), LUMI_POLL_MAX_BACKOFF_MS);
  assert.equal(pollDelayWithBackoff(LUMI_POLL_INTERVAL_MS, 0, () => 0), LUMI_POLL_INTERVAL_MS * 0.8);
  assert.equal(pollDelayWithBackoff(LUMI_POLL_INTERVAL_MS, 0, () => 1), LUMI_POLL_INTERVAL_MS * 1.2);
  assert.equal(pollDelayWithBackoff(LUMI_POLL_INTERVAL_MS, 0, () => NaN), LUMI_POLL_INTERVAL_MS);
  const src = readFileSync(new URL('../../src/components/lumi/LumiChat.jsx', import.meta.url), 'utf8');
  assert.match(src, /pollDelayWithBackoff\(base, failures\)/);
  assert.match(src, /document\.visibilityState === 'hidden'/);
});

// Replies are matched to questions by position. If a second question could be
// sent while the first reply is pending, a late first answer landing after
// question 2 satisfies hasReplyForTurn(…, 2) and polling stops before the
// real second answer — with no socket, it would never appear.
test('a new question waits for the pending reply; re-asking the same one does not', () => {
  const lateFirstAnswer = [
    { id: 'u1', role: 'user', content: 'pregunta 1' },
    { id: 'u2', role: 'user', content: 'pregunta 2' },
    { id: 'a1', role: 'assistant', content: 'respuesta a la 1' },
  ];
  assert.equal(hasReplyForTurn(lateFirstAnswer, 2), true, 'the positional match is why a second send must wait');
  const pendingReply = { expectedUserTurns: 1, sentAt: 0 };
  assert.equal(canAskNewQuestion({ pendingReply }), false);
  assert.equal(canAskNewQuestion({ pendingReply, retryOfPending: true }), true);
  assert.equal(canAskNewQuestion({ pendingReply: null }), true);
});

// Live QA of v1.8.3: addMessage answered with the FINAL assistant message
// alone, so the screen held [final]; the next poll [user, a1, a2, final]
// was anchored around it and the question landed after its own answer.
// hasReplyForTurn then found no reply, the chat showed "tardando…" and the
// composer stayed locked for 3 minutes.
test('a poll after addMessage returned the final answer keeps the question before it', () => {
  const onScreen = [assistant('final', 'Respuesta')];
  const polled = [user('u1', 'pregunta'), { id: 'a1', role: 'assistant', content: '' }, assistant('final', 'Respuesta')];
  const merged = mergeConversationMessages(onScreen, polled);
  assert.deepEqual(merged.map((m) => m.id), ['u1', 'a1', 'final']);
  assert.equal(hasReplyForTurn(merged, 1), true);
});

test('an unknown message with no known predecessor goes before the next known one', () => {
  const onScreen = [user('u0', 'antes'), assistant('a0', 'r0'), assistant('final', 'Respuesta')];
  // A socket snapshot missing u0/a0 (stale copy) plus the new question.
  const socket = [user('u1', 'pregunta'), assistant('final', 'Respuesta')];
  const merged = mergeConversationMessages(onScreen, socket);
  assert.deepEqual(merged.map((m) => m.id), ['u0', 'a0', 'u1', 'final']);
});
