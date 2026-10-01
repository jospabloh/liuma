import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Send, Loader2, Sparkles, ArrowLeft, SquarePen, RotateCcw, AlertCircle, Lock } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { base44 } from '@/api/base44Client';
import LumiMarkdown from '@/components/lumi/LumiMarkdown';
import {
  buildCapabilityRequest,
  evaluateCapabilityAccess,
  buildDeniedCapabilityResponse,
} from '@/lib/lumi/capabilities';
import {
  LUMI_REPLY_TIMEOUT_MS,
  conversationStorageKey,
  countUserTurns,
  followUpsFor,
  getDisplayPayload,
  hasReplyForTurn,
  mergeConversationMessages,
  mergeTimeline,
  messagesFromResponse,
  nextPollDelay,
  pendingToolLabel,
  pollDelayWithBackoff,
  quickActionTitleFor,
  quickActionsFor,
  shouldPoll,
  userMessageIdForTurn,
  visibleMessages,
} from '@/lib/lumi/chat';
import { AUDIT_ENTITIES, logAuditEvent } from '@/lib/audit';

// Mounted only while open (GlobalLumiBubble renders it inside AnimatePresence
// and lazy-loads it, which keeps react-markdown out of the main chunk). State
// that must outlive a close — the conversation — goes to sessionStorage.

const TEXTAREA_MAX_HEIGHT = 160;

function readStoredConversationId(key) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredConversationId(key, id) {
  try {
    if (id) window.sessionStorage.setItem(key, id);
    else window.sessionStorage.removeItem(key);
  } catch {
    // Private mode / storage disabled: the chat still works, it just won't
    // survive a reload.
  }
}

// Audit logging is best-effort and must never block or break a send: an
// AuditLog failure used to surface as an unhandled rejection with no reply.
function logAiDecision(userProfile, conversationId, request, decision, reason) {
  logAuditEvent({
    user: { id: userProfile?.user_id || 'unknown', email: null },
    userProfile,
    entity: AUDIT_ENTITIES.AI_INTERACTION,
    entityId: conversationId || `denied-${Date.now()}`,
    action: decision === 'allow' ? 'AI_REQUEST_ALLOWED' : 'AI_REQUEST_DENIED',
    reason,
    context: {
      intent: request.intent,
      role: request.context.user_role,
      capability: request.intent,
      scope: request.context.school_id,
      policy_decision: decision,
      entities_touched: request.inputs?.entities || [],
    },
  }).catch((error) => console.warn('Lumi audit log failed:', error));
}

let noticeSeq = 0;
const nextNoticeId = () => {
  noticeSeq += 1;
  return noticeSeq;
};

