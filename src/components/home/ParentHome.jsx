import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { Users, BookOpen, ClipboardList, Bell, CreditCard, Calendar, ShoppingBag, CheckSquare, CalendarX, ListChecks } from 'lucide-react';
import BigTile from '@/components/ui/BigTile';
import LumiButton from '@/components/ui/LumiButton';
import LumiChat from '@/components/lumi/LumiChat';
import NoticeCard from '@/components/notices/NoticeCard';
import EventCard from '@/components/events/EventCard';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { createPageUrl } from '@/utils';
import { getLinkedStudents } from '@/lib/relations/getLinkedStudents';

export default function ParentHome({ user, userProfile, subscription }) {
  const [showLumi, setShowLumi] = useState(false);
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
      const allNotices = await base44.entities.Notice.filter({ 
        school_id: userProfile.school_id 
      }, '-created_date', 10);
      return allNotices.filter(n => 
        n.priority === 'URGENT' || n.priority === 'IMPORTANT' || n.is_emergency
      ).slice(0, 3);
    },
  });


  const { data: unreadUrgentDeliveries = [] } = useQuery({
    queryKey: ['unreadUrgentDeliveries', user.id, userProfile.school_id],
    queryFn: async () => {
      const rows = await base44.entities.NoticeDelivery.filter({
        school_id: userProfile.school_id,
        recipient_user_id: user.id,
        status: 'SENT',
      }, '-created_date', 50);
      const urgentNotices = new Set(notices.filter((n) => n.priority === 'URGENT').map((n) => n.id));
      return rows.filter((row) => urgentNotices.has(row.notice_id));
    },
  });

  // Get upcoming events
  const { data: events = [] } = useQuery({
    queryKey: ['upcomingEvents', userProfile.school_id],
    queryFn: async () => {
      const allEvents = await base44.entities.Event.filter({ 
        school_id: userProfile.school_id 
      }, 'date', 5);
      return allEvents.filter(e => new Date(e.date) >= new Date());
    },
  });

  // Get pending charges count
  const { data: pendingCharges = [] } = useQuery({
    queryKey: ['pendingCharges', studentIds],
    queryFn: async () => {
      if (studentIds.length === 0) return [];
      const charges = await base44.entities.ChargeItem.filter({
        school_id: userProfile.school_id,
        status: 'PENDING'
      });
      return charges.filter(c => studentIds.includes(c.student_id));
    },
    enabled: studentIds.length > 0,
  });

  const overdueCharges = pendingCharges.filter(c => 
    new Date(c.due_date) < new Date() && c.status !== 'PAID'
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-600 to-indigo-700 px-6 pt-12 pb-8">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <p className="text-violet-200 text-sm">
            {format(new Date(), "EEEE d 'de' MMMM", { locale: es })}
          </p>
          <h1 className="text-2xl font-bold text-white mt-1">
            Hola, {user.full_name?.split(' ')[0] || 'Padre'}
          </h1>
        </motion.div>
      </div>

      {/* Main Content */}
      <div className="px-6 -mt-4 pb-24">
        {/* Main Tiles */}
        <div className="space-y-3">
          <BigTile
            icon={Users}
            title="Mis hijos"
            subtitle={`${studentIds.length} vinculado${studentIds.length !== 1 ? 's' : ''}`}
            href={createPageUrl('MisHijos')}
            color="from-blue-50 to-white"
            iconColor="text-blue-600"
            delay={0.1}
          />
          <BigTile
            icon={ClipboardList}
            title="Bitácora"
            subtitle="Ver el día de hoy"
            href={createPageUrl('Bitacora')}
            color="from-green-50 to-white"
            iconColor="text-green-600"
            delay={0.15}
          />
          <BigTile
            icon={BookOpen}
            title="Tarea"
            subtitle="Ver tareas pendientes"
            href={createPageUrl('Tarea')}
            color="from-amber-50 to-white"
            iconColor="text-amber-600"
            delay={0.2}
          />
          <BigTile
            icon={Bell}
            title="Avisos"
            subtitle="Ver comunicados"
            href={createPageUrl('Avisos')}
            badge={unreadUrgentDeliveries.length}
            badgeColor="bg-red-500"
            color="from-violet-50 to-white"
            iconColor="text-violet-600"
            delay={0.25}
          />
          <BigTile
            icon={CreditCard}
            title="Pagos"
            subtitle={overdueCharges.length > 0 ? 'Tienes pagos vencidos' : 'Ver estado de cuenta'}
            href={createPageUrl('Pagos')}
            badge={overdueCharges.length}
            badgeColor="bg-red-500"
            color="from-rose-50 to-white"
            iconColor="text-rose-600"
            delay={0.3}
          />
          <BigTile
            icon={Calendar}
            title="Calendario"
            subtitle="Ver eventos escolares"
            href={createPageUrl('CalendarioEscolar')}
            color="from-blue-50 to-white"
            iconColor="text-blue-600"
            delay={0.35}
          />
          <BigTile
            icon={ShoppingBag}
            title="Uniformes"
            subtitle="Hacer pedidos de uniformes"
            href={createPageUrl('PedidosUniformes')}
            color="from-teal-50 to-white"
            iconColor="text-teal-600"
            delay={0.4}
          />
          <BigTile
            icon={CheckSquare}
            title="Eventos"
            subtitle="Confirmar asistencia a eventos"
            href={createPageUrl('EventosParaPadres')}
            color="from-purple-50 to-white"
            iconColor="text-purple-600"
            delay={0.45}
          />
          <BigTile
            icon={CalendarX}
            title="Solicitar Ausencia"
            subtitle="Avisar ausencias con anticipación"
            href={createPageUrl('SolicitarAusencia')}
            color="from-orange-50 to-white"
            iconColor="text-orange-600"
            delay={0.5}
          />
          <BigTile
            icon={ListChecks}
            title="Operación Diaria"
            subtitle="Timeline de mis hijos"
            href={createPageUrl('OperacionDiaria')}
            color="from-lime-50 to-white"
            iconColor="text-lime-600"
            delay={0.55}
          />
        </div>

        {/* Upcoming Events */}
        {events.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="mt-8"
          >
            <h2 className="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-indigo-600" />
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
            <h2 className="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <Bell className="w-5 h-5 text-violet-600" />
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

      {/* Lumi Button */}
      <LumiButton onClick={() => setShowLumi(true)} isOpen={showLumi} />
      
      {/* Lumi Chat */}
      <LumiChat 
        isOpen={showLumi} 
        onClose={() => setShowLumi(false)} 
        userProfile={userProfile}
      />
    </div>
  );
}