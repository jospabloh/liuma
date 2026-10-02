import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { schoolReadContext, schoolReadMany } from '@/lib/data/schoolRead';
import { motion } from 'framer-motion';
import { ClipboardList, BookOpen, Bell, CheckCircle, AlertCircle, Users, Calendar, ListChecks, LifeBuoy } from 'lucide-react';
import BigTile from '@/components/ui/BigTile';
import { HomeHeader, HomeSection } from '@/components/home/HomeChrome';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Badge } from "@/components/ui/badge";
import { createPageUrl } from '@/utils';
import { Card } from "@/components/ui/card";
import { formatLocalDate, parseLocalDate, schoolToday, schoolTodayDate } from '@/lib/dates';
import { diaryCoverage } from '@/lib/diaryCoverage';
import LoadError from '@/components/ui/LoadError';
import { blockingLoadFailure } from '@/lib/loadFailure';
import { unreadNoticeCount } from '@/lib/notifications/inbox';
import { countLabel } from '@/lib/spanishText';
import { greetingFor } from '@/lib/userDisplayName';

// `events`: upcoming events the server already limited to the school-wide
// ones and this teacher's classrooms (read with the rest of the home lists).
function UpcomingEventsSection({ events }) {
  if (events.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.35 }}
      className="mt-8"
    >
      <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
        <Calendar className="w-5 h-5 text-brand" />
        Próximos eventos
      </h2>
      <div className="space-y-2">
        {events.map(event => {
          const eventDate = parseLocalDate(event.date);
          return (
          <Card key={event.id} className="p-3 bg-card border-border">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-brand text-white flex flex-col items-center justify-center text-xs font-bold">
                <span>{eventDate ? format(eventDate, 'd') : '—'}</span>
                <span className="text-[10px]">{eventDate ? format(eventDate, 'MMM', { locale: es }) : ''}</span>
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-card-foreground">{event.title}</h4>
                <p className="text-xs text-muted-foreground">{event.time || 'Todo el día'}</p>
              </div>
            </div>
          </Card>
          );
        })}
      </div>
    </motion.div>
  );
}

