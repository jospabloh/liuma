import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { schoolRead } from '@/lib/data/schoolRead';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import LoadingScreen from '@/components/ui/LoadingScreen';
import NoticeCard from '@/components/notices/NoticeCard';
import { Bell, Check, Filter } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Button } from "@/components/ui/button";
import { createPageUrl } from '@/utils';
import { canReadEntity } from '@/lib/authorization/policy';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function Avisos() {
  const [selectedNotice, setSelectedNotice] = useState(null);
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterReadState, setFilterReadState] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const queryClient = useQueryClient();
  
  const { user, userProfile } = useCurrentProfile();

  const { data: notices = [], isLoading } = useQuery({
    queryKey: ['notices', userProfile?.school_id],
    queryFn: async () => {
      if (!canReadEntity(userProfile?.app_role, 'Notice')) return [];
      // schoolRead applies the notice audience server-side (school-wide —
      // including a legacy notice stored without `scope` —, the children's
      // classrooms, the children themselves). No client re-filter on top: a
      // stricter copy here is how a school-wide notice showed on the parent's
      // home and not on this page.
      return schoolRead('Notice', { school_id: userProfile.school_id }, '-created_date', 50);
    },
    enabled: !!userProfile,
  });



  const { data: deliveries = [] } = useQuery({
    queryKey: ['noticeDeliveries', user?.id, userProfile?.school_id],
    queryFn: async () => {
      const rows = await schoolRead('NoticeDelivery', {
        school_id: userProfile.school_id,
        recipient_user_id: user.id,
      }, '-created_date', 100);

      const escalated = rows.filter((row) =>
        row.status !== 'ACKNOWLEDGED' && row.escalation_due_at && new Date(row.escalation_due_at) < new Date() && row.escalation_status !== 'ESCALATED'
      );

      await Promise.all(escalated.map((row) => base44.entities.NoticeDelivery.update(row.id, { escalation_status: 'ESCALATED' })));
      return rows.map((row) => ({
        ...row,
        escalation_status: row.escalation_status || (row.escalation_due_at && new Date(row.escalation_due_at) < new Date() && row.status !== 'ACKNOWLEDGED' ? 'ESCALATED' : null),
      }));
    },
    enabled: !!user && !!userProfile,
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (delivery) => base44.entities.NoticeDelivery.update(delivery.id, {
      status: 'READ',
      read_at: delivery.read_at || new Date().toISOString(),
    }),
    onSuccess: () => queryClient.invalidateQueries(['noticeDeliveries']),
  });
  const noticesById = useMemo(() => new Map(notices.map((notice) => [notice.id, notice])), [notices]);
  const noticeRows = deliveries
    .map((delivery) => ({ notice: noticesById.get(delivery.notice_id), delivery }))
    .filter((item) => !!item.notice);

  const filteredNotices = noticeRows.filter(({ notice, delivery }) => {
    const priorityOk = filterPriority === 'all' || notice.priority === filterPriority;
    const readOk = filterReadState === 'all'
      || (filterReadState === 'unread' && delivery.status === 'SENT')
      || (filterReadState === 'read' && (delivery.status === 'READ' || delivery.status === 'ACKNOWLEDGED'));
    return priorityOk && readOk;
  });

  if (isLoading) return <LoadingScreen message="Cargando avisos..." />;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 pb-24">
      <PageHeader
        title="Avisos"
        showBack
        backTo={createPageUrl('Home')}
        action={
          <Button
            variant="outline"
            size="icon"
            aria-label="Filtrar avisos"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="w-4 h-4" />
          </Button>
        }
      />

      {/* Filters */}
      {showFilters && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mb-4"
        >
          <Select value={filterPriority} onValueChange={setFilterPriority}>
            <SelectTrigger>
              <SelectValue placeholder="Filtrar por prioridad" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los avisos</SelectItem>
              <SelectItem value="URGENT">Solo urgentes</SelectItem>
              <SelectItem value="IMPORTANT">Solo importantes</SelectItem>
              <SelectItem value="NORMAL">Solo normales</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterReadState} onValueChange={setFilterReadState}>
            <SelectTrigger className="mt-2">
              <SelectValue placeholder="Filtrar por lectura" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="unread">No leídos</SelectItem>
              <SelectItem value="read">Leídos</SelectItem>
            </SelectContent>
          </Select>
        </motion.div>
      )}

      {filteredNotices.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Sin avisos"
          description="No hay avisos para mostrar."
        />
      ) : (
        <div className="space-y-4">
          {filteredNotices.map(({ notice, delivery }, index) => (
            <motion.div
              key={notice.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <div className="space-y-2">
                <NoticeCard
                  notice={notice}
                  onClick={() => setSelectedNotice({ ...notice, delivery })}
                />
                {delivery.status === 'SENT' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => markAsReadMutation.mutate(delivery)}
                    className="w-full"
                  >
                    <Check className="w-4 h-4 mr-1" /> Marcar como leído
                  </Button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Notice Detail Modal */}
      <Dialog open={!!selectedNotice} onOpenChange={() => setSelectedNotice(null)}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedNotice?.title}</DialogTitle>
          </DialogHeader>
          
          {selectedNotice && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                {format(new Date(selectedNotice.created_date), "d 'de' MMMM, yyyy 'a las' HH:mm", { locale: es })}
              </div>

              <div className="bg-muted rounded-xl p-4">
                <p className="text-foreground whitespace-pre-wrap">{selectedNotice.content}</p>
              </div>

              {selectedNotice.delivery?.escalation_status === 'ESCALATED' && (
                <p className="text-xs text-red-600 dark:text-red-400 text-center font-medium">
                  Aviso urgente escalado por falta de acuse
                </p>
              )}

              {selectedNotice.author_name && (
                <p className="text-xs text-muted-foreground text-center">
                  Enviado por {selectedNotice.author_name}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}