import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Sparkles } from 'lucide-react';
import { SUPPORT_CATEGORIES, SUPPORT_PRIORITIES, DEFAULT_CATEGORY, DEFAULT_PRIORITY, SUPPORT_CHANNEL, AI_INTAKE_KIND_BY_CATEGORY } from '@/lib/support/constants';
import { resolveSupportRouting } from '@/lib/support/routing';
import { SUPPORT_TIER } from '@/lib/support/constants';
import { captureClientContext } from '@/lib/support/diagnostics';
import { composeTicketBody } from '@/lib/support/aiIntake';
import AiIntakeChat from '@/components/support/AiIntakeChat';
import { CATEGORY_LABELS, PRIORITY_LABELS } from './labels.jsx';

/**
 * Form to open (and immediately escalate) a support ticket. The Lumi L0
 * deflection happens before this opens; this captures a request the AI could
 * not solve. A small note tells the requester who will receive it, so the
 * two-tier routing isn't a surprise.
 *
 * For FEATURE (nueva funcionalidad) and TECHNICAL (incidencia) categories, an
 * AI "BA/PO" assistant interviews the requester before the ticket is created and
 * builds a structured brief; the brief is embedded in the description (Markdown)
 * and attached as `ai_brief`. Every other category keeps the plain form.
 */
export default function NewTicketDialog({ open, onOpenChange, userProfile, onSubmit, initialDescription = '' }) {
  const [step, setStep] = useState('form'); // 'form' | 'ai'
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [priority, setPriority] = useState(DEFAULT_PRIORITY);
  const [description, setDescription] = useState(initialDescription);
  const [submitting, setSubmitting] = useState(false);

  const routing = resolveSupportRouting({ requesterRole: userProfile?.app_role, category });
  const destinationLabel = routing.tier === SUPPORT_TIER.PLATFORM
    ? 'al equipo de LIUMA'
    : 'a la dirección de tu escuela';

  // 'bug' | 'feature' | undefined — categories that open the AI intake.
  const intakeKind = AI_INTAKE_KIND_BY_CATEGORY[category];

  const reset = () => {
    setStep('form');
    setSubject('');
    setCategory(DEFAULT_CATEGORY);
    setPriority(DEFAULT_PRIORITY);
    setDescription(initialDescription);
  };

  const handleOpenChange = (next) => {
    if (!next) reset();
    onOpenChange(next);
  };

  /**
   * Create the ticket. When a `brief` comes from the AI intake, the description
   * is enriched with the Markdown spec (so it reaches the thread, the escalation
   * email and Mission Control) and the structured brief is attached as `ai_brief`.
   *
   * @param {object | null} [brief]
   */
  const finalize = async (brief) => {
    setSubmitting(true);
    try {
      /** @type {Record<string, any>} */
      const payload = {
        subject: subject.trim(),
        description: brief ? composeTicketBody(description.trim(), brief) : description.trim(),
        category,
        priority,
        channelOrigin: SUPPORT_CHANNEL.MANUAL,
        // Smart hook: bundle the technical context so the requester only has to
        // write what went wrong (screen, app version, browser, recent logs).
        clientContext: captureClientContext(),
      };
      if (brief) {
        payload.aiAttempted = true;
        payload.aiBrief = brief;
      }
      await onSubmit(payload);
      reset();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!subject.trim() || !description.trim() || submitting) return;
    // FEATURE / TECHNICAL run the AI interview first; the ticket is created once
    // the requester confirms the brief (or opts out of the assistant).
    if (intakeKind) {
      setStep('ai');
      return;
    }
    finalize(null);
  };

  const dialogTitle = step === 'ai'
    ? (intakeKind === 'bug' ? 'Reportar una incidencia' : 'Sugerir una funcionalidad')
    : 'Crear ticket de soporte';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          {step === 'form' && (
            <DialogDescription>
              Tu solicitud se enviará {destinationLabel} y recibirás un número de ticket para darle seguimiento.
            </DialogDescription>
          )}
        </DialogHeader>

        {step === 'ai' ? (
          <AiIntakeChat
            kind={intakeKind}
            subject={subject.trim()}
            description={description.trim()}
            saving={submitting}
            onBack={() => setStep('form')}
            onComplete={(brief) => finalize(brief)}
          />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ticket-subject">Asunto</Label>
              <Input
                id="ticket-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Resumen breve del problema"
                maxLength={120}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ticket-category">Categoría</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="ticket-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(SUPPORT_CATEGORIES).map((value) => (
                    <SelectItem key={value} value={value}>{CATEGORY_LABELS[value]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ticket-priority">Prioridad</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="ticket-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(SUPPORT_PRIORITIES).map((value) => (
                    <SelectItem key={value} value={value}>{PRIORITY_LABELS[value]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ticket-description">Descripción</Label>
              <Textarea
                id="ticket-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Cuéntanos qué pasó, con el mayor detalle posible."
                rows={5}
                required
              />
            </div>

            {intakeKind && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Sparkles className="w-3.5 h-3.5 text-brand shrink-0 mt-0.5" />
                Un asistente experto te hará unas preguntas para dejar tu solicitud lista para el equipo.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)} disabled={submitting}>
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting || !subject.trim() || !description.trim()} className="gap-2">
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {intakeKind ? (<><Sparkles className="w-4 h-4" /> Continuar con el asistente</>) : 'Enviar ticket'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
