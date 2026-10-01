// Pure state helpers for the Lumi chat (src/components/lumi/LumiChat.jsx).
//
// Kept import-free of '@/…' aliases so `node --test` loads it directly. The
// component owns effects and rendering; everything here decides WHAT the chat
// shows, which is the part that was wrong in production:
//   - the typing indicator cleared on the echo of the user's own message,
//   - an assistant message that only carried tool_calls rendered as an empty
//     grey bubble,
//   - a locally appended notice (a denied quick action) was wiped by the next
//     subscription update, because it lived in the same array the server owns.

import { LUMI_INTENTS } from './capabilities.js';

/** How long we wait for a non-empty assistant reply before telling the user. */
export const LUMI_REPLY_TIMEOUT_MS = 30000;

// --- Not depending on the socket (QA r5 on v1.8.2) -----------------------------
//
// Replies stream over the SDK's socket (subscribeToConversation). When that
// socket never connects — a proxy that blocks wss, a phone switching networks
// — no update ever arrives: the chat showed "Lumi está tardando…" after 30s
// and the user's question vanished, although the server had answered (GET
// conversation held the full reply). Now, while a reply is owed and the
// socket has been quiet, the chat polls the conversation over plain HTTPS,
// and the question stays on screen until the server's copy replaces it.

/** First poll and cadence while the reply is still expected soon. */
export const LUMI_POLL_INTERVAL_MS = 3000;
/** Cadence once the timeout notice is up: the reply may still land. */
export const LUMI_POLL_SLOW_INTERVAL_MS = 8000;
/** After this long without a reply, stop polling (Reintentar stays). */
export const LUMI_POLL_GIVE_UP_MS = 180000;
/** A socket update this recent means streaming works: skip that poll. */
export const LUMI_SOCKET_FRESH_MS = 5000;

/**
 * Delay before the next poll, given how long ago the question was sent, or
 * null to stop polling.
 */
export function nextPollDelay(elapsedMs) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  if (elapsed >= LUMI_POLL_GIVE_UP_MS) return null;
  return elapsed < LUMI_REPLY_TIMEOUT_MS ? LUMI_POLL_INTERVAL_MS : LUMI_POLL_SLOW_INTERVAL_MS;
}

/** Longest wait between polls while the read keeps failing. */
export const LUMI_POLL_MAX_BACKOFF_MS = 30000;

/**
 * The delay actually used: doubled per consecutive failed poll (a 429 or an
 * outage must not be hammered every 3s), capped, then spread ±20% so many
 * open chats do not poll in lockstep. `random` is injectable for tests.
 */
export function pollDelayWithBackoff(baseMs, failures = 0, random = Math.random) {
  const n = Math.max(0, Math.min(10, Number(failures) || 0));
  const backed = Math.min(LUMI_POLL_MAX_BACKOFF_MS, baseMs * 2 ** n);
  const r = Number(random());
  const jitter = 0.8 + 0.4 * (Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0.5);
  return Math.round(backed * jitter);
}

/** Whether a poll is worth making now (the socket has been quiet). */
export function shouldPoll(nowMs, lastSocketUpdateMs) {
  return !lastSocketUpdateMs || nowMs - lastSocketUpdateMs >= LUMI_SOCKET_FRESH_MS;
}

/**
 * The message list in an SDK response: a conversation ({ messages }) or a
 * single message ({ id, role }). Null when it is neither.
 */
export function messagesFromResponse(response) {
  if (Array.isArray(response?.messages)) return response.messages;
  if (response && typeof response === 'object' && response.id && response.role) return [response];
  return null;
}

function rawText(message) {
  const content = message?.content;
  return typeof content === 'string' ? content : '';
}

// Of two copies of the same message, the one to keep. The incoming copy wins
// unless it is an older snapshot of a reply still streaming (its text is a
// strict prefix of what is already on screen) — a poll must not rewind text
// the socket already delivered.
function fresher(current, incoming) {
  const a = rawText(current);
  const b = rawText(incoming);
  if (a.length > b.length && a.startsWith(b)) return current;
  // Same message, same state: keep the object on screen (no re-render).
  if (a === b && JSON.stringify(current) === JSON.stringify(incoming)) return current;
  return incoming;
}

/**
 * Merge a server snapshot (socket update, poll or addMessage response) into
 * what is on screen, never losing a message. The SDK's socket keeps its own
 * copy of the conversation from when it subscribed, so once a poll has added
 * messages, a later socket update can arrive WITHOUT them; replacing the list
 * would make the user's question disappear again. Known messages are updated
 * in place; new ones go right after the message that precedes them in the
 * snapshot (or at the end).
 */
export function mergeConversationMessages(current = [], incoming) {
  if (!Array.isArray(incoming)) return current;
  const base = Array.isArray(current) ? current : [];
  if (base.length === 0) return incoming;
  if (incoming.length === 0) return base;
  if (![...base, ...incoming].every((message) => message?.id)) {
    return incoming.length >= base.length ? incoming : base;
  }
  const result = [...base];
  const indexOf = (id) => result.findIndex((message) => message.id === id);
  let changed = false;
  incoming.forEach((message, i) => {
    const at = indexOf(message.id);
    if (at !== -1) {
      const kept = fresher(result[at], message);
      if (kept !== result[at]) {
        result[at] = kept;
        changed = true;
      }
      return;
    }
    const prev = i > 0 ? indexOf(incoming[i - 1].id) : -1;
    if (prev !== -1) result.splice(prev + 1, 0, message);
    else result.push(message);
    changed = true;
  });
  return changed ? result : base;
}

