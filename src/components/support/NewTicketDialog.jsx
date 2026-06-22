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
import { Loader2 } from 'lucide-react';
import { SUPPORT_CATEGORIES, SUPPORT_PRIORITIES, DEFAULT_CATEGORY, DEFAULT_PRIORITY, SUPPORT_CHANNEL } from '@/lib/support/constants';
import { resolveSupportRouting } from '@/lib/support/routing';
import { SUPPORT_TIER } from '@/lib/support/constants';
import { captureClientContext } from '@/lib/support/diagnostics';
import { CATEGORY_LABELS, PRIORITY_LABELS } from './labels.jsx';

/**
 * Form to open (and immediately escalate) a support ticket. The Lumi L0
 * deflection happens before this opens; this captures a request the AI could
 * not solve. A small note tells the requester who will receive it, so the
 * two-tier routing isn't a surprise.
 */
export default function NewTicketDialog({ open, onOpenChange, userProfile, onSubmit, initialDescription = '' }) {
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [priority, setPriority] = useState(DEFAULT_PRIORITY);
  const [description, setDescription] = useState(initialDescription);
  const [submitting, setSubmitting] = useState(false);

  const routing = resolveSupportRouting({ requesterRole: userProfile?.app_role, category });
  const destinationLabel = routing.tier === SUPPORT_TIER.PLATFORM
    ? 'al equipo de LIUMA'
    : 'a la dirección de tu escuela';

  const reset = () => {
    setSubject('');
    setCategory(DEFAULT_CATEGORY);
    setPriority(DEFAULT_PRIORITY);
    setDescription(initialDescription);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!subject.trim() || !description.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        subject: subject.trim(),
        description: description.trim(),
        category,
        priority,
        channelOrigin: SUPPORT_CHANNEL.MANUAL,
        // Smart hook: bundle the technical context so the requester only has to
        // write what went wrong (screen, app version, browser, recent logs).
        clientContext: captureClientContext(),
      });
      reset();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Crear ticket de soporte</DialogTitle>
          <DialogDescription>
            Tu solicitud se enviará {destinationLabel} y recibirás un número de ticket para darle seguimiento.
          </DialogDescription>
        </DialogHeader>

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

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting || !subject.trim() || !description.trim()}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Enviar ticket
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
