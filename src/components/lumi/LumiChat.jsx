import React, { useState, useEffect, useRef } from 'react';
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

  useEffect(() => {
    if (isOpen && !conversationId) {
      initConversation();
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
        context: { intent: capabilityRequest.intent, entities_touched: capabilityRequest.inputs?.entities || [], policy_decision: 'deny' }
      });
      const denied = buildDeniedCapabilityResponse({
        intent: capabilityRequest.intent,
        denial: access.denial,
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: denied.message }]);
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
        context: { intent: capabilityRequest.intent, entities_touched: capabilityRequest.inputs?.entities || [], policy_decision: 'allow' }
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

  const quickActions = [
    { label: '¿Qué tarea hay hoy?', intent: LUMI_INTENTS.HOMEWORK_LOOKUP },
    { label: '¿Cómo va la asistencia?', intent: LUMI_INTENTS.ATTENDANCE_STATUS },
    { label: '¿Hay avisos importantes?', intent: LUMI_INTENTS.NOTICES_SUMMARY },
    { label: '¿Qué pagos tengo pendientes?', intent: LUMI_INTENTS.PAYMENT_REMINDERS },
    { label: '¿Cómo estuvo mi hijo hoy?', intent: LUMI_INTENTS.BEHAVIOR_RECAP },
    { label: '¿Qué citas o eventos vienen?', intent: LUMI_INTENTS.SCHEDULE_APPOINTMENTS },
  ];

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="absolute bottom-0 left-0 right-0 h-[85vh] md:h-[600px] md:w-[400px] md:right-6 md:bottom-6 md:left-auto md:rounded-2xl bg-white shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-violet-600 to-indigo-700 p-4 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-white hover:bg-white/20 rounded-full"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-3 flex-1">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Lumi</h3>
              <p className="text-xs text-white/80">Tu asistente escolar</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-white hover:bg-white/20 rounded-full md:hidden"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-violet-100 flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8 text-violet-600" />
              </div>
              <h4 className="font-semibold text-slate-800 mb-2">¡Hola! Soy Lumi</h4>
              <p className="text-slate-500 text-sm mb-6">
                ¿En qué te puedo ayudar hoy?
              </p>
              <div className="space-y-2">
                {quickActions.map((action) => (
                  <button
                    key={action.intent}
                    onClick={() => handleSend({ intent: action.intent, prompt: action.label })}
                    className="block w-full text-left px-4 py-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 text-sm transition-colors"
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
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-800'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <p className="text-sm">{msg.content}</p>
                  ) : (
                    <div className="text-sm prose prose-sm max-w-none">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-slate-100 rounded-2xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                  <span className="text-sm text-slate-500">Lumi está escribiendo...</span>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t bg-white">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex gap-2"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe tu pregunta..."
              className="flex-1 rounded-full bg-slate-50 border-0 focus-visible:ring-2 focus-visible:ring-indigo-500"
              disabled={isLoading}
            />
            <Button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="rounded-full w-12 h-12 bg-indigo-600 hover:bg-indigo-700"
            >
              <Send className="w-5 h-5" />
            </Button>
          </form>
        </div>
      </motion.div>
    </motion.div>
  );
}