/** Id of the n-th (1-based) user message, or null. */
export function userMessageIdForTurn(messages = [], turn = 0) {
  let seen = 0;
  for (const message of messages) {
    if (message?.role !== 'user') continue;
    seen += 1;
    if (seen === turn) return message.id || null;
  }
  return null;
}

/** sessionStorage key for the current conversation, one per signed-in user. */
export function conversationStorageKey(userKey) {
  return `liuma.lumi.conversation.${userKey || 'anon'}`;
}

/**
 * Text to show for a stored message. User messages are sent as a JSON
 * envelope (see buildCapabilityRequest) and must display only the prompt;
 * assistant messages may be plain text or a JSON `{ message, meta }` shape.
 */
export function getDisplayPayload(rawContent, role) {
  if (rawContent == null) return { text: '', meta: null };
  if (typeof rawContent !== 'string') return { text: String(rawContent), meta: null };

  const trimmed = rawContent.trim();
  if (!trimmed.startsWith('{')) return { text: rawContent, meta: null };

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') return { text: rawContent, meta: null };
    if (role === 'user') {
      return { text: typeof parsed.prompt === 'string' ? parsed.prompt : rawContent, meta: null };
    }
    const text = parsed.message ?? parsed.response;
    return {
      text: typeof text === 'string' ? text : rawContent,
      meta: parsed.meta || null,
    };
  } catch {
    return { text: rawContent, meta: null };
  }
}

function hasText(message) {
  return getDisplayPayload(message?.content, message?.role).text.trim().length > 0;
}

function hasRunningToolCall(message) {
  return Array.isArray(message?.tool_calls)
    && message.tool_calls.some((call) => call?.status === 'running' || call?.status === 'waiting_for_user_input');
}

/**
 * Messages worth a bubble: user and assistant turns with actual text.
 * System messages and tool-call-only assistant turns are progress, not
 * content — rendering them produced empty bubbles.
 */
export function visibleMessages(messages = []) {
  return messages.filter((message) => (
    (message?.role === 'user' || message?.role === 'assistant') && hasText(message)
  ));
}

/**
 * True once the conversation holds at least `expectedUserTurns` user
 * messages AND an assistant message with text after the last of them whose
 * tools have finished. Counting user turns is what stops the echo of the
 * user's own message (which arrives first) from ending the wait: at that
 * moment the last assistant reply is the PREVIOUS turn's.
 */
export function hasReplyForTurn(messages = [], expectedUserTurns = 0) {
  let userTurns = 0;
  let lastUserIndex = -1;
  messages.forEach((message, index) => {
    if (message?.role === 'user') {
      userTurns += 1;
      lastUserIndex = index;
    }
  });
  if (userTurns < expectedUserTurns) return false;
  return messages
    .slice(lastUserIndex + 1)
    .some((message) => message?.role === 'assistant' && hasText(message) && !hasRunningToolCall(message));
}

export function countUserTurns(messages = []) {
  return messages.filter((message) => message?.role === 'user').length;
}

const TOOL_ENTITY_LABELS = {
  Attendance: 'la asistencia',
  Homework: 'las tareas',
  Notice: 'los avisos',
  NoticeDelivery: 'los avisos',
  ChargeItem: 'los pagos',
  PaymentRecord: 'los pagos',
  PaymentConcept: 'los pagos',
  DiaryEntry: 'la bitácora',
  WeeklyMenu: 'el menú',
  OfficialDocument: 'los documentos',
  UniformOrder: 'los pedidos de uniforme',
  Event: 'los eventos',
  Student: 'los alumnos',
  Classroom: 'los salones',
  SchoolSetupGuide: 'la guía de configuración',
};

/**
 * Label for the "Consultando…" chip while the agent is running tools and has
 * not written any text yet, e.g. 'Consultando la asistencia…'. Null when
 * there is nothing in progress to describe.
 */
export function pendingToolLabel(messages = []) {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant' || hasText(last)) return null;
  const calls = Array.isArray(last.tool_calls) ? last.tool_calls : [];
  const running = calls.filter((call) => call?.status === 'running');
  if (running.length === 0) return null;
  const name = String(running[running.length - 1]?.name || '');
  const entity = name.replace(/^(read|list|filter|query|get|create|update|delete)_?/i, '');
  const label = TOOL_ENTITY_LABELS[entity];
  return label ? `Consultando ${label}…` : 'Consultando…';
}

/**
 * Merge server messages with local notices (denied quick actions, send or
 * timeout errors). Notices live in their own state so a subscription update
 * — which replaces the whole message list — cannot erase them; each one is
 * anchored after the message that was last on screen when it was raised.
 */
