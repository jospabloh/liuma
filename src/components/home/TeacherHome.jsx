import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { ClipboardList, BookOpen, Bell, CheckCircle, AlertCircle, Users, Calendar, ListChecks } from 'lucide-react';
import BigTile from '@/components/ui/BigTile';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Badge } from "@/components/ui/badge";
import { createPageUrl } from '@/utils';
import { getLinkedClassrooms } from '@/lib/relations/getLinkedClassrooms';
import { Card } from "@/components/ui/card";

function UpcomingEventsSection({ schoolId, classroomIds }) {
  const { data: events = [] } = useQuery({
    queryKey: ['upcomingEvents', schoolId, classroomIds],
    queryFn: async () => {
      const allEvents = await base44.entities.Event.filter({ 
        school_id: schoolId 
      }, 'date', 10);
      const upcoming = allEvents.filter(e => new Date(e.date) >= new Date());
      return upcoming.filter(e => 
        e.scope === 'SCHOOL' || classroomIds.includes(e.classroom_id)
      ).slice(0, 3);
    },
    enabled: !!schoolId
  });

  if (events.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.35 }}
      className="mt-8"
    >
      <h2 className="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
        <Calendar className="w-5 h-5 text-blue-600" />
        Próximos eventos
      </h2>
      <div className="space-y-2">
        {events.map(event => (
          <Card key={event.id} className="p-3 bg-blue-50 border-blue-200">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex flex-col items-center justify-center text-xs font-bold">
                <span>{format(new Date(event.date), 'd')}</span>
                <span className="text-[10px]">{format(new Date(event.date), 'MMM', { locale: es })}</span>
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-slate-800">{event.title}</h4>
                <p className="text-xs text-slate-600">{event.time || 'Todo el día'}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </motion.div>
  );
}

export default function TeacherHome({ user, userProfile, subscription }) {
  const today = format(new Date(), 'yyyy-MM-dd');

  const { data: linkedClassrooms = { classrooms: [], classroomIds: [] } } = useQuery({
    queryKey: ['linkedClassrooms', user.id],
    queryFn: () => getLinkedClassrooms(user),
  });

  const classroomIds = linkedClassrooms.classroomIds;
  const classrooms = linkedClassrooms.classrooms;

  // Get students in classrooms
  const { data: students = [] } = useQuery({
    queryKey: ['students', classroomIds],
    queryFn: async () => {
      if (classroomIds.length === 0) return [];
      const allStudents = [];
      for (const id of classroomIds) {
        const classStudents = await base44.entities.Student.filter({ 
          classroom_id: id,
          is_active: true 
        });
        allStudents.push(...classStudents);
      }
      return allStudents;
    },
    enabled: classroomIds.length > 0,
  });

  // Get today's diary entries
  const { data: todayDiaries = [] } = useQuery({
    queryKey: ['todayDiaries', today, classroomIds],
    queryFn: async () => {
      if (classroomIds.length === 0) return [];
      const diaries = await base44.entities.DiaryEntry.filter({ 
        date: today,
        school_id: userProfile.school_id
      });
      return diaries.filter(d => classroomIds.includes(d.classroom_id));
    },
    enabled: classroomIds.length > 0,
  });


  const { data: unreadUrgentNotices = [] } = useQuery({
    queryKey: ['teacherUnreadUrgentNotices', user.id, userProfile.school_id],
    queryFn: async () => {
      const rows = await base44.entities.NoticeDelivery.filter({
        school_id: userProfile.school_id,
        status: 'SENT',
      }, '-created_date', 100);
      const studentRows = await base44.entities.Student.filter({ is_active: true });
      const classStudentIds = new Set(studentRows.filter((student) => classroomIds.includes(student.classroom_id)).map((student) => student.id));
      const relevantDeliveries = rows.filter((row) => classStudentIds.has(row.student_id));
      const urgentNotices = await base44.entities.Notice.filter({ school_id: userProfile.school_id, priority: 'URGENT' }, '-created_date', 50);
      const urgentIds = new Set(urgentNotices.map((notice) => notice.id));
      return relevantDeliveries.filter((row) => urgentIds.has(row.notice_id));
    },
    enabled: classroomIds.length > 0,
  });

  const studentsWithDiary = new Set(todayDiaries.map(d => d.student_id));
  const studentsMissingDiary = students.filter(s => !studentsWithDiary.has(s.id));
  const diaryProgress = students.length > 0 
    ? Math.round((todayDiaries.length / students.length) * 100) 
    : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-700 px-6 pt-12 pb-8">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <p className="text-emerald-200 text-sm">
            {format(new Date(), "EEEE d 'de' MMMM", { locale: es })}
          </p>
          <h1 className="text-2xl font-bold text-white mt-1">
            Hola, {user.full_name?.split(' ')[0] || 'Maestro'}
          </h1>
        </motion.div>
      </div>

      {/* Diary Progress */}
      <div className="px-6 -mt-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-4 shadow-lg border border-slate-100"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-800">Bitácoras de hoy</h3>
            <Badge className={diaryProgress === 100 ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}>
              {diaryProgress === 100 ? (
                <><CheckCircle className="w-3 h-3 mr-1" /> Completo</>
              ) : (
                <><AlertCircle className="w-3 h-3 mr-1" /> {studentsMissingDiary.length} pendientes</>
              )}
            </Badge>
          </div>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${diaryProgress}%` }}
              transition={{ delay: 0.5, duration: 0.8 }}
              className={`h-full rounded-full ${
                diaryProgress === 100 ? 'bg-green-500' : 'bg-amber-500'
              }`}
            />
          </div>
          <p className="text-sm text-slate-500 mt-2">
            {todayDiaries.length} de {students.length} alumnos
          </p>
        </motion.div>
      </div>

      {/* Main Content */}
      <div className="px-6 mt-6 pb-24">
        {/* Main Tiles */}
        <div className="space-y-3">
          <BigTile
            icon={ClipboardList}
            title="Bitácoras de hoy"
            subtitle={`${classrooms.length} salón${classrooms.length !== 1 ? 'es' : ''}`}
            badge={studentsMissingDiary.length}
            badgeColor="bg-amber-500"
            href={createPageUrl('BitacorasMaestro')}
            color="from-emerald-50 to-white"
            iconColor="text-emerald-600"
            delay={0.1}
          />
          <BigTile
            icon={BookOpen}
            title="Tarea"
            subtitle="Asignar tarea"
            href={createPageUrl('TareaMaestro')}
            color="from-blue-50 to-white"
            iconColor="text-blue-600"
            delay={0.15}
          />
          <BigTile
            icon={Bell}
            title="Avisos"
            subtitle={unreadUrgentNotices.length > 0 ? `${unreadUrgentNotices.length} urgentes sin leer` : 'Enviar comunicado'}
            href={createPageUrl('AvisosMaestro')}
            badge={unreadUrgentNotices.length}
            badgeColor="bg-red-500"
            color="from-violet-50 to-white"
            iconColor="text-violet-600"
            delay={0.2}
          />
          <BigTile
            icon={Users}
            title="Asistencia"
            subtitle="Registrar hoy"
            href={createPageUrl('Asistencia')}
            color="from-green-50 to-white"
            iconColor="text-green-600"
            delay={0.25}
          />
          <BigTile
            icon={Calendar}
            title="Calendario"
            subtitle="Ver eventos escolares"
            href={createPageUrl('CalendarioEscolar')}
            color="from-blue-50 to-white"
            iconColor="text-blue-600"
            delay={0.3}
          />
          <BigTile
            icon={ListChecks}
            title="Operación Diaria"
            subtitle="Mi timeline del día"
            href={createPageUrl('OperacionDiaria')}
            color="from-lime-50 to-white"
            iconColor="text-lime-600"
            delay={0.35}
          />
        </div>

        {/* Upcoming Events Section */}
        <UpcomingEventsSection schoolId={userProfile.school_id} classroomIds={classroomIds} />

        {/* Classrooms Overview */}
        {classrooms.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-8"
          >
            <h2 className="text-lg font-semibold text-slate-800 mb-3">
              Mis salones
            </h2>
            <div className="space-y-2">
              {classrooms.map((classroom) => {
                const classStudents = students.filter(s => s.classroom_id === classroom.id);
                const classDiaries = todayDiaries.filter(d => d.classroom_id === classroom.id);
                const progress = classStudents.length > 0 
                  ? Math.round((classDiaries.length / classStudents.length) * 100) 
                  : 0;
                
                return (
                  <div
                    key={classroom.id}
                    className="bg-white rounded-xl p-4 border border-slate-100"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium text-slate-800">{classroom.name}</h4>
                        <p className="text-sm text-slate-500">
                          {classDiaries.length}/{classStudents.length} bitácoras
                        </p>
                      </div>
                      <div className={`text-2xl font-bold ${
                        progress === 100 ? 'text-green-600' : 'text-amber-600'
                      }`}>
                        {progress}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </div>

    </div>
  );
}