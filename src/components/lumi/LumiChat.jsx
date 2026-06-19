import React, { useState, useEffect, useRef, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Loader2, Sparkles, ArrowLeft } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { base44 } from '@/api/base44Client';
import ReactMarkdown from 'react-markdown';
import {
  LUMI_INTENTS,
  buildCapabilityRequest,
  evaluateCapabilityAccess,
  buildDeniedCapabilityResponse,
} from '@/lib/lumi/capabilities';
import { AUDIT_ENTITIES, logAuditEvent } from '@/lib/audit';

export default function LumiChat({ isOpen, onClose, userProfile }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const messagesEndRef = useRef(null);
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const titleId = useId();

  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    if (isOpen && !conversationId) {
      initConversation();
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!isOpen) {
      triggerRef.current?.focus();
      return;
    }

    triggerRef.current = document.activeElement;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length > 0) {
      focusable[0].focus();
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusableElements = Array.from(
        dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter((el) => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden'));

      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', handleKeyDown);
    return () => dialog.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);


  useEffect(() => {
    if (!isOpen || typeof window === 'undefined' || !window.visualViewport) {
      setKeyboardInset(0);
      return;
    }

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
  }, [isOpen]);

  useEffect(() => {
    if (!conversationId) return;
    
    const unsubscribe = base44.agents.subscribeToConversation(conversationId, (data) => {
      setMessages(data.messages || []);
      setIsLoading(false);
    });
    
    return () => unsubscribe();
  }, [conversationId]);

  const initConversation = async () => {
    try {
      const conversation = await base44.agents.createConversation({
        agent_name: "lumi",
        metadata: {
          name: "Chat con Lumi",
          user_role: userProfile?.app_role || 'PARENT',
          authorization_scope: {
            school_id: userProfile?.school_id || null,
            role: userProfile?.app_role || 'PARENT'
          }
        }
      });
      setConversationId(conversation.id);
    } catch (error) {
      console.error('Error creating conversation:', error);
    }
  };


  const getDisplayPayload = (rawContent, role) => {
    if (typeof rawContent !== 'string') return { text: String(rawContent || ''), meta: null };

    try {
      const parsed = JSON.parse(rawContent);
      if (role === 'user') {
        return { text: parsed.prompt || rawContent, meta: null };
      }

      if (parsed && typeof parsed === 'object') {
        return {
          text: parsed.message || parsed.response || rawContent,
          meta: parsed.meta || null,
        };
      }
    } catch (_) {
      return { text: rawContent, meta: null };
    }

    return { text: rawContent, meta: null };
  };

  const handleSend = async ({ intent, prompt, inputs } = {}) => {
    const messageText = (prompt ?? input).trim();
    if (!messageText || isLoading || !conversationId) return;

    const capabilityRequest = buildCapabilityRequest({
      intent,
      prompt: messageText,
      inputs,
      userProfile,
    });

    const access = evaluateCapabilityAccess({
      intent: capabilityRequest.intent,
      request: capabilityRequest,
    });

    if (!access.allowed) {
      await logAuditEvent({
        user: { id: userProfile?.user_id || 'unknown', email: null },
        userProfile,
        entity: AUDIT_ENTITIES.AI_INTERACTION,
        entityId: conversationId || `denied-${Date.now()}` ,
        action: 'AI_REQUEST_DENIED',
        reason: access.denial?.reason || 'Capability policy denied',
        context: { intent: capabilityRequest.intent, role: capabilityRequest.context.user_role, capability: capabilityRequest.intent, scope: capabilityRequest.context.school_id, policy_decision: 'deny', entities_touched: capabilityRequest.inputs?.entities || [] }
      });
      const denied = buildDeniedCapabilityResponse({
        intent: capabilityRequest.intent,
        denial: access.denial,
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: `🔒 ${denied.message}\n\n${denied.safe_alternative}` }]);
      setInput('');
      return;
    }

    setInput('');
    setIsLoading(true);

    try {
      const conversation = await base44.agents.getConversation(conversationId);
      await logAuditEvent({
        user: { id: userProfile?.user_id || 'unknown', email: null },
        userProfile,
        entity: AUDIT_ENTITIES.AI_INTERACTION,
        entityId: conversationId,
        action: 'AI_REQUEST_ALLOWED',
        reason: 'Capability policy allowed',
        context: { intent: capabilityRequest.intent, role: capabilityRequest.context.user_role, capability: capabilityRequest.intent, scope: capabilityRequest.context.school_id, policy_decision: 'allow', entities_touched: capabilityRequest.inputs?.entities || [] }
      });
      await base44.agents.addMessage(conversation, {
        role: 'user',
        content: JSON.stringify(capabilityRequest)
      });
    } catch (error) {
      console.error('Error sending message:', error);
      setIsLoading(false);
    }
  };

  const quickActionsByRole = {
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

  const quickActions = quickActionsByRole[userProfile?.app_role || 'PARENT'] || quickActionsByRole.PARENT;
  const roleQuickActionTitle = {
    ADMIN: 'Acciones rápidas de administración',
    TEACHER: 'Acciones rápidas para tu grupo',
    PARENT: 'Acciones rápidas para familia',
  };

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      aria-hidden="true"
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="absolute bottom-0 left-0 right-0 h-[100dvh] max-h-[100dvh] md:h-[600px] md:max-h-[600px] md:w-[400px] md:right-6 md:bottom-6 md:left-auto md:rounded-2xl bg-card shadow-2xl flex flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        style={{ maxHeight: 'calc(100dvh - env(safe-area-inset-top))' }}
      >
        {/* Header */}
        <div
          className="bg-gradient-to-r from-[var(--tenant-accent)] to-[var(--tenant-primary)] p-4 flex items-center gap-3"
          style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Volver"
            className="text-white hover:bg-white/20 rounded-full"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-3 flex-1">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 id={titleId} className="font-semibold text-white">Lumi</h3>
              <p className="text-xs text-white/80">Tu asistente escolar</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Volver"
            className="text-white hover:bg-white/20 rounded-full md:hidden"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Messages */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-brand/10 flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8 text-brand" />
              </div>
              <h4 className="font-semibold text-foreground mb-2">¡Hola! Soy Lumi</h4>
              <p className="text-muted-foreground text-sm mb-6">
                ¿En qué te puedo ayudar hoy?
              </p>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                {roleQuickActionTitle[userProfile?.app_role || 'PARENT'] || roleQuickActionTitle.PARENT}
              </p>
              <div className="space-y-2">
                {quickActions.map((action) => (
                  <button
                    key={action.intent}
                    onClick={() => handleSend({ intent: action.intent, prompt: action.label })}
                    className="mobile-touch-target block w-full text-left px-4 py-3 rounded-xl bg-muted hover:bg-muted/80 text-foreground text-sm transition-colors"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          
          <AnimatePresence>
            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-brand text-white'
                      : 'bg-muted text-foreground'
                  }`}
                >
                  {(() => {
                    const payload = getDisplayPayload(msg.content, msg.role);
                    return msg.role === 'user' ? (
                      <p className="text-sm">{payload.text}</p>
                    ) : (
                      <div>
                        <div className="text-sm prose prose-sm max-w-none">
                          <ReactMarkdown>{payload.text}</ReactMarkdown>
                        </div>
                        {Array.isArray(payload.meta?.sources) && payload.meta.sources.length > 0 && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Fuente: {payload.meta.sources.join(', ')}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          
          {isLoading && (
            <div className="flex justify-start" role="status" aria-live="polite">
              <div className="bg-muted rounded-2xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-brand" />
                  <span className="text-sm text-muted-foreground">Lumi está escribiendo...</span>
                </div>
              </div>
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
            className="flex gap-2"
          >
            <Input
              aria-label="Escribe un mensaje para Lumi"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe tu pregunta..."
              className="mobile-touch-target mobile-input-no-zoom flex-1 rounded-full bg-muted border-0 focus-visible:ring-2 focus-visible:ring-brand"
              disabled={isLoading}
            />
            <Button
              type="submit"
              aria-label="Enviar mensaje"
              disabled={!input.trim() || isLoading}
              className="mobile-touch-target rounded-full w-12 h-12 bg-brand text-white hover:bg-brand/90"
            >
              <Send className="w-5 h-5" />
            </Button>
          </form>
        </div>
      </motion.div>
    </motion.div>
  );
}
