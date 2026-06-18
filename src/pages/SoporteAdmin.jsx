import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Headset, AlertTriangle, ChevronRight } from 'lucide-react';
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
} from '@/lib/support/tickets';
import { isSlaBreached } from '@/lib/support/sla';
import { nextStatusesFor } from '@/lib/support/statusMachine';
import { isPlatformOwner } from '@/lib/support/owner';
import { SUPPORT_AUTHOR_ROLE, SUPPORT_STATUS, TERMINAL_STATUSES } from '@/lib/support/constants';
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

  const { data: user } = useQuery({ queryKey: ['currentUser'], queryFn: () => base44.auth.me() });
  const { data: userProfile } = useQuery({
    queryKey: ['userProfile', user?.id],
    queryFn: async () => (await base44.entities.UserProfile.filter({ user_id: user.id }))[0],
    enabled: !!user,
  });

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
    queryKey: ['supportTicketMessages', activeTicket?.id],
    queryFn: () => listTicketMessages(activeTicket.id),
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

  if (isLoading) return <LoadingScreen message="Cargando tickets..." />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 pb-24">
      <PageHeader
        title={isOwner ? 'Soporte — Consola LIUMA' : 'Soporte — Mi escuela'}
        showBack
        backTo={createPageUrl('Home')}
      />

      {breachedCount > 0 && (
        <Card className="p-3 mb-4 bg-red-50 border-red-200 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <p className="text-sm text-red-800">
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
                className={`p-4 cursor-pointer hover:shadow-md transition-shadow ${breached ? 'border-red-300' : ''}`}
                onClick={() => setActiveTicket(ticket)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-slate-400">{ticket.ticket_number}</span>
                      {breached && <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">SLA</span>}
                    </div>
                    <p className="font-medium text-slate-800 truncate">{ticket.subject}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{ticket.requester_name} · {ticket.requester_role}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <SupportStatusBadge status={ticket.status} />
                      <SupportPriorityBadge priority={ticket.priority} />
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-300 shrink-0" />
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
                <span className="font-mono text-slate-400">{activeTicket.ticket_number}</span>
                <SupportStatusBadge status={activeTicket.status} />
                <SupportPriorityBadge priority={activeTicket.priority} />
              </div>
              <p className="text-xs text-slate-500">
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

              <TicketThread
                messages={messages}
                onReply={handleReply}
                viewerIsStaff
                disabled={activeTicket.status === SUPPORT_STATUS.CLOSED}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
