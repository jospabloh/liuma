import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import EmptyState from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, ArrowRight, CalendarDays } from 'lucide-react';
import { format } from 'date-fns';
import { createPageUrl } from '@/utils';
import { useNavigate } from 'react-router-dom';
import { getLinkedStudents } from '@/lib/relations/getLinkedStudents';

const CATEGORIES = ['ALL', 'ATTENDANCE', 'HOMEWORK', 'DIARY', 'NOTICE', 'EVENT'];
const URGENCY = ['ALL', 'URGENT', 'NORMAL'];

const roleDefaults = {
  ADMIN: 'SCHOOL',
  TEACHER: 'CLASSROOMS',
  PARENT: 'STUDENTS',
};

const linkByCategory = {
  ATTENDANCE: 'Asistencia',
  HOMEWORK: 'Tarea',
  DIARY: 'Bitacora',
  NOTICE: 'Avisos',
  EVENT: 'CalendarioEscolar',
};

export default function OperacionDiaria() {
  const navigate = useNavigate();
  const [category, setCategory] = useState('ALL');
  const [urgency, setUrgency] = useState('ALL');
  const today = format(new Date(), 'yyyy-MM-dd');

  const { data, isLoading } = useQuery({
    queryKey: ['dailyTimeline', today],
    queryFn: async () => {
      const user = await base44.auth.me();
      const profiles = await base44.entities.UserProfile.filter({ user_id: user.id });
      const userProfile = profiles[0];
      if (!userProfile) return { role: null, items: [] };

      const role = userProfile.app_role;
      const school_id = userProfile.school_id;

      const [teacherLinks, linked] = await Promise.all([
        role === 'TEACHER' ? base44.entities.TeacherClassroom.filter({ teacher_id: user.id, is_active: true }) : [],
        role === 'PARENT' ? getLinkedStudents(user) : { students: [], studentIds: [] },
      ]);

      const classroomIds = teacherLinks.map((row) => row.classroom_id).filter(Boolean);
      const studentIds = linked.studentIds || [];

      const [attendanceRows, homeworkRows, diaryRows, noticeRows, eventRows] = await Promise.all([
        base44.entities.Attendance.filter({ school_id, date: today }, '-updated_date', 200),
        base44.entities.Homework.filter({ school_id }, '-created_date', 100),
        base44.entities.DiaryEntry.filter({ school_id, date: today }, '-updated_date', 200),
        base44.entities.Notice.filter({ school_id }, '-created_date', 100),
        base44.entities.Event.filter({ school_id }, 'date', 100),
      ]);

      const roleFiltered = {
        attendance: attendanceRows.filter((row) => {
          if (role === 'ADMIN') return true;
          if (role === 'TEACHER') return classroomIds.includes(row.classroom_id);
          return studentIds.includes(row.student_id);
        }),
        homework: homeworkRows.filter((row) => {
          if (role === 'ADMIN') return true;
          if (role === 'TEACHER') return classroomIds.includes(row.classroom_id);
          return studentIds.includes(row.student_id) || studentIds.length === 0 ? false : true;
        }),
        diary: diaryRows.filter((row) => {
          if (role === 'ADMIN') return true;
          if (role === 'TEACHER') return classroomIds.includes(row.classroom_id);
          return studentIds.includes(row.student_id);
        }),
        notices: noticeRows.filter((row) => {
          if (role === 'ADMIN') return true;
          if (row.scope === 'SCHOOL') return true;
          if (role === 'TEACHER') return classroomIds.includes(row.classroom_id);
          return studentIds.includes(row.student_id);
        }),
        events: eventRows.filter((row) => {
          if (row.date !== today) return false;
          if (role === 'ADMIN') return true;
          if (row.scope === 'SCHOOL') return true;
          if (role === 'TEACHER') return classroomIds.includes(row.classroom_id);
          return studentIds.includes(row.student_id);
        }),
      };

      const items = [
        ...roleFiltered.attendance.map((row) => ({ id: `att-${row.id}`, category: 'ATTENDANCE', title: `Asistencia ${row.status || 'pendiente'}`, detail: row.student_name || row.student_id, urgency: row.status === 'absent' ? 'URGENT' : 'NORMAL', ts: row.updated_date || row.created_date })),
        ...roleFiltered.homework.map((row) => ({ id: `hw-${row.id}`, category: 'HOMEWORK', title: row.title || 'Tarea', detail: row.description || row.instructions || 'Sin descripción', urgency: row.priority === 'URGENT' ? 'URGENT' : 'NORMAL', ts: row.created_date })),
        ...roleFiltered.diary.map((row) => ({ id: `diary-${row.id}`, category: 'DIARY', title: row.student_name || 'Bitácora diaria', detail: row.notes || row.summary || 'Registro diario', urgency: 'NORMAL', ts: row.updated_date || row.created_date })),
        ...roleFiltered.notices.map((row) => ({ id: `notice-${row.id}`, category: 'NOTICE', title: row.title || 'Aviso', detail: row.content || row.message || 'Sin contenido', urgency: row.priority === 'URGENT' || row.is_emergency ? 'URGENT' : 'NORMAL', ts: row.created_date })),
        ...roleFiltered.events.map((row) => ({ id: `event-${row.id}`, category: 'EVENT', title: row.title || 'Evento', detail: row.time || 'Todo el día', urgency: row.is_mandatory ? 'URGENT' : 'NORMAL', ts: row.date })),
      ].sort((a, b) => new Date(b.ts || today) - new Date(a.ts || today));

      return { role, items };
    },
  });

  const filteredItems = useMemo(() => {
    const all = data?.items || [];
    return all.filter((item) => {
      if (category !== 'ALL' && item.category !== category) return false;
      if (urgency !== 'ALL' && item.urgency !== urgency) return false;
      return true;
    });
  }, [data, category, urgency]);

  if (isLoading) return <LoadingScreen message="Cargando operación diaria..." />;
  if (!data?.role) return <EmptyState icon={AlertCircle} title="Perfil no disponible" />;

  return (
    <>
      <PageHeader title="Operación Diaria" subtitle={`Vista por rol: ${roleDefaults[data.role]}`} showBack />
      <div className="max-w-5xl mx-auto px-4 space-y-4 pb-12">
        <Card className="p-4">
          <div className="flex flex-wrap gap-2 mb-3">
            {CATEGORIES.map((c) => (
              <Button key={c} size="sm" variant={category === c ? 'default' : 'outline'} onClick={() => setCategory(c)}>{c}</Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {URGENCY.map((u) => (
              <Button key={u} size="sm" variant={urgency === u ? 'default' : 'outline'} onClick={() => setUrgency(u)}>{u}</Button>
            ))}
          </div>
        </Card>

        {filteredItems.length === 0 ? (
          <EmptyState icon={CalendarDays} title="Sin eventos para hoy" description="No hay elementos para los filtros seleccionados." />
        ) : (
          filteredItems.map((item) => (
            <Card key={item.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge>{item.category}</Badge>
                    <Badge variant={item.urgency === 'URGENT' ? 'destructive' : 'secondary'}>{item.urgency}</Badge>
                  </div>
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="text-sm text-slate-600">{item.detail}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => navigate(createPageUrl(linkByCategory[item.category]))}>
                  Abrir <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
