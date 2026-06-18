import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { LifeBuoy, Plus, Sparkles, MessageSquare, ChevronRight } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createPageUrl } from '@/utils';
import { listMyTickets, listTicketMessages, createSupportTicket, addSupportMessage } from '@/lib/support/tickets';
import { SUPPORT_AUTHOR_ROLE, SUPPORT_STATUS } from '@/lib/support/constants';
import NewTicketDialog from '@/components/support/NewTicketDialog';
import TicketThread from '@/components/support/TicketThread';
import { SupportStatusBadge, SupportPriorityBadge } from '@/components/support/labels.jsx';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export default function Soporte() {
  const queryClient = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [activeTicket, setActiveTicket] = useState(null);

  const { data: user } = useQuery({ queryKey: ['currentUser'], queryFn: () => base44.auth.me() });

  const { data: userProfile } = useQuery({
    queryKey: ['userProfile', user?.id],
    queryFn: async () => {
      const profiles = await base44.entities.UserProfile.filter({ user_id: user.id });
      return profiles[0];
    },
    enabled: !!user,
  });

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ['mySupportTickets', user?.id],
    queryFn: () => listMyTickets(user),
    enabled: !!user,
  });

  const { data: messages = [] } = useQuery({
    queryKey: ['supportTicketMessages', activeTicket?.id],
    queryFn: () => listTicketMessages(activeTicket.id),
    enabled: !!activeTicket,
  });

  const handleCreate = async (payload) => {
    try {
      const ticket = await createSupportTicket({ user, userProfile, ...payload });
      toast.success(`Ticket ${ticket.ticket_number} creado. Te daremos seguimiento.`);
      queryClient.invalidateQueries({ queryKey: ['mySupportTickets', user?.id] });
    } catch (error) {
      toast.error('No se pudo crear el ticket. Intenta de nuevo.');
      throw error;
    }
  };

  const handleReply = async (body) => {
    await addSupportMessage({ user, userProfile, ticket: activeTicket, body, authorRole: SUPPORT_AUTHOR_ROLE.REQUESTER });
    queryClient.invalidateQueries({ queryKey: ['supportTicketMessages', activeTicket.id] });
    queryClient.invalidateQueries({ queryKey: ['mySupportTickets', user?.id] });
  };

  if (isLoading) return <LoadingScreen message="Cargando soporte..." />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 pb-24">
      <PageHeader title="Soporte y ayuda" showBack backTo={createPageUrl('Home')} />

      {/* How it works */}
      <Card className="p-4 mb-4 bg-violet-50 border-violet-100">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-violet-600 mt-0.5 shrink-0" />
          <div className="text-sm text-slate-700 space-y-1">
            <p className="font-semibold text-slate-800">¿Cómo funciona?</p>
            <p>1. Pregúntale a <strong>Lumi</strong>: resuelve muchas dudas al instante con el manual de la app.</p>
            <p>2. Si Lumi no puede ayudarte, crea un <strong>ticket</strong>: se asigna un número y se envía a la dirección de tu escuela o al equipo LIUMA según el caso.</p>
            <p>3. Da seguimiento aquí mismo hasta que se resuelva.</p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <Button variant="outline" className="h-auto py-3 flex-col gap-1" onClick={() => window.dispatchEvent(new CustomEvent('lumi:open'))}>
          <Sparkles className="w-5 h-5 text-violet-600" />
          <span className="text-sm">Preguntar a Lumi</span>
        </Button>
        <Button className="h-auto py-3 flex-col gap-1" onClick={() => setNewOpen(true)}>
          <Plus className="w-5 h-5" />
          <span className="text-sm">Crear ticket</span>
        </Button>
      </div>

      <h2 className="text-sm font-semibold text-slate-500 mb-2">Mis tickets</h2>

      {tickets.length === 0 ? (
        <EmptyState icon={LifeBuoy} title="Sin tickets" description="Cuando crees una solicitud de soporte aparecerá aquí." />
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket, index) => (
            <motion.div key={ticket.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
              <Card className="p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActiveTicket(ticket)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-mono text-slate-400">{ticket.ticket_number}</p>
                    <p className="font-medium text-slate-800 truncate">{ticket.subject}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <SupportStatusBadge status={ticket.status} />
                      <SupportPriorityBadge priority={ticket.priority} />
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-300 shrink-0" />
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <NewTicketDialog open={newOpen} onOpenChange={setNewOpen} userProfile={userProfile} onSubmit={handleCreate} />

      <Dialog open={!!activeTicket} onOpenChange={() => setActiveTicket(null)}>
        <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-violet-600" />
              {activeTicket?.subject}
            </DialogTitle>
          </DialogHeader>
          {activeTicket && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="font-mono text-slate-400">{activeTicket.ticket_number}</span>
                <SupportStatusBadge status={activeTicket.status} />
                <SupportPriorityBadge priority={activeTicket.priority} />
                {activeTicket.created_date && (
                  <span className="text-slate-400">{format(new Date(activeTicket.created_date), "d MMM yyyy", { locale: es })}</span>
                )}
              </div>
              <TicketThread
                messages={messages}
                onReply={handleReply}
                viewerIsStaff={false}
                disabled={activeTicket.status === SUPPORT_STATUS.CLOSED}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
