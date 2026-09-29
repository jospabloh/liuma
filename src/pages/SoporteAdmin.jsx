import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { toast } from 'sonner';
import { Headset, AlertTriangle, ChevronRight, ArrowUpCircle } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createPageUrl } from '@/utils';
import {
  listQueueTickets,
  listTicketMessages,
  addSupportMessage,
  transitionTicketStatus,
  escalateTicketToSupport,
  autoEscalateBreachedTickets,
} from '@/lib/support/tickets';
import { isSlaBreached } from '@/lib/support/sla';
import { nextStatusesFor } from '@/lib/support/statusMachine';
import { isPlatformOwner } from '@/lib/support/owner';
import { useRunOnce } from '@/hooks/useRunOnce';
import { SUPPORT_AUTHOR_ROLE, SUPPORT_STATUS, SUPPORT_TIER, TERMINAL_STATUSES } from '@/lib/support/constants';
import TicketThread from '@/components/support/TicketThread';
import { SupportStatusBadge, SupportPriorityBadge, STATUS_LABELS } from '@/components/support/labels.jsx';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const TABS = [
  { value: 'active', label: 'Activos' },
  { value: 'all', label: 'Todos' },
];

export default function SoporteAdmin() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('active');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [activeTicket, setActiveTicket] = useState(null);

  const { user, userProfile } = useCurrentProfile();

  // Platform-owner detection: prefer the server-persisted super-admin flag, but
  // fall back to the authenticated Base44 User.role (the app creator is `admin`)
  // since the deployed UserProfile schema may not expose `is_super_admin`.
  const isOwner = isPlatformOwner({ userProfile, user });
  const staffRole = isOwner ? SUPPORT_AUTHOR_ROLE.OWNER : SUPPORT_AUTHOR_ROLE.SCHOOL_ADMIN;

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ['supportQueue', userProfile?.id, isOwner],
    queryFn: () => listQueueTickets(userProfile, { isOwner }),
    enabled: !!userProfile,
  });

  // Deep link: open a ticket directly when arriving from the triage panel
  // (PanelSoporte) with ?ticketId=. Runs once per id after tickets load.
  const [openedDeepLink, setOpenedDeepLink] = useState(false);
  useEffect(() => {
    if (openedDeepLink || activeTicket || tickets.length === 0) return;
    const requestedId = new URLSearchParams(window.location.search).get('ticketId');
    if (!requestedId) return;
    const match = tickets.find((t) => t.id === requestedId);
    if (match) {
      setActiveTicket(match);
      setOpenedDeepLink(true);
    }
  }, [tickets, activeTicket, openedDeepLink]);

  const { data: messages = [] } = useQuery({
    queryKey: ['supportTicketMessages', activeTicket?.id, isOwner],
    queryFn: () => listTicketMessages(activeTicket.id, { isOwner }),
    enabled: !!activeTicket,
  });

  const filtered = useMemo(() => {
    return tickets.filter((t) => {
      if (tab === 'active' && TERMINAL_STATUSES.includes(t.status)) return false;
      if (priorityFilter !== 'ALL' && t.priority !== priorityFilter) return false;
      return true;
    });
  }, [tickets, tab, priorityFilter]);

  const breachedCount = useMemo(
    () => tickets.filter((t) => isSlaBreached({ slaDueAt: t.sla_due_at, status: t.status, firstResponseAt: t.first_response_at })).length,
    [tickets],
  );

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['supportQueue', userProfile?.id, isOwner] });
    if (activeTicket) queryClient.invalidateQueries({ queryKey: ['supportTicketMessages', activeTicket.id] });
  };

  const handleReply = async (body) => {
    await addSupportMessage({ user, userProfile, ticket: activeTicket, body, authorRole: staffRole });
    refresh();
  };

  const handleStatusChange = async (toStatus) => {
    try {
      const updated = await transitionTicketStatus({ user, userProfile, ticket: activeTicket, toStatus });
      setActiveTicket(updated);
      toast.success(`Ticket actualizado: ${STATUS_LABELS[toStatus] || toStatus}`);
      refresh();
    } catch (error) {
      toast.error(error.message || 'No se pudo cambiar el estado.');
    }
  };

  // Manual L1→L2 handoff: the director sends an unresolved ticket to soporte.
  const handleEscalateToSupport = async () => {
    try {
      const updated = await escalateTicketToSupport({ user, userProfile, ticket: activeTicket, trigger: 'manual' });
      setActiveTicket(updated);
      toast.success('Ticket escalado a soporte LIUMA (48 h de respuesta).');
      refresh();
    } catch (error) {
      toast.error(error.message || 'No se pudo escalar a soporte.');
    }
  };

  // Auto L1→L2 handoff: when the director opens their queue, any ticket whose
  // SLA lapsed without a first response rolls up to soporte automatically. The
  // app has no cron, so this is the opportunistic trigger. Owners are already
  // L2, so it only runs for directors, and once per queue load.
  useRunOnce(!isOwner && !!user && !!userProfile && tickets.length > 0, async () => {
    const count = await autoEscalateBreachedTickets({ user, userProfile, tickets });
    if (count > 0) {
      toast.info(`${count} ticket${count !== 1 ? 's' : ''} sin respuesta escalado${count !== 1 ? 's' : ''} a soporte.`);
      refresh();
    }
  });

  if (isLoading) return <LoadingScreen message="Cargando tickets..." />;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 pb-24">
      <PageHeader
        eyebrow={isOwner ? 'Plataforma' : 'Soporte'}
        title={isOwner ? 'Soporte — Consola LIUMA' : 'Soporte — Mi escuela'}
        showBack
        backTo={createPageUrl('Home')}
      />

      {breachedCount > 0 && (
        <Card className="p-3 mb-4 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
          <p className="text-sm text-red-800 dark:text-red-300">
            {breachedCount} ticket{breachedCount !== 1 ? 's' : ''} fuera del compromiso de respuesta (SLA).
          </p>
        </Card>
      )}

      <div className="flex items-center justify-between gap-3 mb-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Toda prioridad</SelectItem>
            <SelectItem value="URGENT">Urgente</SelectItem>
            <SelectItem value="HIGH">Alta</SelectItem>
            <SelectItem value="NORMAL">Normal</SelectItem>
            <SelectItem value="LOW">Baja</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Headset} title="Sin tickets" description="No hay tickets que coincidan con el filtro." />
      ) : (
        <div className="space-y-3">
          {filtered.map((ticket) => {
            const breached = isSlaBreached({ slaDueAt: ticket.sla_due_at, status: ticket.status, firstResponseAt: ticket.first_response_at });
            return (
              <Card
                key={ticket.id}
                className={`p-4 cursor-pointer hover:shadow-md transition-shadow ${breached ? 'border-red-300 dark:border-red-800' : ''}`}
                onClick={() => setActiveTicket(ticket)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">{ticket.ticket_number}</span>
                      {breached && <span className="text-[10px] font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-1.5 py-0.5 rounded">SLA</span>}
                    </div>
                    <p className="font-medium text-card-foreground truncate">{ticket.subject}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{ticket.requester_name} · {ticket.requester_role}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <SupportStatusBadge status={ticket.status} />
                      <SupportPriorityBadge priority={ticket.priority} />
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!activeTicket} onOpenChange={() => setActiveTicket(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{activeTicket?.subject}</DialogTitle>
          </DialogHeader>
          {activeTicket && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="font-mono text-muted-foreground">{activeTicket.ticket_number}</span>
                <SupportStatusBadge status={activeTicket.status} />
                <SupportPriorityBadge priority={activeTicket.priority} />
              </div>
              <p className="text-xs text-muted-foreground">
                Solicitante: {activeTicket.requester_name} ({activeTicket.requester_role})
                {activeTicket.sla_due_at && (
                  <> · SLA: {format(new Date(activeTicket.sla_due_at), "d MMM HH:mm", { locale: es })}</>
                )}
              </p>

              {/* Status actions */}
              {nextStatusesFor(activeTicket.status).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {nextStatusesFor(activeTicket.status).map((status) => (
                    <Button key={status} size="sm" variant="outline" onClick={() => handleStatusChange(status)}>
                      {STATUS_LABELS[status] || status}
                    </Button>
                  ))}
                </div>
              )}

              {/* L1→L2 handoff: a director escalates an unresolved school ticket
                  up to soporte LIUMA. Hidden for owners (already L2) and once
                  the ticket has reached the platform tier or a terminal state. */}
              {!isOwner
                && activeTicket.tier === SUPPORT_TIER.SCHOOL_ADMIN
                && !TERMINAL_STATUSES.includes(activeTicket.status) && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-3">
                  <p className="text-xs text-amber-800 dark:text-amber-300 mb-2">
                    ¿No puedes resolver este ticket en tu escuela? Escálalo a soporte LIUMA;
                    el equipo responderá en un máximo de 48 horas.
                  </p>
                  <Button size="sm" variant="outline" className="border-amber-300 dark:border-amber-800" onClick={handleEscalateToSupport}>
                    <ArrowUpCircle className="w-4 h-4 mr-1.5" />
                    Escalar a soporte
                  </Button>
                </div>
              )}

              <TicketThread
                messages={messages}
                onReply={handleReply}
                viewerIsStaff
                clientContext={activeTicket.client_context}
                disabled={activeTicket.status === SUPPORT_STATUS.CLOSED}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
