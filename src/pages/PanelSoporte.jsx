import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Headset, AlertTriangle, ChevronRight, Inbox, LayoutGrid, Flag, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createPageUrl } from '@/utils';
import { isPlatformOwner } from '@/lib/support/owner';
import { listQueueTickets } from '@/lib/support/tickets';
import { isSlaBreached } from '@/lib/support/sla';
import {
  groupByCategory, groupByPriority, summarizePending,
} from '@/lib/support/dashboard';
import { CATEGORY_LABELS, PRIORITY_LABELS, SupportStatusBadge, SupportPriorityBadge } from '@/components/support/labels.jsx';

/**
 * PanelSoporte — admin triage dashboard. Shows every PENDING support ticket
 * (non-terminal) organized by category and by priority, so a director (own
 * school) or the platform owner (all tenants) can scan the backlog at a glance.
 * Clicking a ticket deep-links into the full SoporteAdmin console to handle it.
 */
export default function PanelSoporte() {
  const navigate = useNavigate();
  const [groupMode, setGroupMode] = useState('category');

  const { data: user } = useQuery({ queryKey: ['currentUser'], queryFn: () => base44.auth.me() });
  const { data: userProfile } = useQuery({
    queryKey: ['userProfile', user?.id],
    queryFn: async () => (await base44.entities.UserProfile.filter({ user_id: user.id }))[0],
    enabled: !!user,
  });

  const isOwner = isPlatformOwner({ userProfile, user });

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ['supportQueue', userProfile?.id, isOwner],
    queryFn: () => listQueueTickets(userProfile, { isOwner }),
    enabled: !!userProfile,
  });

  const summary = useMemo(() => summarizePending(tickets), [tickets]);
  const categoryGroups = useMemo(() => groupByCategory(tickets), [tickets]);
  const priorityGroups = useMemo(() => groupByPriority(tickets), [tickets]);

  const groups = groupMode === 'category' ? categoryGroups : priorityGroups;
  const groupLabel = (key) => (groupMode === 'category' ? (CATEGORY_LABELS[key] || key) : (PRIORITY_LABELS[key] || key));

  const openTicket = (ticket) => navigate(createPageUrl(`SoporteAdmin?ticketId=${ticket.id}`));

  if (isLoading) return <LoadingScreen message="Cargando tickets..." />;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 pb-24">
      <PageHeader
        title={isOwner ? 'Panel de soporte — LIUMA' : 'Panel de soporte'}
        subtitle="Tickets pendientes por categoría y prioridad"
        showBack
        backTo={createPageUrl('Home')}
      />

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <SummaryCard icon={Inbox} value={summary.total} label="Pendientes" tone="text-card-foreground bg-card" />
        <SummaryCard icon={Flag} value={summary.urgent} label="Urgentes" tone="text-red-700 bg-red-50" />
        <SummaryCard icon={AlertTriangle} value={summary.breached} label="Fuera de SLA" tone="text-amber-700 bg-amber-50" />
      </div>

      {/* Group toggle */}
      <div className="mb-4">
        <Tabs value={groupMode} onValueChange={setGroupMode}>
          <TabsList>
            <TabsTrigger value="category" className="gap-1.5"><LayoutGrid className="w-4 h-4" /> Por categoría</TabsTrigger>
            <TabsTrigger value="priority" className="gap-1.5"><Flag className="w-4 h-4" /> Por prioridad</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {summary.total === 0 ? (
        <EmptyState icon={Headset} title="Sin tickets pendientes" description="No hay tickets que requieran atención en este momento." />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key}>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                  {groupMode === 'priority' && <SupportPriorityBadge priority={group.key} />}
                  {groupLabel(group.key)}
                </h2>
                <span className="text-xs font-semibold text-muted-foreground">{group.tickets.length}</span>
              </div>
              <div className="space-y-2">
                {group.tickets.map((ticket) => (
                  <TicketRow
                    key={ticket.id}
                    ticket={ticket}
                    groupMode={groupMode}
                    onClick={() => openTicket(ticket)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

function SummaryCard({ icon: Icon, value, label, tone }) {
  return (
    <Card className={`p-3 text-center ${tone}`}>
      <Icon className="w-4 h-4 mx-auto mb-1 opacity-70" />
      <p className="text-2xl font-black leading-none">{value}</p>
      <p className="text-[11px] font-semibold mt-1">{label}</p>
    </Card>
  );
}

function TicketRow({ ticket, groupMode, onClick }) {
  const breached = isSlaBreached({
    slaDueAt: ticket.sla_due_at,
    status: ticket.status,
    firstResponseAt: ticket.first_response_at,
  });
  return (
    <Card
      className={`p-4 cursor-pointer hover:shadow-md transition-shadow ${breached ? 'border-red-300' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">{ticket.ticket_number}</span>
            {breached && <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">SLA</span>}
          </div>
          <p className="font-medium text-card-foreground truncate">{ticket.subject}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{ticket.requester_name} · {ticket.requester_role}</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <SupportStatusBadge status={ticket.status} />
            {/* Show the cross-axis chip: priority in category view, category in priority view. */}
            {groupMode === 'category'
              ? <SupportPriorityBadge priority={ticket.priority} />
              : <span className="text-[11px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{CATEGORY_LABELS[ticket.category] || ticket.category}</span>}
            {ticket.sla_due_at && (
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" /> {format(new Date(ticket.sla_due_at), "d MMM HH:mm", { locale: es })}
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
      </div>
    </Card>
  );
}