export default function TeacherHome({ user, userProfile, subscription }) {
  const today = schoolToday();

  // One request for the teacher's classrooms AND their active students:
  // schoolRead's `context` derives both server-side from TeacherClassroom
  // (P10 — this used to be a TeacherClassroom read, a Classroom read and a
  // Student read, and the student list was fetched a second time for the
  // urgent-notice badge).
  const scopeQuery = useQuery({
    queryKey: ['teacherScope', user.id],
    queryFn: async () => {
      const context = await schoolReadContext();
      const byId = new Map(context.classrooms.map((c) => [c.id, c]));
      return {
        classroomIds: context.classroomIds,
        classrooms: context.classroomIds.map((id) => byId.get(id)).filter(Boolean),
        students: context.students,
      };
    },
  });
  const { data: teacherScope = { classrooms: [], classroomIds: [], students: [] } } = scopeQuery;

  const classroomIds = teacherScope.classroomIds;
  const classrooms = teacherScope.classrooms;
  const students = teacherScope.students;

  // Everything else on the home screen in ONE request (one scope derivation
  // on the server instead of one per list): today's diary entries, upcoming
  // events, and this teacher's OWN unread urgent notices (the same copies
  // AvisosMaestro's "Recibidos de la escuela" lists — see unreadNoticeCount).
  // The server already limits every list to this teacher's classrooms/students.
  // Key starts with 'todayDiaries' so CrearBitacora's invalidation reaches it.
  // It does not wait for the scope above (v1.8.3): the server scopes these
  // lists itself, so both leave at mount and travel as ONE schoolRead request
  // (schoolReadCore.js batches them), one scope derivation instead of two.
  const listsQuery = useQuery({
    queryKey: ['todayDiaries', 'teacherHome', today, user.id, userProfile.school_id],
    queryFn: async () => {
      const school_id = userProfile.school_id;
      return schoolReadMany({
        diaries: ['DiaryEntry', { school_id, date: today }],
        // Today onward (YYYY-MM-DD compares as text).
        events: ['Event', { school_id, date: { $gte: formatLocalDate() } }, 'date', 3],
        // Only the copies addressed to this teacher. schoolRead would also
        // return their families' copies, which is how one alert read as
        // "4 urgentes sin leer" — and those a teacher can never mark read.
        deliveries: ['NoticeDelivery', { school_id, recipient_user_id: user.id, status: 'SENT' }, '-created_date', 100],
        urgent: ['Notice', { school_id, priority: 'URGENT' }, '-created_date', 50],
      });
    },
  });
  const { data: homeLists = { diaries: [], events: [], deliveries: [], urgent: [] } } = listsQuery;
  // A failed read is not "0 pendientes" (v1.8.3): say so, with a retry,
  // instead of a home whose counts are silently zero.
  const loadFailure = blockingLoadFailure(scopeQuery, listsQuery);

  const todayDiaries = homeLists.diaries.filter((d) => classroomIds.includes(d.classroom_id));
  // Notices, not copies, and only the teacher's own: the badge has to match
  // what tapping it shows (AvisosMaestro → "Recibidos de la escuela").
  const unreadUrgentCount = unreadNoticeCount(homeLists.deliveries, homeLists.urgent, { userId: user.id });

  // Counted in students, not entries: two bitácoras for one child do not
  // cover a second child (see diaryCoverage.js).
  const diaryStats = diaryCoverage(students, todayDiaries);
  const studentsMissingDiary = diaryStats.missing;
  const diaryProgress = diaryStats.percent;

  return (
    <div className="min-h-screen bg-background">
      <HomeHeader
        eyebrow={format(schoolTodayDate(), "EEEE d 'de' MMMM", { locale: es })}
        title={greetingFor(user)}
      />

      {/* Diary Progress */}
      <div className="relative z-10 mx-auto max-w-2xl px-6 -mt-6">
        {loadFailure && (
          <LoadError compact failure={loadFailure} title="No se pudieron cargar tus salones y pendientes" className="mb-4" />
        )}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card rounded-2xl p-4 shadow-sm border border-border"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-card-foreground">Bitácoras de hoy</h3>
            <Badge className={diaryStats.complete ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300'}>
              {diaryStats.complete ? (
                <><CheckCircle className="w-3 h-3 mr-1" /> Completo</>
              ) : (
                <><AlertCircle className="w-3 h-3 mr-1" /> {studentsMissingDiary.length} pendientes</>
              )}
            </Badge>
          </div>
          <div className="h-3 bg-muted rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${diaryProgress}%` }}
              transition={{ delay: 0.5, duration: 0.8 }}
              className={`h-full rounded-full ${
                diaryStats.complete ? 'bg-green-500' : 'bg-amber-500'
              }`}
            />
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            {diaryStats.covered} de {diaryStats.total} alumnos
          </p>
        </motion.div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-2xl px-6 mt-7 pb-24">
        <div className="space-y-7">
          <HomeSection label="Día a día">
            <BigTile
              icon={ClipboardList}
              title="Bitácoras de hoy"
              subtitle={countLabel(classrooms.length, 'salón', 'salones')}
              badge={studentsMissingDiary.length}
              badgeColor="bg-amber-500"
              href={createPageUrl('BitacorasMaestro')}
              delay={0.05}
            />
            <BigTile
              icon={Users}
              title="Asistencia"
              subtitle="Registrar hoy"
              href={createPageUrl('Asistencia')}
              delay={0.1}
            />
            <BigTile
              icon={BookOpen}
              title="Tarea"
              subtitle="Asignar tarea"
              href={createPageUrl('TareaMaestro')}
              delay={0.15}
            />
            <BigTile
              icon={ListChecks}
              title="Operación diaria"
              subtitle="Mi timeline del día"
              href={createPageUrl('OperacionDiaria')}
              delay={0.2}
            />
          </HomeSection>

          <HomeSection label="Comunicación">
            <BigTile
              icon={Bell}
              title="Avisos"
              subtitle={unreadUrgentCount > 0 ? countLabel(unreadUrgentCount, 'urgente sin leer', 'urgentes sin leer') : 'Enviar comunicado'}
              href={createPageUrl('AvisosMaestro')}
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

        {/* Upcoming Events Section */}
        <UpcomingEventsSection events={homeLists.events} />

        {/* Classrooms Overview */}
        {classrooms.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-8"
          >
            <h2 className="text-lg font-semibold text-foreground mb-3">
              Mis salones
            </h2>
            <div className="space-y-2">
              {classrooms.map((classroom) => {
                const classStudents = students.filter(s => s.classroom_id === classroom.id);
                const classStats = diaryCoverage(classStudents, todayDiaries.filter(d => d.classroom_id === classroom.id));
                const progress = classStats.percent;

                return (
                  <div
                    key={classroom.id}
                    className="bg-card rounded-xl p-4 border border-border"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium text-card-foreground">{classroom.name}</h4>
                        <p className="text-sm text-muted-foreground">
                          {classStats.covered}/{classStats.total} alumnos con bitácora
                        </p>
                      </div>
                      <div className={`text-2xl font-bold ${
                        classStats.complete ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'
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