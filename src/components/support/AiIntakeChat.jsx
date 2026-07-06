import { useState, useEffect, useRef } from 'react';
import { Sparkles, Send, Loader2, CheckCircle2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { intakeTurn, briefToMarkdown, MAX_QUESTIONS } from '@/lib/support/aiIntake';

/**
 * AiIntakeChat — entrevista conversacional del "BA/PO experto".
 *
 * Hace preguntas de descubrimiento (una a la vez, adaptándose a las respuestas)
 * y al terminar muestra el brief estructurado. El usuario confirma y se crea el
 * ticket con la especificación lista para el desarrollador.
 *
 * @param {{
 *   kind: 'feature'|'bug',
 *   subject: string,
 *   description: string,
 *   onComplete: (brief: object | null) => void,   // el padre arma el body + crea el ticket
 *   onBack: () => void,
 *   saving?: boolean,
 * }} props
 */
export default function AiIntakeChat({ kind, subject, description, onComplete, onBack, saving = false }) {
  // messages: [{ role: 'ai'|'user', text, suggestions? }]
  const [messages, setMessages] = useState([]);
  const [history, setHistory] = useState([]); // [{ question, answer }]
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(true);
  const [brief, setBrief] = useState(null);
  const [error, setError] = useState('');
  const [pendingQuestion, setPendingQuestion] = useState(''); // pregunta a la que responderá el siguiente turno
  const scrollRef = useRef(null);
  const startedRef = useRef(false);

  const pushAi = (text, suggestions) => setMessages((m) => [...m, { role: 'ai', text, suggestions }]);

  // Corre un turno de la entrevista con el history dado.
  const runTurn = async (hist) => {
    setThinking(true);
    setError('');
    try {
      const res = await intakeTurn(kind, { subject, description, history: hist });
      if (res.done && res.brief) {
        setBrief(res.brief);
        pushAi('¡Listo! Preparé el resumen para el equipo. Revísalo y créalo. 👇');
      } else {
        const text = res.question?.text || 'Cuéntame un poco más para poder ayudarte.';
        pushAi(text, res.question?.suggestions);
        // Guardamos el texto de la pregunta pendiente para emparejarla con la respuesta.
        setPendingQuestion(text);
      }
    } catch {
      setError('La IA no está disponible en este momento. Puedes crear tu ticket sin el asistente.');
    } finally {
      setThinking(false);
    }
  };

  // Arranque: primera pregunta a partir de la descripción inicial.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    runTurn([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll al último mensaje.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking]);

  const submitAnswer = (raw) => {
    const answer = (raw ?? input).trim();
    if (!answer || thinking || brief) return;
    setMessages((m) => [...m, { role: 'user', text: answer }]);
    setInput('');
    const nextHistory = [...history, { question: pendingQuestion, answer }];
    setHistory(nextHistory);
    runTurn(nextHistory);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAnswer(); }
  };

  return (
    <div className="flex flex-col" style={{ maxHeight: '70vh' }}>
      <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 mb-3">
        <Sparkles className="w-4 h-4 text-brand shrink-0" />
        <p className="text-xs text-muted-foreground">
          Un asistente experto te hará unas preguntas para que el equipo pueda resolverlo más rápido.
          Máximo {MAX_QUESTIONS} preguntas.
        </p>
      </div>

      {/* Hilo de la conversación */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-[220px]">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
              m.role === 'user'
                ? 'bg-primary text-primary-foreground rounded-br-sm'
                : 'bg-muted text-foreground rounded-bl-sm'}`}>
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.role === 'ai' && i === messages.length - 1 && Array.isArray(m.suggestions) && m.suggestions.length > 0 && !brief && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.suggestions.map((s, j) => (
                    <button key={j} onClick={() => submitAnswer(s)} disabled={thinking}
                      className="rounded-full border border-brand/30 bg-background px-2.5 py-1 text-xs text-foreground hover:bg-brand/10 disabled:opacity-50">
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Analizando…
            </div>
          </div>
        )}
      </div>

      {/* Brief final */}
      {brief && (
        <div className="mt-3 rounded-lg border border-brand/30 bg-brand/10 p-3 max-h-56 overflow-y-auto">
          <div className="flex items-center gap-2 mb-1.5">
            <CheckCircle2 className="w-4 h-4 text-brand" />
            <p className="text-sm font-semibold">Resumen para el equipo</p>
          </div>
          <pre className="whitespace-pre-wrap font-sans text-xs text-muted-foreground leading-relaxed">{briefToMarkdown(brief)}</pre>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      {/* Entrada / acciones */}
      <div className="mt-3 border-t border-border pt-3">
        {!brief ? (
          <>
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={thinking || !!error}
                placeholder="Escribe tu respuesta…"
                className="min-h-10 max-h-32 bg-background"
              />
              <Button onClick={() => submitAnswer()} disabled={thinking || !input.trim()} className="gap-1.5 shrink-0">
                <Send className="w-4 h-4" />
              </Button>
            </div>
            <div className="mt-2 flex justify-between">
              <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 text-muted-foreground">
                <ArrowLeft className="w-4 h-4" /> Volver
              </Button>
              {error && (
                <Button variant="outline" size="sm" onClick={() => onComplete(null)} disabled={saving}>
                  Crear sin asistente
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" onClick={onBack} className="flex-1">Ajustar</Button>
            <Button onClick={() => onComplete(brief)} disabled={saving} className="flex-1 gap-2">
              <CheckCircle2 className="w-4 h-4" /> {saving ? 'Creando…' : 'Crear ticket'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