export function mergeTimeline(messages = [], notices = []) {
  const byAnchor = new Map();
  for (const notice of notices) {
    const key = notice.afterMessageId || null;
    if (!byAnchor.has(key)) byAnchor.set(key, []);
    byAnchor.get(key).push({ type: 'notice', key: `notice-${notice.id}`, notice });
  }

  const knownIds = new Set(messages.map((message) => message.id));
  const timeline = [];
  // Notices anchored to nothing (or to a message that is no longer shown)
  // go where they were raised relative to what is known: at the top when the
  // chat was empty, at the end otherwise.
  const orphans = [];
  for (const [key, items] of byAnchor) {
    if (key === null) timeline.push(...items);
    else if (!knownIds.has(key)) orphans.push(...items);
  }

  messages.forEach((message, index) => {
    timeline.push({ type: 'message', key: message.id || `message-${index}`, message });
    if (message.id && byAnchor.has(message.id)) timeline.push(...byAnchor.get(message.id));
  });

  return [...timeline, ...orphans];
}

// Starter prompts and follow-up chips per role. Every intent here must be one
// the role's capability rule allows (a test enforces it): a suggestion that
// Lumi then refuses is worse than no suggestion.
export const QUICK_ACTIONS_BY_ROLE = {
  ADMIN: [
    { label: 'Resumen de asistencia general', intent: LUMI_INTENTS.ATTENDANCE_STATUS },
    { label: 'Seguimiento de pagos pendientes', intent: LUMI_INTENTS.PAYMENT_REMINDERS },
    { label: 'Resumen de avisos importantes', intent: LUMI_INTENTS.NOTICES_SUMMARY },
  ],
  TEACHER: [
    { label: 'Resumen de asistencia de mi grupo', intent: LUMI_INTENTS.ATTENDANCE_STATUS },
    { label: 'Reporte de conducta del día', intent: LUMI_INTENTS.BEHAVIOR_RECAP },
    { label: 'Tareas activas por salón', intent: LUMI_INTENTS.HOMEWORK_LOOKUP },
  ],
  PARENT: [
    { label: '¿Qué tarea hay hoy?', intent: LUMI_INTENTS.HOMEWORK_LOOKUP },
    { label: '¿Cómo va la asistencia?', intent: LUMI_INTENTS.ATTENDANCE_STATUS },
    { label: '¿Qué pagos tengo pendientes?', intent: LUMI_INTENTS.PAYMENT_REMINDERS },
  ],
};

export const QUICK_ACTION_TITLE_BY_ROLE = {
  ADMIN: 'Acciones rápidas de administración',
  TEACHER: 'Acciones rápidas para tu grupo',
  PARENT: 'Acciones rápidas para familia',
};

export const FOLLOW_UPS_BY_ROLE = {
  ADMIN: [
    { label: '¿Quién faltó hoy?', intent: LUMI_INTENTS.ATTENDANCE_STATUS },
    { label: '¿Qué pagos están vencidos?', intent: LUMI_INTENTS.PAYMENT_REMINDERS },
    { label: '¿Qué avisos salieron esta semana?', intent: LUMI_INTENTS.NOTICES_SUMMARY },
  ],
  TEACHER: [
    { label: '¿Quién faltó hoy en mi grupo?', intent: LUMI_INTENTS.ATTENDANCE_STATUS },
    { label: '¿Qué tareas vencen esta semana?', intent: LUMI_INTENTS.HOMEWORK_LOOKUP },
    { label: '¿Hay avisos nuevos?', intent: LUMI_INTENTS.NOTICES_SUMMARY },
  ],
  PARENT: [
    { label: '¿Hay avisos nuevos?', intent: LUMI_INTENTS.NOTICES_SUMMARY },
    { label: '¿Qué tarea hay para mañana?', intent: LUMI_INTENTS.HOMEWORK_LOOKUP },
    { label: '¿Cómo le fue hoy?', intent: LUMI_INTENTS.BEHAVIOR_RECAP },
  ],
};

function normalizeRole(role) {
  return QUICK_ACTIONS_BY_ROLE[role] ? role : 'PARENT';
}

export function quickActionsFor(role) {
  return QUICK_ACTIONS_BY_ROLE[normalizeRole(role)];
}

export function quickActionTitleFor(role) {
  return QUICK_ACTION_TITLE_BY_ROLE[normalizeRole(role)];
}

/**
 * Follow-up chips after an answer: the role's list minus anything the user
 * just asked, capped at three so the chips never push the input off-screen.
 */
export function followUpsFor(role, lastPrompt = '') {
  const asked = String(lastPrompt || '').trim().toLowerCase();
  return FOLLOW_UPS_BY_ROLE[normalizeRole(role)]
    .filter((chip) => chip.label.toLowerCase() !== asked)
    .slice(0, 3);
}

/**
 * Whether a new question may be sent. Replies are matched to their question
 * by turn position (hasReplyForTurn), so while one reply is still pending a
 * second question would let the late first answer pass for the second one.
 * Re-asking the pending question itself (the timeout's Reintentar) is fine.
 */
export function canAskNewQuestion({ pendingReply, retryOfPending = false } = {}) {
  return !pendingReply || retryOfPending;
}
