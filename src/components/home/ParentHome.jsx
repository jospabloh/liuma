import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { schoolRead } from '@/lib/data/schoolRead';
import { motion } from 'framer-motion';
import { Users, BookOpen, ClipboardList, Bell, CreditCard, Calendar, ShoppingBag, CheckSquare, CalendarX, ListChecks, LifeBuoy } from 'lucide-react';
import BigTile from '@/components/ui/BigTile';
import { HomeHeader, HomeSection } from '@/components/home/HomeChrome';
import NoticeCard from '@/components/notices/NoticeCard';
import EventCard from '@/components/events/EventCard';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { createPageUrl } from '@/utils';
import { getLinkedStudents } from '@/lib/relations/getLinkedStudents';
import { formatLocalDate, isBeforeToday } from '@/lib/dates';

export default function ParentHome({ user, userProfile, subscription }) {
  const today = format(new Date(), 'yyyy-MM-dd');

  // Get linked students
  const { data: linkedStudents = { students: [], studentIds: [] } } = useQuery({
    queryKey: ['linkedStudents', user.id],
    queryFn: () => getLinkedStudents(user),
  });

  const studentIds = linkedStudents.studentIds;

  // Get urgent notices
  const { data: notices = [] } = useQuery({
    queryKey: ['urgentNotices', userProfile.school_id],
    queryFn: async () => {
      const allNotices = await schoolRead('Notice', { 
        school_id: userProfile.school_id 
      }, '-created_date', 10);
      return allNotices.filter(n => 
        n.priority === 'URGENT' || n.priority === 'IMPORTANT' || n.is_emergency
      ).slice(0, 3);
    },
  });


  // The caller's unread deliveries, joined to the urgent notices at render
  // time: joining inside the queryFn read `notices` from a stale closure (it
  // usually ran before the notices had loaded) and cached an empty badge.
  const { data: unreadDeliveries = [] } = useQuery({
    queryKey: ['unreadUrgentDeliveries', user.id, userProfile.school_id],
    queryFn: () => schoolRead('NoticeDelivery', {
      school_id: userProfile.school_id,
      recipient_user_id: user.id,
      status: 'SENT',
    }, '-created_date', 50),
  });
  const urgentNoticeIds = new Set(notices.filter((n) => n.priority === 'URGENT').map((n) => n.id));
  // Counted in notices, not copies: a parent with two children gets one copy
  // per child of the same notice (and of the emergency alert), and Avisos
  // shows it once (collapseInbox) — the badge must agree with that list.
  const unreadUrgentCount = new Set(
    unreadDeliveries.filter((row) => urgentNoticeIds.has(row.notice_id)).map((row) => row.notice_id),
  ).size;

  // Get upcoming events
  const { data: events = [] } = useQuery({
    queryKey: ['upcomingEvents', userProfile.school_id],
    queryFn: async () => {
      // Ask the server for today-onward (YYYY-MM-DD compares as text), or the
      // first 5 events ever would crowd out the upcoming ones.
      return schoolRead('Event', {
        school_id: userProfile.school_id,
        date: { $gte: formatLocalDate() },
      }, 'date', 5);
    },
  });

  // Get pending charges count
  const { data: pendingCharges = [] } = useQuery({
    queryKey: ['pendingCharges', studentIds],
    queryFn: async () => {
      if (studentIds.length === 0) return [];
      const charges = await schoolRead('ChargeItem', {
        school_id: userProfile.school_id,
        status: 'PENDING'
      });
      return charges.filter(c => studentIds.includes(c.student_id));
    },
    enabled: studentIds.length > 0,
  });

  const overdueCharges = pendingCharges.filter(c =>
    isBeforeToday(c.due_date) && c.status !== 'PAID'
  );

  return (
    <div className="min-h-screen bg-background">
      <HomeHeader
        eyebrow={format(new Date(), "EEEE d 'de' MMMM", { locale: es })}
        title={`Hola, ${user.full_name?.split(' ')[0] || 'Padre'}`}
      />

      {/* Main Content */}
      <div className="relative z-10 mx-auto max-w-2xl px-6 -mt-6 pb-24">
        <div className="space-y-7">
          <HomeSection label="Día a día">
            <BigTile
              icon={Users}
              title="Mis hijos"
              subtitle={`${studentIds.length} vinculado${studentIds.length !== 1 ? 's' : ''}`}
              href={createPageUrl('MisHijos')}
              delay={0.05}
            />
            <BigTile
              icon={ClipboardList}
              title="Bitácora"
              subtitle="Ver el día de hoy"
              href={createPageUrl('Bitacora')}
              delay={0.1}
            />
            <BigTile
              icon={BookOpen}
              title="Tarea"
              subtitle="Revisar lo que deben entregar"
              href={createPageUrl('Tarea')}
              delay={0.15}
            />
            <BigTile
              icon={ListChecks}
              title="Operación diaria"
              subtitle="Resumen del día de tus hijos"
              href={createPageUrl('OperacionDiaria')}
              delay={0.2}
            />
          </HomeSection>

          <HomeSection label="Comunicación">
            <BigTile
              icon={Bell}
              title="Avisos"
              subtitle="Leer mensajes de la escuela"
              href={createPageUrl('Avisos')}
              badge={unreadUrgentCount}
              delay={0.05}
            />
            <BigTile
              icon={Calendar}
              title="Calendario"
              subtitle="Ver eventos escolares"
              href={createPageUrl('CalendarioEscolar')}
              delay={0.1}
            />
            <BigTile
              icon={CheckSquare}
              title="Eventos"
              subtitle="Confirmar asistencia a eventos"
              href={createPageUrl('EventosParaPadres')}
              delay={0.15}
            />
          </HomeSection>

          <HomeSection label="Trámites y pagos">
            <BigTile
              icon={CreditCard}
              title="Pagos"
              subtitle={overdueCharges.length > 0 ? 'Tienes pagos vencidos' : 'Ver estado de cuenta'}
              href={createPageUrl('Pagos')}
              badge={overdueCharges.length}
              delay={0.05}
            />
            <BigTile
              icon={ShoppingBag}
              title="Uniformes"
              subtitle="Hacer pedidos de uniformes"
              href={createPageUrl('PedidosUniformes')}
              delay={0.1}
            />
            <BigTile
              icon={CalendarX}
              title="Solicitar ausencia"
              subtitle="Avisar cuando tu hijo faltará"
              href={createPageUrl('SolicitarAusencia')}
              delay={0.15}
            />
          </HomeSection>

          <HomeSection label="Ayuda">
            <BigTile
              icon={LifeBuoy}
              title="Soporte y ayuda"
              subtitle="Pregunta a Lumi o abre un ticket"
              href={createPageUrl('Soporte')}
              delay={0.05}
            />
          </HomeSection>
        </div>

        {/* Upcoming Events */}
        {events.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="mt-8"
          >
            <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-brand" />
              Próximos eventos
            </h2>
            <div className="space-y-3">
              {events.slice(0, 2).map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          </motion.div>
        )}

        {/* Important Notices */}
        {notices.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mt-8"
          >
            <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
              <Bell className="w-5 h-5 text-brand" />
              Avisos importantes
            </h2>
            <div className="space-y-3">
              {notices.map((notice) => (
                <NoticeCard key={notice.id} notice={notice} />
              ))}
            </div>
          </motion.div>
        )}
      </div>

    </div>
  );
}
