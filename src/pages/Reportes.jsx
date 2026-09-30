import React, { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { schoolRead, SCHOOL_READ_ALL } from '@/lib/data/schoolRead';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { BarChart3, Users, ClipboardList, CreditCard, Bell, Calendar, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { format, startOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { canReadEntity } from '@/lib/authorization/policy';
import { canExportReports, exportReportCSV, exportReportPDF } from '@/lib/report-export';
import { attendanceSummary, diaryCoverage } from '@/lib/reports/kpis';
import { isBeforeToday, parseLocalDate, schoolToday, schoolTodayDate } from '@/lib/dates';
import { toast } from 'sonner';

export default function Reportes() {
  const reportRef = useRef(null);
  const today = schoolToday();
  const [filters, setFilters] = useState({ dateFrom: today, dateTo: today, classroomId: 'ALL', studentStatus: 'ACTIVE', roleScope: 'ALL' });
  const [openPanel, setOpenPanel] = useState(null);

  const { user, userProfile } = useCurrentProfile();
  const role = userProfile?.app_role || 'PARENT';

  const { data: students = [] } = useQuery({
    queryKey: ['allStudents', userProfile?.school_id],
    queryFn: () => schoolRead('Student', { school_id: userProfile.school_id }),
    enabled: !!userProfile,
  });

  const { data: classrooms = [] } = useQuery({
    queryKey: ['allClassrooms', userProfile?.school_id],
    queryFn: () => schoolRead('Classroom', { school_id: userProfile.school_id, is_active: true }),
    enabled: !!userProfile,
  });

  // Date range and salón are applied by the server (same shape as
  // ResumenAsistencia), and every page is read: the page used to pull the
  // school's whole history and filter it here, which the SDK silently cut at
  // 5,000 records — a month of a 300-student school. Through schoolRead
  // (P10): the entity RLS only shows a director the rows they wrote
  // themselves. SCHOOL_READ_ALL throws "acota las fechas" rather than
  // report a cut total.
  const rangeValid = !!filters.dateFrom && !!filters.dateTo && filters.dateFrom <= filters.dateTo;
  const rangeQuery = (schoolId) => ({
    school_id: schoolId,
    date: { $gte: filters.dateFrom, $lte: filters.dateTo },
    ...(filters.classroomId !== 'ALL' && { classroom_id: filters.classroomId }),
  });

  const { data: attendances = [], isError: attendanceError, isLoading: attendanceLoading } = useQuery({
    queryKey: ['attendanceReport', userProfile?.school_id, filters.dateFrom, filters.dateTo, filters.classroomId],
    queryFn: () => schoolRead('Attendance', rangeQuery(userProfile.school_id), 'date', SCHOOL_READ_ALL),
    enabled: !!userProfile && rangeValid && canReadEntity(role, 'Attendance'),
  });

  const { data: diaries = [], isError: diariesError, isLoading: diariesLoading } = useQuery({
    queryKey: ['diariesReport', userProfile?.school_id, filters.dateFrom, filters.dateTo, filters.classroomId],
    queryFn: () => schoolRead('DiaryEntry', rangeQuery(userProfile.school_id), 'date', SCHOOL_READ_ALL),
    enabled: !!userProfile && rangeValid && canReadEntity(role, 'DiaryEntry'),
  });

  const { data: pendingCharges = [] } = useQuery({
    queryKey: ['pendingCharges', userProfile?.school_id],
    queryFn: () => schoolRead('ChargeItem', { school_id: userProfile.school_id, status: 'PENDING' }),
    enabled: !!userProfile && canReadEntity(role, 'ChargeItem'),
  });

  const { data: notices = [] } = useQuery({
    queryKey: ['notices', userProfile?.school_id],
    queryFn: () => schoolRead('Notice', { school_id: userProfile.school_id }, '-created_date', 100),
    enabled: !!userProfile && canReadEntity(role, 'Notice'),
  });

  const { data: upcomingEvents = [], isLoading } = useQuery({
    queryKey: ['upcomingEvents', userProfile?.school_id],
    // Upcoming = dated today or later, filtered by the server. Taking the first
    // 10 by date and filtering here returned nothing once a school had 10 past events.
    queryFn: () => schoolRead('Event', { school_id: userProfile.school_id, date: { $gte: today } }, 'date', 10),
    enabled: !!userProfile,
  });

  const filteredStudents = useMemo(() => students.filter((s) => {
    if (filters.classroomId !== 'ALL' && s.classroom_id !== filters.classroomId) return false;
    if (filters.studentStatus === 'ACTIVE') return s.is_active !== false;
    if (filters.studentStatus === 'INACTIVE') return s.is_active === false;
    return true;
  }), [students, filters.classroomId, filters.studentStatus]);

  const attendance = useMemo(() => attendanceSummary(attendances), [attendances]);
  const diary = useMemo(
    () => diaryCoverage({ diaries, students: filteredStudents, dateFrom: filters.dateFrom, dateTo: filters.dateTo, today }),
    [diaries, filteredStudents, filters.dateFrom, filters.dateTo, today],
  );
  const weekStart = startOfWeek(schoolTodayDate(), { weekStartsOn: 1 });
  const weekNotices = notices.filter((n) => new Date(n.created_date) >= weekStart).filter((n) => filters.roleScope === 'ALL' || (n.scope || 'SCHOOL') === filters.roleScope);

  // While a range loads, show a placeholder rather than a 0% that reads as
  // "nobody came", and do not let it be exported.
  const kpisLoading = attendanceLoading || diariesLoading;
  const attendanceRate = attendance.rate;
  const diaryProgress = diary.percent;
  const overdueCharges = pendingCharges.filter((c) => isBeforeToday(c.due_date));
  const totalPending = pendingCharges.reduce((sum, c) => sum + (c.amount || 0), 0);
  const urgentNotices = weekNotices.filter((n) => n.priority === 'URGENT').length;
  const freshnessLabel = format(new Date(), "d MMM yyyy, HH:mm", { locale: es });

  const canExport = canExportReports(role);
  const togglePanel = (key) => setOpenPanel(openPanel === key ? null : key);

  const exportRows = [
    { kpi: 'Asistencia', valor: `${attendanceRate}%`, periodo: `${filters.dateFrom} a ${filters.dateTo}` },
    { kpi: 'Bitácoras', valor: `${diaryProgress}% (${diary.covered}/${diary.expected})`, periodo: `${filters.dateFrom} a ${filters.dateTo}` },
    { kpi: 'Pagos pendientes', valor: totalPending, periodo: 'Actual' },
    { kpi: 'Avisos urgentes', valor: urgentNotices, periodo: 'Semana actual' },
  ];

  const handleExportPDF = async () => {
    if (!canExport) return;
    try {
      await exportReportPDF({ element: reportRef.current, fileName: `reportes-${today}.pdf` });
    } catch (error) {
      console.error('Error exporting PDF:', error);
      toast.error('No se pudo generar el PDF. Intenta de nuevo.');
    }
  };

  if (isLoading) return <LoadingScreen message="Cargando reportes..." />;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 pb-24">
      <PageHeader eyebrow="Administración" title="Reportes" subtitle={format(schoolTodayDate(), "EEEE d 'de' MMMM", { locale: es })} showBack backTo={createPageUrl('Home')} />

      <div className="bg-card text-card-foreground border border-border rounded-2xl shadow-sm p-4 mb-4">
        <p className="text-xs text-muted-foreground mb-2">Filtros</p>
        <div className="grid md:grid-cols-4 gap-3">
          <input className="ui-field" type="date" value={filters.dateFrom} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
          <input className="ui-field" type="date" value={filters.dateTo} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} />
          <select className="ui-field" value={filters.classroomId} onChange={(e) => setFilters((f) => ({ ...f, classroomId: e.target.value }))}>
            <option value="ALL">Todos los salones</option>
            {classrooms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="ui-field" value={filters.studentStatus} onChange={(e) => setFilters((f) => ({ ...f, studentStatus: e.target.value }))}>
            <option value="ALL">Todos los estados</option><option value="ACTIVE">Activos</option><option value="INACTIVE">Inactivos</option>
          </select>
        </div>
        <div className="grid md:grid-cols-2 gap-3 mt-3">
          <select className="ui-field" value={filters.roleScope} onChange={(e) => setFilters((f) => ({ ...f, roleScope: e.target.value }))}>
            <option value="ALL">Alcance: todos</option><option value="SCHOOL">Escuela</option><option value="CLASSROOM">Salón</option><option value="STUDENT">Alumno</option>
          </select>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" disabled={!canExport || kpisLoading || attendanceError || diariesError} onClick={() => canExport && exportReportCSV({ fileName: `reportes-${today}.csv`, rows: exportRows })}><Download className="w-4 h-4 mr-2" />CSV</Button>
            <Button variant="outline" disabled={!canExport || kpisLoading || attendanceError || diariesError} onClick={handleExportPDF}><Download className="w-4 h-4 mr-2" />PDF</Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">Datos actualizados: {freshnessLabel}</p>
        {!canExport && <p className="text-xs text-red-600 dark:text-red-400 mt-1">No tienes permisos para exportar reportes.</p>}
        {!rangeValid && <p className="text-xs text-red-600 dark:text-red-400 mt-1">La fecha inicial debe ser anterior o igual a la final.</p>}
        {(attendanceError || diariesError) && <p className="text-xs text-red-600 dark:text-red-400 mt-1">No se pudieron cargar todos los datos del periodo; las cifras pueden estar incompletas.</p>}
      </div>

      <div className="space-y-4" ref={reportRef}>
        <motion.div className="bg-card text-card-foreground rounded-2xl p-5 shadow-sm border border-border">
          <div className="flex items-center gap-3 mb-2"><div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center"><Users className="w-5 h-5 text-brand" /></div><div><h3 className="font-semibold text-card-foreground">Asistencia</h3><p className="text-sm text-muted-foreground">{attendanceLoading ? 'Cargando…' : `${attendance.total} registros`}</p></div><div className="ml-auto text-2xl font-bold text-brand" aria-busy={attendanceLoading}>{attendanceLoading ? '—' : `${attendanceRate}%`}</div></div>
          <button className="text-sm text-brand flex items-center gap-1" onClick={() => togglePanel('attendance')}>Ver detalle {openPanel === 'attendance' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>
          {openPanel === 'attendance' && <div className="mt-3 text-sm text-muted-foreground">Presentes: {attendance.present} · Tardanzas: {attendance.late} · Ausentes: {attendance.absent} · Justificados: {attendance.excused}<p className="text-xs mt-1">Asistencia = presentes + tardanzas sobre registros del periodo.</p></div>}
        </motion.div>

        <motion.div className="bg-card text-card-foreground rounded-2xl p-5 shadow-sm border border-border">
          <div className="flex items-center gap-3 mb-2"><div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center"><ClipboardList className="w-5 h-5 text-emerald-600 dark:text-emerald-400" /></div><div><h3 className="font-semibold text-card-foreground">Bitácoras</h3><p className="text-sm text-muted-foreground">{diariesLoading ? 'Cargando…' : `${diary.covered} de ${diary.expected} (alumno × día hábil)`}</p></div><div className="ml-auto text-2xl font-bold text-emerald-600 dark:text-emerald-400" aria-busy={diariesLoading}>{diariesLoading ? '—' : `${diaryProgress}%`}</div></div>
          <button className="text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-1" onClick={() => togglePanel('diary')}>Ver detalle {openPanel === 'diary' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>
          {openPanel === 'diary' && classrooms.map((classroom) => <div key={classroom.id} className="flex justify-between text-sm mt-2"><span>{classroom.name}</span><span>{diaries.filter((d) => d.classroom_id === classroom.id).length}</span></div>)}
        </motion.div>

        <motion.div className="bg-card text-card-foreground rounded-2xl p-5 shadow-sm border border-border">
          <div className="flex items-center gap-3 mb-2"><div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950/40 flex items-center justify-center"><CreditCard className="w-5 h-5 text-rose-600 dark:text-rose-400" /></div><div><h3 className="font-semibold text-card-foreground">Pagos pendientes</h3><p className="text-sm text-muted-foreground">{pendingCharges.length} cargos</p></div><div className="ml-auto text-right"><p className="text-xl font-bold text-card-foreground">${totalPending.toLocaleString()}</p><p className="text-xs text-red-600 dark:text-red-400">{overdueCharges.length} vencidos</p></div></div>
          <button className="text-sm text-rose-700 dark:text-rose-400 flex items-center gap-1" onClick={() => togglePanel('payments')}>Ver detalle {openPanel === 'payments' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>
          {openPanel === 'payments' && <div className="mt-3 text-sm text-muted-foreground">Por vencer: {pendingCharges.length - overdueCharges.length} · Vencidos: {overdueCharges.length}</div>}
        </motion.div>

        <motion.div className="bg-card text-card-foreground rounded-2xl p-5 shadow-sm border border-border">
          <div className="flex items-center gap-3 mb-2"><div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center"><Bell className="w-5 h-5 text-brand" /></div><div><h3 className="font-semibold text-card-foreground">Avisos</h3><p className="text-sm text-muted-foreground">{weekNotices.length} enviados</p></div><div className="ml-auto bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300 px-3 py-1 rounded-full text-sm font-medium">{urgentNotices} urgentes</div></div>
          <button className="text-sm text-brand flex items-center gap-1" onClick={() => togglePanel('notices')}>Ver detalle {openPanel === 'notices' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>
          {openPanel === 'notices' && weekNotices.slice(0, 5).map((n) => <div key={n.id} className="text-sm border-t border-border pt-2 mt-2">{n.title}</div>)}
        </motion.div>

        <motion.div className="bg-card text-card-foreground rounded-2xl p-5 shadow-sm border border-border">
          <div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center"><Calendar className="w-5 h-5 text-brand" /></div><div><h3 className="font-semibold text-card-foreground">Próximos eventos</h3><p className="text-sm text-muted-foreground">{upcomingEvents.length} programados</p></div></div>
          {upcomingEvents.slice(0, 3).map((event) => <div key={event.id} className="flex items-center gap-3 py-2 border-t border-border"><div className="w-10 h-10 rounded-lg bg-muted flex flex-col items-center justify-center text-xs"><span className="font-bold">{format(parseLocalDate(event.date) || new Date(), 'd')}</span><span className="text-muted-foreground">{format(parseLocalDate(event.date) || new Date(), 'MMM', { locale: es })}</span></div><div><p className="font-medium text-card-foreground">{event.title}</p>{event.time && <p className="text-xs text-muted-foreground">{event.time}</p>}</div></div>)}
        </motion.div>

        <motion.div className="grid grid-cols-2 gap-3"><div className="bg-brand rounded-2xl p-4 text-white"><Users className="w-6 h-6 mb-2 opacity-80" /><p className="text-3xl font-bold">{filteredStudents.length}</p><p className="text-sm opacity-80">Alumnos filtrados</p></div><div className="bg-emerald-600 rounded-2xl p-4 text-white"><BarChart3 className="w-6 h-6 mb-2 opacity-80" /><p className="text-3xl font-bold">{classrooms.length}</p><p className="text-sm opacity-80">Salones</p></div></motion.div>
      </div>
      </div>
    </div>
  );
}
