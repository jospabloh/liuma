import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { BarChart3, Users, ClipboardList, CreditCard, Bell, Calendar } from 'lucide-react';
import { format, startOfWeek, endOfWeek, isToday } from 'date-fns';
import { es } from 'date-fns/locale';
import { createPageUrl } from '@/utils';

export default function Reportes() {
  const today = format(new Date(), 'yyyy-MM-dd');

  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: userProfile } = useQuery({
    queryKey: ['userProfile', user?.id],
    queryFn: async () => {
      const profiles = await base44.entities.UserProfile.filter({ user_id: user.id });
      return profiles[0];
    },
    enabled: !!user,
  });

  const { data: students = [] } = useQuery({
    queryKey: ['allStudents', userProfile?.school_id],
    queryFn: () => base44.entities.Student.filter({ 
      school_id: userProfile.school_id,
      is_active: true 
    }),
    enabled: !!userProfile,
  });

  const { data: classrooms = [] } = useQuery({
    queryKey: ['allClassrooms', userProfile?.school_id],
    queryFn: () => base44.entities.Classroom.filter({ 
      school_id: userProfile.school_id,
      is_active: true 
    }),
    enabled: !!userProfile,
  });

  const { data: todayDiaries = [] } = useQuery({
    queryKey: ['todayDiaries', today, userProfile?.school_id],
    queryFn: () => base44.entities.DiaryEntry.filter({ 
      date: today,
      school_id: userProfile.school_id
    }),
    enabled: !!userProfile,
  });

  const { data: pendingCharges = [] } = useQuery({
    queryKey: ['pendingCharges', userProfile?.school_id],
    queryFn: async () => {
      const charges = await base44.entities.ChargeItem.filter({ 
        school_id: userProfile.school_id,
        status: 'PENDING'
      });
      return charges;
    },
    enabled: !!userProfile,
  });

  const { data: weekNotices = [] } = useQuery({
    queryKey: ['weekNotices', userProfile?.school_id],
    queryFn: async () => {
      const notices = await base44.entities.Notice.filter({ 
        school_id: userProfile.school_id
      }, '-created_date', 50);
      const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
      return notices.filter(n => new Date(n.created_date) >= weekStart);
    },
    enabled: !!userProfile,
  });

  const { data: upcomingEvents = [], isLoading } = useQuery({
    queryKey: ['upcomingEvents', userProfile?.school_id],
    queryFn: async () => {
      const events = await base44.entities.Event.filter({ 
        school_id: userProfile.school_id 
      }, 'date', 10);
      return events.filter(e => new Date(e.date) >= new Date());
    },
    enabled: !!userProfile,
  });

  const diaryProgress = students.length > 0 
    ? Math.round((todayDiaries.length / students.length) * 100) 
    : 0;

  const overdueCharges = pendingCharges.filter(c => new Date(c.due_date) < new Date());
  const totalPending = pendingCharges.reduce((sum, c) => sum + (c.amount || 0), 0);

  const urgentNotices = weekNotices.filter(n => n.priority === 'URGENT').length;

  if (isLoading) return <LoadingScreen message="Cargando reportes..." />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 pb-24">
      <PageHeader
        title="Reportes"
        subtitle={format(new Date(), "EEEE d 'de' MMMM", { locale: es })}
        showBack
        backTo={createPageUrl('Home')}
      />

      <div className="space-y-4">
        {/* Diary Progress */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-5 shadow-sm border"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
              <ClipboardList className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">Bitácoras de hoy</h3>
              <p className="text-sm text-slate-500">{todayDiaries.length} de {students.length} alumnos</p>
            </div>
            <div className={`ml-auto text-2xl font-bold ${diaryProgress === 100 ? 'text-green-600' : 'text-amber-600'}`}>
              {diaryProgress}%
            </div>
          </div>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${diaryProgress === 100 ? 'bg-green-500' : 'bg-amber-500'}`}
              style={{ width: `${diaryProgress}%` }}
            />
          </div>
          {classrooms.map((classroom) => {
            const classStudents = students.filter(s => s.classroom_id === classroom.id);
            const classDiaries = todayDiaries.filter(d => d.classroom_id === classroom.id);
            return (
              <div key={classroom.id} className="flex justify-between items-center mt-3 text-sm">
                <span className="text-slate-600">{classroom.name}</span>
                <span className={classDiaries.length === classStudents.length ? 'text-green-600' : 'text-amber-600'}>
                  {classDiaries.length}/{classStudents.length}
                </span>
              </div>
            );
          })}
        </motion.div>

        {/* Payments Summary */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl p-5 shadow-sm border"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-rose-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">Pagos pendientes</h3>
              <p className="text-sm text-slate-500">{pendingCharges.length} cargos</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-xl font-bold text-slate-800">${totalPending.toLocaleString()}</p>
              <p className="text-xs text-red-600">{overdueCharges.length} vencidos</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="bg-amber-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-amber-600">{pendingCharges.length - overdueCharges.length}</p>
              <p className="text-xs text-amber-800">Por vencer</p>
            </div>
            <div className="bg-red-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-red-600">{overdueCharges.length}</p>
              <p className="text-xs text-red-800">Vencidos</p>
            </div>
          </div>
        </motion.div>

        {/* Notices Summary */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-2xl p-5 shadow-sm border"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
              <Bell className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">Avisos esta semana</h3>
              <p className="text-sm text-slate-500">{weekNotices.length} enviados</p>
            </div>
            {urgentNotices > 0 && (
              <div className="ml-auto bg-red-100 text-red-800 px-3 py-1 rounded-full text-sm font-medium">
                {urgentNotices} urgente{urgentNotices > 1 ? 's' : ''}
              </div>
            )}
          </div>
        </motion.div>

        {/* Upcoming Events */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-2xl p-5 shadow-sm border"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">Próximos eventos</h3>
              <p className="text-sm text-slate-500">{upcomingEvents.length} programados</p>
            </div>
          </div>
          {upcomingEvents.slice(0, 3).map((event) => (
            <div key={event.id} className="flex items-center gap-3 py-2 border-t border-slate-100">
              <div className="w-10 h-10 rounded-lg bg-slate-100 flex flex-col items-center justify-center text-xs">
                <span className="font-bold">{format(new Date(event.date), 'd')}</span>
                <span className="text-slate-500">{format(new Date(event.date), 'MMM', { locale: es })}</span>
              </div>
              <div>
                <p className="font-medium text-slate-800">{event.title}</p>
                {event.time && <p className="text-xs text-slate-500">{event.time}</p>}
              </div>
            </div>
          ))}
        </motion.div>

        {/* Quick Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="grid grid-cols-2 gap-3"
        >
          <div className="bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl p-4 text-white">
            <Users className="w-6 h-6 mb-2 opacity-80" />
            <p className="text-3xl font-bold">{students.length}</p>
            <p className="text-sm opacity-80">Alumnos activos</p>
          </div>
          <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-4 text-white">
            <BarChart3 className="w-6 h-6 mb-2 opacity-80" />
            <p className="text-3xl font-bold">{classrooms.length}</p>
            <p className="text-sm opacity-80">Salones</p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}