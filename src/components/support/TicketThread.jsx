import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Send } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { SUPPORT_AUTHOR_ROLE } from '@/lib/support/constants';

const AUTHOR_LABELS = {
  [SUPPORT_AUTHOR_ROLE.REQUESTER]: 'Tú / Solicitante',
  [SUPPORT_AUTHOR_ROLE.AI]: 'Lumi',
  [SUPPORT_AUTHOR_ROLE.SCHOOL_ADMIN]: 'Dirección',
  [SUPPORT_AUTHOR_ROLE.OWNER]: 'Equipo LIUMA',
  [SUPPORT_AUTHOR_ROLE.SYSTEM]: 'Sistema',
};

function messageAlignment(authorRole, viewerIsStaff) {
  const isStaffMessage = authorRole !== SUPPORT_AUTHOR_ROLE.REQUESTER && authorRole !== SUPPORT_AUTHOR_ROLE.AI;
  // Staff see their own messages on the right; requesters see theirs on the right.
  return isStaffMessage === viewerIsStaff ? 'justify-end' : 'justify-start';
}

/**
 * Threaded conversation for a ticket with an optional reply box. `viewerIsStaff`
 * controls bubble alignment and is passed through to `onReply`.
 */
export default function TicketThread({ messages = [], onReply, viewerIsStaff = false, disabled = false }) {
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!reply.trim() || sending) return;
    setSending(true);
    try {
      await onReply(reply.trim());
      setReply('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">Aún no hay mensajes.</p>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${messageAlignment(msg.author_role, viewerIsStaff)}`}>
            <div className="max-w-[85%] rounded-2xl px-4 py-2.5 bg-muted text-foreground">
              <p className="text-[11px] font-semibold text-muted-foreground mb-1">
                {AUTHOR_LABELS[msg.author_role] || msg.author_role}
                {(msg.created_date || msg.created_at) && (
                  <span className="font-normal text-muted-foreground">
                    {' · '}
                    {format(new Date(msg.created_date || msg.created_at), "d MMM HH:mm", { locale: es })}
                  </span>
                )}
              </p>
              <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
            </div>
          </div>
        ))}
      </div>

      {onReply && !disabled && (
        <div className="flex gap-2 items-end border-t border-border pt-3">
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Escribe una respuesta..."
            rows={2}
            className="flex-1 resize-none"
          />
          <Button onClick={handleSend} disabled={!reply.trim() || sending} className="shrink-0">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      )}
    </div>
  );
}