export default function LumiChat({ onClose, userProfile }) {
  const role = userProfile?.app_role || 'PARENT';
  const storageKey = conversationStorageKey(userProfile?.user_id || userProfile?.id);

  const [messages, setMessages] = useState([]);
  const [notices, setNotices] = useState([]);
  const [input, setInput] = useState('');
  const [conversationId, setConversationId] = useState(null);
  const [connecting, setConnecting] = useState(true);
  // { expectedUserTurns, prompt } while the typing indicator is up (until
  // the reply or the 30s timeout), else null.
  const [awaiting, setAwaiting] = useState(null);
  // { expectedUserTurns, sentAt } from a successful send until its reply is
  // on screen — it outlives the timeout: the chat keeps polling for it.
  const [pendingReply, setPendingReply] = useState(null);
  const [sending, setSending] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);

  const messagesEndRef = useRef(null);
  const dialogRef = useRef(null);
  const textareaRef = useRef(null);
  const lastPromptRef = useRef('');
  // Latest server messages, for the reply-timeout callback (which must not
  // restart its 30s clock on every streamed update).
  const messagesRef = useRef([]);
  // When the socket last delivered anything (0 = never): polling only runs
  // while it is quiet, so a working socket costs no extra requests.
  const lastSocketUpdateRef = useRef(0);
  // The conversation a late poll belongs to; a reply for a conversation the
  // user already replaced must not land in the new one.
  const conversationIdRef = useRef(null);
  const titleId = useId();

  const addNotice = useCallback((notice) => {
    setNotices((prev) => [...prev, { id: nextNoticeId(), ...notice }]);
  }, []);

  const clearErrorNotices = useCallback(() => {
    setNotices((prev) => prev.filter((notice) => notice.kind === 'denied'));
  }, []);

  // --- Conversation lifecycle -------------------------------------------

  const startConversation = useCallback(async ({ fresh = false } = {}) => {
    setConnecting(true);
    clearErrorNotices();
    try {
      const storedId = fresh ? null : readStoredConversationId(storageKey);
      if (storedId) {
        try {
          const existing = await base44.agents.getConversation(storedId);
          if (existing?.id) {
            setMessages(existing.messages || []);
            setConversationId(existing.id);
            return;
          }
        } catch (error) {
          // Expired or not ours any more: fall through to a new one.
          console.warn('Lumi: stored conversation unavailable, starting a new one', error);
        }
      }
      const conversation = await base44.agents.createConversation({
        agent_name: 'lumi',
        metadata: {
          name: 'Chat con Lumi',
          user_role: role,
          authorization_scope: {
            school_id: userProfile?.school_id || null,
            role,
          },
        },
      });
      if (!conversation?.id) throw new Error('createConversation returned no id');
      writeStoredConversationId(storageKey, conversation.id);
      setMessages(conversation.messages || []);
      setConversationId(conversation.id);
    } catch (error) {
      console.error('Error creating conversation:', error);
      setConversationId(null);
      addNotice({
        kind: 'error',
        afterMessageId: null,
        text: 'No pude conectarme con Lumi. Revisa tu conexión e intenta de nuevo.',
        retry: { type: 'connect' },
      });
    } finally {
      setConnecting(false);
    }
  }, [addNotice, clearErrorNotices, role, storageKey, userProfile?.school_id]);

  useEffect(() => {
    startConversation();
    // Only on mount: the conversation is per open chat, not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    conversationIdRef.current = conversationId;
    if (!conversationId) return undefined;
    lastSocketUpdateRef.current = 0;
    let unsubscribe = () => {};
    try {
      unsubscribe = base44.agents.subscribeToConversation(conversationId, (data) => {
        lastSocketUpdateRef.current = Date.now();
        // Merge, never replace: the SDK's copy predates what polling added.
        setMessages((prev) => mergeConversationMessages(prev, data?.messages));
      });
    } catch (error) {
      // No socket at all: polling (below) carries the replies.
      console.warn('Lumi: live updates unavailable, polling instead', error);
    }
    return () => {
      try {
        unsubscribe?.();
      } catch {
        // A socket that never connected may also fail to unsubscribe.
      }
    };
  }, [conversationId]);

  // Fetch the conversation over HTTPS while a reply is owed and the socket is
  // quiet (QA r5: the socket never connected and the answer, already on the
  // server, never reached the screen).
  const refreshConversation = useCallback(async (id) => {
    if (!id) return null;
    const conversation = await base44.agents.getConversation(id);
    const incoming = messagesFromResponse(conversation);
    if (!incoming || conversationIdRef.current !== id) return null;
    setMessages((prev) => mergeConversationMessages(prev, incoming));
    // What the screen will hold, for a caller deciding whether to re-ask
    // (the state updater itself may run later).
    return mergeConversationMessages(messagesRef.current, incoming);
  }, []);

  useEffect(() => {
    if (!conversationId || !pendingReply) return undefined;
    let cancelled = false;
    let timer = null;
    // Consecutive failed reads: each one doubles the next wait (capped).
    let failures = 0;
    const schedule = () => {
      const base = nextPollDelay(Date.now() - pendingReply.sentAt);
      if (base === null) return;
      timer = setTimeout(async () => {
        if (cancelled) return;
        // A background tab skips the read (the next visible tick catches up).
        const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
        if (!hidden && shouldPoll(Date.now(), lastSocketUpdateRef.current)) {
          try {
            await refreshConversation(conversationId);
            failures = 0;
          } catch (error) {
            failures += 1;
            console.warn('Lumi: polling the conversation failed', error);
          }
        }
        if (!cancelled) schedule();
      }, pollDelayWithBackoff(base, failures));
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [conversationId, pendingReply, refreshConversation]);

  const startNewConversation = () => {
    writeStoredConversationId(storageKey, null);
    setMessages([]);
    setNotices([]);
    setAwaiting(null);
    setPendingReply(null);
    setConversationId(null);
    startConversation({ fresh: true });
  };

  // --- Waiting for the reply --------------------------------------------

  // The echo of the user's own message arrives first; the wait only ends
  // when an assistant turn with text exists after it (hasReplyForTurn).
  useEffect(() => {
    messagesRef.current = messages;
    if (awaiting && hasReplyForTurn(messages, awaiting.expectedUserTurns)) {
      setAwaiting(null);
    }
    if (pendingReply && hasReplyForTurn(messages, pendingReply.expectedUserTurns)) {
      setPendingReply(null);
    }
    setNotices((prev) => {
      let changed = false;
      const next = [];
      for (const notice of prev) {
        if (notice.kind !== 'timeout') {
          next.push(notice);
          continue;
        }
        // A reply that lands after the timeout notice makes the notice (and
        // its Reintentar, which would re-ask the same question) wrong: drop it.
        if (hasReplyForTurn(messages, notice.expectedUserTurns)) {
          changed = true;
          continue;
        }
        // The server's copy of the question arrived: show the notice under
        // it rather than above it.
        const anchor = userMessageIdForTurn(messages, notice.expectedUserTurns);
        if (anchor && anchor !== notice.afterMessageId) {
          next.push({ ...notice, afterMessageId: anchor });
          changed = true;
          continue;
        }
        next.push(notice);
      }
      return changed ? next : prev;
    });
  }, [messages, awaiting, pendingReply]);

  useEffect(() => {
    if (!awaiting) return undefined;
    const timer = setTimeout(() => {
      setAwaiting(null);
      const current = messagesRef.current;
      const shown = visibleMessages(current);
      addNotice({
        kind: 'timeout',
        // Under the user's own question once the server has it; otherwise
        // after the last thing on screen, never at the top of a long chat.
        afterMessageId: userMessageIdForTurn(current, awaiting.expectedUserTurns)
          || (shown.length ? shown[shown.length - 1].id : null),
        expectedUserTurns: awaiting.expectedUserTurns,
        // The question itself: shown with the notice until the server's copy
        // arrives, so a slow reply never erases what the user asked.
        prompt: awaiting.prompt,
        text: 'Lumi está tardando más de lo normal. Seguimos esperando su respuesta; si no aparece, intenta de nuevo.',
        retry: { type: 'send', prompt: awaiting.prompt, intent: awaiting.intent },
      });
    }, LUMI_REPLY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [awaiting, addNotice]);

  const isBusy = connecting || sending || Boolean(awaiting);

  // --- Sending -----------------------------------------------------------

  const handleSend = async ({ intent, prompt, inputs } = {}) => {
    const typed = prompt === undefined;
    const messageText = (prompt ?? input).trim();
    if (!messageText || isBusy || !conversationId) return;

    const shown = visibleMessages(messages);
    const afterMessageId = shown.length ? shown[shown.length - 1].id : null;

    const capabilityRequest = buildCapabilityRequest({ intent, prompt: messageText, inputs, userProfile });
    const access = evaluateCapabilityAccess({ intent: capabilityRequest.intent, request: capabilityRequest });

    if (!access.allowed) {
      logAiDecision(userProfile, conversationId, capabilityRequest, 'deny', access.denial?.reason || 'Capability policy denied');
      const denied = buildDeniedCapabilityResponse({ intent: capabilityRequest.intent, denial: access.denial });
      addNotice({
        kind: 'denied',
        afterMessageId,
        prompt: messageText,
        text: `${denied.message}\n\n${denied.safe_alternative}`,
      });
      if (typed) setInput('');
      return;
    }

    clearErrorNotices();
    lastPromptRef.current = messageText;
    if (typed) setInput('');
    setSending(true);

    // A question still waiting for its reply counts too: the server has it
    // even if its echo never reached this screen.
    const expectedUserTurns = Math.max(countUserTurns(messages), pendingReply?.expectedUserTurns || 0) + 1;
    // Set before the request so the user's words show immediately (see the
    // optimistic bubble below) even if the socket echo is slow.
    setAwaiting({ expectedUserTurns, prompt: messageText, intent });

    try {
      logAiDecision(userProfile, conversationId, capabilityRequest, 'allow', 'Capability policy allowed');
      // addMessage only needs the id — no extra getConversation round trip.
      const sent = await base44.agents.addMessage({ id: conversationId }, {
        role: 'user',
        content: JSON.stringify(capabilityRequest),
      });
      // Whatever the server echoed back goes on screen now, socket or not.
      const echoed = messagesFromResponse(sent);
      if (echoed && conversationIdRef.current === conversationId) {
        setMessages((prev) => mergeConversationMessages(prev, echoed));
      }
      setPendingReply({ expectedUserTurns, sentAt: Date.now() });
    } catch (error) {
      console.error('Error sending message:', error);
      setAwaiting(null);
      // Give the user their words back instead of swallowing them.
      if (typed) setInput((current) => current || messageText);
      addNotice({
        kind: 'error',
        afterMessageId,
        text: 'No se pudo enviar tu mensaje. Revisa tu conexión e intenta de nuevo.',
        retry: { type: 'send', prompt: messageText, intent },
      });
    } finally {
      setSending(false);
    }
  };

  const handleRetry = async (notice) => {
    setNotices((prev) => prev.filter((item) => item.id !== notice.id));
    // The button that had focus is about to unmount with its notice.
    textareaRef.current?.focus({ preventScroll: true });
    if (notice.retry?.type === 'connect') {
      startConversation();
      return;
    }
    if (notice.retry?.type === 'send') {
      // A timed-out question already reached the server: look before asking
      // it twice — the answer may be there.
      if (notice.kind === 'timeout') {
        try {
          const merged = await refreshConversation(conversationId);
          if (merged && hasReplyForTurn(merged, notice.expectedUserTurns)) return;
        } catch (error) {
          console.warn('Lumi: could not check for a late reply', error);
        }
      }
      if (input.trim() === notice.retry.prompt) setInput('');
      handleSend({ prompt: notice.retry.prompt, intent: notice.retry.intent });
    }
  };

  // --- Dialog behaviour --------------------------------------------------

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, notices, awaiting]);

  useEffect(() => {
    const trigger = document.activeElement;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    // Desktop: straight into the input. Phones: focusing the textarea would
    // pop the keyboard over the quick actions, so focus the first control.
    const wide = typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 768px)').matches;
    if (wide) textareaRef.current?.focus({ preventScroll: true });
    else dialog.querySelector('button:not([disabled])')?.focus({ preventScroll: true });

    const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      // Skip display:none controls too: the header has a phone-only "Volver"
      // and a desktop-only "Cerrar". Wrapping to a hidden one is a no-op
      // focus() after preventDefault, which left Tab stuck on the last
      // control.
      const focusable = Array.from(dialog.querySelectorAll(selector))
        .filter((el) => !el.hasAttribute('disabled')
          && el.getAttribute('aria-hidden') !== 'true'
          && el.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      // Focus can land on <body> when the focused control unmounts (e.g. a
      // Reintentar button whose notice was dismissed): pull it back in.
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // On document, not the dialog: Escape must still close after focus fell
    // back to <body>.
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (trigger && typeof trigger.focus === 'function' && document.contains(trigger)) trigger.focus();
    };
  }, [onClose]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return undefined;
    const viewport = window.visualViewport;
    const updateKeyboardInset = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboardInset(inset > 0 ? inset : 0);
    };
    updateKeyboardInset();
    viewport.addEventListener('resize', updateKeyboardInset);
    viewport.addEventListener('scroll', updateKeyboardInset);
    return () => {
      viewport.removeEventListener('resize', updateKeyboardInset);
      viewport.removeEventListener('scroll', updateKeyboardInset);
    };
  }, []);

  // Auto-grow the textarea with its content, up to a cap, then scroll.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
  }, [input]);

  const handleTextareaKeyDown = (event) => {
    // Enter sends, Shift+Enter is a newline. Never send mid-IME composition
    // (accents typed via dead keys, dictation) — that would cut the message.
    // Safari reports the composition-ending Enter as keyCode 229 with
    // isComposing already false.
    const composing = event.nativeEvent.isComposing || event.keyCode === 229;
    if (event.key === 'Enter' && !event.shiftKey && !composing) {
      event.preventDefault();
      handleSend();
    }
  };

  // --- Rendering -----------------------------------------------------------

  const shownMessages = useMemo(() => visibleMessages(messages), [messages]);
  const timeline = useMemo(() => mergeTimeline(shownMessages, notices), [shownMessages, notices]);
  const toolLabel = pendingToolLabel(messages);
  const quickActions = quickActionsFor(role);
  const lastShown = shownMessages[shownMessages.length - 1];
  const showFollowUps = !isBusy && conversationId && lastShown?.role === 'assistant';
  const followUps = showFollowUps ? followUpsFor(role, lastPromptRef.current) : [];
  // Starter prompts stay until there is a real exchange, so a connection
  // error or a denied chip does not leave the user with nothing to tap.
  // A timed-out question is an exchange too: it stays on screen (with its
  // notice) instead of the starter list.
  const isEmpty = shownMessages.length === 0 && !awaiting && !notices.some((notice) => notice.kind === 'timeout');
  const optimisticPrompt = awaiting && countUserTurns(messages) < awaiting.expectedUserTurns ? awaiting.prompt : null;

  const renderNotice = (notice) => {
    // The question of a timed-out turn, until the server's copy is on screen.
    const unconfirmedPrompt = notice.kind === 'timeout' && notice.prompt
      && countUserTurns(messages) < notice.expectedUserTurns ? notice.prompt : null;
    if (unconfirmedPrompt) {
      return (
        <div className="space-y-2">
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl bg-brand px-4 py-3 text-white">
              <p className="whitespace-pre-wrap break-words text-sm">{unconfirmedPrompt}</p>
            </div>
          </div>
          {renderNotice({ ...notice, prompt: null })}
        </div>
      );
    }
    if (notice.kind === 'denied') {
      return (
        <div className="space-y-2">
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl bg-brand px-4 py-3 text-white">
              <p className="whitespace-pre-wrap break-words text-sm">{notice.prompt}</p>
            </div>
          </div>
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-3 text-foreground">
              <p className="flex items-start gap-2 whitespace-pre-wrap text-sm">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>{notice.text}</span>
              </p>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="flex justify-start" role="alert">
        <div className="max-w-[85%] rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          <p className="flex items-start gap-2 text-sm">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{notice.text}</span>
          </p>
          {notice.retry && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleRetry(notice)}
              disabled={notice.retry.type === 'send' && (isBusy || !conversationId)}
              className="mt-2 h-8 rounded-full border-red-300 bg-transparent text-red-800 hover:bg-red-100 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-900/40"
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Reintentar
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <motion.div
      className="fixed inset-0 z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Backdrop is a SIBLING of the dialog: aria-hidden on an ancestor hid
          the whole assistant from VoiceOver/TalkBack. */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="absolute bottom-0 left-0 right-0 h-[100dvh] max-h-[100dvh] md:h-[600px] md:max-h-[600px] md:w-[400px] md:right-6 md:bottom-6 md:left-auto md:rounded-2xl bg-card shadow-2xl flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        style={{ maxHeight: 'calc(100dvh - env(safe-area-inset-top))' }}
      >
        {/* Header */}
        <div
          className="bg-gradient-to-r from-[var(--tenant-accent)] to-[var(--tenant-primary)] p-4 flex items-center gap-2"
          style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}
        >
          {/* Full-screen on phones, so a back arrow reads naturally there. */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Volver"
            className="text-white hover:bg-white/20 rounded-full md:hidden"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 shrink-0 rounded-full bg-white/20 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3 id={titleId} className="font-semibold text-white">Lumi</h3>
              <p className="text-xs text-white/80">Tu asistente escolar</p>
            </div>
          </div>
          {shownMessages.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={startNewConversation}
              disabled={connecting}
              aria-label="Nueva conversación"
              title="Nueva conversación"
              className="text-white hover:bg-white/20 rounded-full"
            >
              <SquarePen className="w-5 h-5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Cerrar"
            title="Cerrar"
            className="hidden text-white hover:bg-white/20 rounded-full md:inline-flex"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Messages */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4" aria-live="polite" aria-relevant="additions">
          {isEmpty && (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-brand/10 flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8 text-brand" aria-hidden="true" />
              </div>
              <h4 className="font-semibold text-foreground mb-2">¡Hola! Soy Lumi</h4>
              <p className="text-muted-foreground text-sm mb-6">
                {connecting ? 'Conectando con Lumi…' : '¿En qué te puedo ayudar hoy?'}
              </p>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                {quickActionTitleFor(role)}
              </p>
              <div className="space-y-2">
                {quickActions.map((action) => (
                  <button
                    key={action.intent}
                    type="button"
                    onClick={() => handleSend({ intent: action.intent, prompt: action.label })}
                    disabled={isBusy || !conversationId}
                    className="mobile-touch-target block w-full text-left px-4 py-3 rounded-xl bg-muted hover:bg-muted/80 text-foreground text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {timeline.map((item) => {
            if (item.type === 'notice') {
              return <div key={item.key}>{renderNotice(item.notice)}</div>;
            }
            const msg = item.message;
            const payload = getDisplayPayload(msg.content, msg.role);
            return (
              <motion.div
                key={item.key}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    msg.role === 'user' ? 'bg-brand text-white' : 'bg-muted text-foreground'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <p className="whitespace-pre-wrap break-words text-sm">{payload.text}</p>
                  ) : (
                    <div>
                      <LumiMarkdown>{payload.text}</LumiMarkdown>
                      {Array.isArray(payload.meta?.sources) && payload.meta.sources.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Fuente: {payload.meta.sources.join(', ')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}

          {optimisticPrompt && (
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl bg-brand px-4 py-3 text-white">
                <p className="whitespace-pre-wrap break-words text-sm">{optimisticPrompt}</p>
              </div>
            </div>
          )}

          {(awaiting || sending) && (
            <div className="flex justify-start" role="status">
              <div className="bg-muted rounded-2xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-brand" aria-hidden="true" />
                  <span className="text-sm text-muted-foreground">
                    {toolLabel || 'Lumi está escribiendo…'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {followUps.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Sugerencias">
              {followUps.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => handleSend({ intent: chip.intent, prompt: chip.label })}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-muted transition-colors"
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div
          className="p-4 border-t border-border bg-card"
          style={{ paddingBottom: `calc(1rem + env(safe-area-inset-bottom) + ${keyboardInset}px)` }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-end gap-2"
          >
            <Textarea
              ref={textareaRef}
              rows={1}
              aria-label="Escribe un mensaje para Lumi"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              placeholder="Escribe tu pregunta..."
              enterKeyHint="send"
              className="mobile-input-no-zoom min-h-[48px] flex-1 resize-none rounded-3xl bg-muted border-0 px-4 py-3 leading-snug focus-visible:ring-2 focus-visible:ring-brand"
            />
            <Button
              type="submit"
              aria-label="Enviar mensaje"
              disabled={!input.trim() || isBusy || !conversationId}
              className="mobile-touch-target shrink-0 rounded-full w-12 h-12 bg-brand text-white hover:bg-brand/90"
            >
              <Send className="w-5 h-5" />
            </Button>
          </form>
        </div>
      </motion.div>
    </motion.div>
  );
}
