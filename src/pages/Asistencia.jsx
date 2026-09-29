import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { schoolRead, schoolReadContext } from '@/lib/data/schoolRead';
import { invokeFunction } from '@/lib/functionResponse';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Calendar, CheckCircle2, XCircle, Clock, FileText, Filter, Users, AlertCircle, School } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/ui/PageHeader";
import LoadingScreen from "@/components/ui/LoadingScreen";
import EmptyState from '@/components/ui/EmptyState';
import { format, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import { canWriteEntity } from '@/lib/authorization/policy';
import { guardedCreate, guardedUpdate } from '@/lib/authorization/guardedWrite';
import { getLinkedStudents } from '@/lib/relations/getLinkedStudents';
import { AUDIT_ENTITIES, logAuditEvent } from '@/lib/audit';
import { ATTENDANCE_STATUS, ATTENDANCE_STATUSES, ATTENDANCE_STATUS_LABELS } from '@/lib/attendance/status';
import { formatLocalDate, parseLocalDate } from '@/lib/dates';
import ReadOnlyBanner from '@/components/subscription/ReadOnlyBanner';
import { useCanWrite, guardWrite } from '@/hooks/useCanWrite';

// Visual treatment per status. The values and Spanish copy come from
// src/lib/attendance/status.js (the schema's lowercase enum); only the
// colours live here. Tinted row backgrounds carry meaning, so each gets an
// explicit dark variant instead of washing out on the dark theme.
const STATUS_STYLE = {
  [ATTENDANCE_STATUS.PRESENT]: { icon: CheckCircle2, color: 'bg-green-600', bgColor: 'bg-green-50 dark:bg-green-950/40', borderColor: 'border-green-200 dark:border-green-900' },
  [ATTENDANCE_STATUS.ABSENT]: { icon: XCircle, color: 'bg-red-600', bgColor: 'bg-red-50 dark:bg-red-950/40', borderColor: 'border-red-200 dark:border-red-900' },
  [ATTENDANCE_STATUS.LATE]: { icon: Clock, color: 'bg-amber-600', bgColor: 'bg-amber-50 dark:bg-amber-950/40', borderColor: 'border-amber-200 dark:border-amber-900' },
  [ATTENDANCE_STATUS.EXCUSED]: { icon: FileText, color: 'bg-blue-600', bgColor: 'bg-blue-50 dark:bg-blue-950/40', borderColor: 'border-blue-200 dark:border-blue-900' },
};

const statusConfig = Object.fromEntries(
  ATTENDANCE_STATUSES.map((status) => [status, { ...ATTENDANCE_STATUS_LABELS[status], ...STATUS_STYLE[status] }]),
);

const attendanceQueryKey = (classroomId, date) => ['attendance', classroomId, date];
// A save in flight is tracked per (salón, fecha, alumno): if the teacher
// switches date while a row saves, the same child on the new date is not locked.
const pendingRowKey = (classroomId, date, studentId) => `${classroomId}|${date}|${studentId}`;

function TeacherAdminAttendanceView({ role, classrooms, classroomsError, selectedClassroom, setSelectedClassroom, selectedDate, setSelectedDate, students, loadingStudents, studentsError, attendanceRecords, pendingRowKeys, markAllPresentMutation, onMark, canWrite }) {
  const getStudentStatus = (studentId) => {
    const record = attendanceRecords.find(r => r.student_id === studentId);
    return record?.status || null;
  };

  const blockReadOnly = () => toast.error('Tu licencia está en modo solo lectura. Reactívala para registrar asistencia.');
  const isRowPending = (studentId) => pendingRowKeys.has(pendingRowKey(selectedClassroom, selectedDate, studentId));
  const pendingPrefix = pendingRowKey(selectedClassroom, selectedDate, '');
  const anyRowPending = [...pendingRowKeys].some((k) => k.startsWith(pendingPrefix));

  const renderBody = () => {
    if (classroomsError) {
      return <EmptyState icon={AlertCircle} title="No se pudieron cargar tus salones" description="Revisa tu conexión e intenta de nuevo en unos minutos." />;
    }
    if (classrooms.length === 0) {
      return role === 'TEACHER'
        ? <EmptyState icon={School} title="No tienes salones asignados" description="Pide a la dirección que te asigne un salón para poder registrar asistencia." />
        : <EmptyState icon={School} title="No hay salones activos" description="Crea o activa un salón en Gestión de la escuela para registrar asistencia." />;
    }
    if (!selectedClassroom) {
      return <EmptyState icon={Filter} title="Selecciona un salón" description="Elige el salón para ver su lista de alumnos." />;
    }
    if (loadingStudents) {
      return (
        <Card className="p-12 text-center" aria-busy="true">
          <div className="animate-spin w-8 h-8 border-4 border-brand border-t-transparent rounded-full mx-auto"></div>
        </Card>
      );
    }
    if (studentsError) {
      return <EmptyState icon={AlertCircle} title="No se pudo cargar la lista de alumnos" description="Intenta de nuevo en unos minutos." />;
    }
    if (students.length === 0) {
      return <EmptyState icon={Users} title="No hay alumnos en este salón" description="Cuando la dirección inscriba alumnos en este salón aparecerán aquí." />;
    }
    return (
      <div className="grid gap-3">
        {students.map((student, idx) => {
          const currentStatus = getStudentStatus(student.id);
          const config = currentStatus ? statusConfig[currentStatus] : null;
          // Only the row being saved is locked; the teacher can keep marking
          // the rest of the class while it saves.
          const rowPending = isRowPending(student.id);
          const rowDisabled = rowPending || markAllPresentMutation.isPending || !canWrite;

          return (
            <motion.div
              key={student.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(idx, 10) * 0.03 }}
            >
              <Card className={`p-4 border-2 ${config ? `${config.bgColor} ${config.borderColor}` : 'bg-card border-border'}`} aria-busy={rowPending}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    {student.photo_url ? (
                      <img src={student.photo_url} alt={student.first_name} className="w-10 h-10 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center shrink-0">
                        <span className="text-brand font-semibold">{student.first_name?.[0]}{student.last_name?.[0]}</span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">{student.first_name} {student.last_name}</p>
                      {config && <Badge className={`${config.color} text-white text-xs mt-1`}>{config.label}</Badge>}
                      {rowPending && <span className="ml-2 text-xs text-muted-foreground">Guardando…</span>}
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2 sm:flex" role="group" aria-label={`Asistencia de ${student.first_name}`}>
                    {ATTENDANCE_STATUSES.map((status) => {
                      const cfg = statusConfig[status];
                      const Icon = cfg.icon;
                      const isActive = currentStatus === status;
                      return (
                        <Button
                          key={status}
                          size="sm"
                          variant={isActive ? 'default' : 'outline'}
                          aria-pressed={isActive}
                          aria-label={cfg.label}
                          onClick={() => { if (guardWrite(canWrite, blockReadOnly)) onMark(student, status); }}
                          disabled={rowDisabled}
                          className={`${isActive ? `${cfg.color} text-white hover:opacity-90` : ''} h-auto min-h-11 min-w-11 flex-col gap-0.5 px-2 py-1.5`}
                        >
                          <Icon className="w-4 h-4" aria-hidden="true" />
                          <span className="text-[11px] leading-none font-medium">{cfg.shortLabel}</span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title="Control de asistencia"
        subtitle="Registra la asistencia diaria"
        showBack
      />

      <ReadOnlyBanner />

      <div className="max-w-5xl mx-auto space-y-6">
        <Card className="p-4 sm:p-6">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="asistencia-salon" className="block text-sm font-medium text-foreground mb-2">
                <Filter className="w-4 h-4 inline mr-1" aria-hidden="true" />
                Salón
              </label>
              <Select value={selectedClassroom ?? undefined} onValueChange={setSelectedClassroom} disabled={classrooms.length === 0}>
                <SelectTrigger id="asistencia-salon">
                  <SelectValue placeholder={classrooms.length === 0 ? 'Sin salones' : 'Selecciona un salón'} />
                </SelectTrigger>
                <SelectContent>
                  {classrooms.map(classroom => (
                    <SelectItem key={classroom.id} value={classroom.id}>
                      {classroom.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label htmlFor="asistencia-fecha" className="block text-sm font-medium text-foreground mb-2">
                <Calendar className="w-4 h-4 inline mr-1" aria-hidden="true" />
                Fecha
              </label>
              <Input
                id="asistencia-fecha"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="h-11"
              />
            </div>
          </div>

          {/* Below the filters rather than in the header: next to the title it
              truncated "Control de asistencia" to "Control…" on a 390px phone. */}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Toca un estado por alumno. Cada uno se guarda al momento.
            </p>
            <Button
              onClick={() => { if (guardWrite(canWrite, blockReadOnly)) markAllPresentMutation.mutate(); }}
              disabled={students.length === 0 || markAllPresentMutation.isPending || anyRowPending || !canWrite}
              className="min-h-11 w-full sm:w-auto"
            >
              <CheckCircle2 className="w-4 h-4 mr-2" aria-hidden="true" />
              {markAllPresentMutation.isPending ? 'Guardando…' : 'Marcar a todos presentes'}
            </Button>
          </div>
        </Card>

        {renderBody()}
      </div>
    </>
  );
}

function ParentAttendanceView({ user, userProfile }) {
  const [selectedStudent, setSelectedStudent] = useState('all');
  const [startDate, setStartDate] = useState(formatLocalDate(subDays(new Date(), 30)));
  const [endDate, setEndDate] = useState(formatLocalDate(new Date()));

  const { data: linkedStudents = { students: [] }, isLoading: loadingLinkedStudents } = useQuery({
    queryKey: ['attendance-linkedStudents', user?.id],
    queryFn: () => getLinkedStudents(user),
    enabled: !!user && userProfile?.app_role === 'PARENT'
  });

  const studentIds = linkedStudents.students.map(s => s.id);

  const { data: attendanceRecords = [], isLoading: loadingAttendance, isError: hasAttendanceError } = useQuery({
    queryKey: ['attendance-parent', studentIds, startDate, endDate],
    queryFn: async () => {
      if (studentIds.length === 0) return [];
      return await schoolRead('Attendance', {
        student_id: { $in: studentIds },
        date: { $gte: startDate, $lte: endDate }
      });
    },
    enabled: studentIds.length > 0 && !!startDate && !!endDate
  });

  if (loadingLinkedStudents || loadingAttendance) {
    return <LoadingScreen message="Cargando asistencia..." />;
  }

  if (linkedStudents.students.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Sin alumnos vinculados"
        description="No tienes estudiantes vinculados para consultar asistencia."
      />
    );
  }

  if (hasAttendanceError) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="No se pudo cargar la asistencia"
        description="Intenta nuevamente en unos minutos."
      />
    );
  }

  const filteredRecords = attendanceRecords
    .filter(r => selectedStudent === 'all' || r.student_id === selectedStudent)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const absenceCount = filteredRecords.filter(r => r.status === ATTENDANCE_STATUS.ABSENT).length;
  const lateCount = filteredRecords.filter(r => r.status === ATTENDANCE_STATUS.LATE).length;
  const recentRecords = filteredRecords.slice(0, 8);

  const getStudentName = (studentId) => {
    const student = linkedStudents.students.find(s => s.id === studentId);
    return student ? `${student.first_name} ${student.last_name}` : 'Alumno';
  };

  return (
    <>
      <PageHeader title="Asistencia" subtitle="Resumen y línea de tiempo" showBack />

      <div className="max-w-5xl mx-auto space-y-6">
        <Card className="p-6">
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Alumno</label>
              <Select value={selectedStudent} onValueChange={setSelectedStudent}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {linkedStudents.students.map((student) => (
                    <SelectItem key={student.id} value={student.id}>{student.first_name} {student.last_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Desde</label>
              <Input type="date" aria-label="Desde" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-11" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Hasta</label>
              <Input type="date" aria-label="Hasta" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-11" />
            </div>
          </div>
        </Card>

        <div className="grid md:grid-cols-2 gap-4">
          <Card className="p-4"><p className="text-sm text-muted-foreground">Ausencias</p><p className="text-2xl font-semibold text-red-600 dark:text-red-400">{absenceCount}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted-foreground">Tardanzas</p><p className="text-2xl font-semibold text-amber-600 dark:text-amber-400">{lateCount}</p></Card>
        </div>

        {recentRecords.length === 0 ? (
          <EmptyState icon={Calendar} title="Sin registros" description="No hay asistencias en el rango de fechas seleccionado." />
        ) : (
          <div className="grid gap-3">
            {recentRecords.map((record) => {
              const config = statusConfig[record.status];
              return (
                <Card key={record.id} className={`p-4 border ${config ? `${config.bgColor} ${config.borderColor}` : 'bg-card'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-foreground">{getStudentName(record.student_id)}</p>
                      <p className="text-sm text-muted-foreground">{parseLocalDate(record.date) ? format(parseLocalDate(record.date), "d 'de' MMMM, yyyy", { locale: es }) : 'Sin fecha'}</p>
                    </div>
                    <Badge className={`${config?.color || 'bg-muted-foreground'} text-white`}>{config?.label || record.status}</Badge>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

export default function Asistencia() {
  const [selectedClassroom, setSelectedClassroom] = useState(null);
  const [selectedDate, setSelectedDate] = useState(() => formatLocalDate(new Date()));
  // Rows (salón|fecha|alumno) whose mark is being saved right now. Per row,
  // so one slow save does not freeze the whole class (it used to: every
  // button in the list was disabled while ANY mark was in flight).
  const [pendingRowKeys, setPendingRowKeys] = useState(() => new Set());
  const queryClient = useQueryClient();
  const { canWrite } = useCanWrite();

  const { user, userProfile, isLoading: loadingUser } = useCurrentProfile();
  const role = userProfile?.app_role;

  const { data: classrooms = [], isLoading: loadingClassrooms, isError: classroomsError } = useQuery({
    queryKey: ['attendance-classrooms', userProfile?.school_id, role, user?.id],
    queryFn: async () => {
      if (role === 'ADMIN') return await schoolRead('Classroom', { school_id: userProfile.school_id, is_active: true });
      if (role === 'TEACHER') {
        // The teacher's classrooms come with the server's own scope (active
        // TeacherClassroom rows → Classroom rows), in one request instead of
        // a TeacherClassroom read followed by a Classroom read.
        const context = await schoolReadContext();
        return context.classrooms.filter((c) => c.is_active !== false);
      }
      return [];
    },
    enabled: !!userProfile && (role === 'ADMIN' || role === 'TEACHER')
  });

  useEffect(() => {
    if (classrooms.length > 0 && !selectedClassroom) setSelectedClassroom(classrooms[0].id);
  }, [classrooms, selectedClassroom]);

  const { data: students = [], isLoading: loadingStudents, isError: studentsError } = useQuery({
    queryKey: ['attendance-students', selectedClassroom],
    queryFn: async () => {
      if (!selectedClassroom) return [];
      return await schoolRead('Student', { classroom_id: selectedClassroom, is_active: true });
    },
    enabled: !!selectedClassroom
  });

  const currentKey = attendanceQueryKey(selectedClassroom, selectedDate);
  const { data: attendanceRecords = [] } = useQuery({
    queryKey: currentKey,
    queryFn: async () => {
      if (!selectedClassroom || !selectedDate) return [];
      return await schoolRead('Attendance', { classroom_id: selectedClassroom, date: selectedDate });
    },
    enabled: !!selectedClassroom && !!selectedDate
  });

  const setRowPending = (key, studentId, pending) => {
    const rowKey = pendingRowKey(key[1], key[2], studentId);
    setPendingRowKeys((prev) => {
      const next = new Set(prev);
      if (pending) next.add(rowKey); else next.delete(rowKey);
      return next;
    });
  };

  const upsertCachedRecord = (key, studentId, patch) => {
    queryClient.setQueryData(key, (old = []) => {
      const exists = old.some((r) => r.student_id === studentId);
      return exists
        ? old.map((r) => (r.student_id === studentId ? { ...r, ...patch } : r))
        : [...old, { student_id: studentId, ...patch }];
    });
  };

  const markAttendanceMutation = useMutation({
    mutationFn: async ({ student, status, key, reason = '' }) => {
      if (!canWriteEntity(role, 'Attendance')) throw new Error('No autorizado');
      const [, classroomId, date] = key;
      // onMutate already put an optimistic entry in the cache. It keeps the
      // saved record's id when there is one (update) and has none for a
      // student with no mark yet (create). The row is locked until this
      // settles, so the same student cannot race itself.
      const existingRecord = (queryClient.getQueryData(key) || []).find(r => r.student_id === student.id && r.id);
      const data = { school_id: userProfile.school_id, classroom_id: classroomId, student_id: student.id, date, status, reason, recorded_by: user.id, recorded_by_name: user.full_name };
      const record = existingRecord
        ? await guardedUpdate('Attendance', existingRecord.id, data)
        : await guardedCreate('Attendance', data);

      if (status === ATTENDANCE_STATUS.ABSENT && record?.id && !existingRecord?.parent_notified) {
        try {
          // Destinatarios, asunto y cuerpo del correo ahora se arman y envían
          // server-side, a partir del registro de Attendance ya guardado —
          // el cliente sólo pasa el id. Ver
          // base44/functions/notifyParents/entry.ts (arreglo al hallazgo
          // "Evitar el uso no autorizado de créditos" del scan de seguridad
          // de Base44). La función también marca parent_notified/notified_at,
          // así que ya no hace falta el guardedUpdate aquí.
          await invokeFunction(base44, 'notifyParents', { kind: 'absence', recordId: record.id });
        } catch (error) {
          console.error('Error notifying parents:', error);
        }
      }

      try {
        await logAuditEvent({
          user,
          userProfile,
          entity: AUDIT_ENTITIES.ATTENDANCE,
          entityId: record?.id || existingRecord?.id,
          action: existingRecord ? 'ATTENDANCE_UPDATED' : 'ATTENDANCE_CREATED',
          reason: reason || 'Attendance status update',
          context: { student_id: student.id, status, date }
        });
      } catch (error) {
        // The mark is already saved; a failed audit write must not make the
        // teacher think it was not.
        console.error('Error writing attendance audit event:', error);
      }

      return record;
    },
    onMutate: async (variables) => {
      const { student, status, key } = variables;
      setRowPending(key, student.id, true);
      await queryClient.cancelQueries({ queryKey: key });
      const previousRecord = (queryClient.getQueryData(key) || []).find((r) => r.student_id === student.id);
      // Optimistic: the row shows the new status immediately.
      upsertCachedRecord(key, student.id, { status });
      return { previousRecord };
    },
    onError: (error, { student, key }, context) => {
      // Roll back THIS row only. Restoring a whole-list snapshot would also
      // erase marks on other rows that saved while this one was in flight,
      // and the next tap on those would create a duplicate record.
      queryClient.setQueryData(key, (old = []) => (context?.previousRecord
        ? old.map((r) => (r.student_id === student.id ? context.previousRecord : r))
        : old.filter((r) => r.student_id !== student.id)));
      console.error('Error saving attendance:', error);
      toast.error('No se pudo guardar la asistencia. Intenta de nuevo.');
    },
    onSuccess: (record, { student, key }) => {
      // The saved record carries the id the next tap needs to update instead
      // of creating a second record. Without it, refetch rather than guess.
      if (record?.id) upsertCachedRecord(key, student.id, record);
      else queryClient.invalidateQueries({ queryKey: key });
    },
    onSettled: (_data, _error, { student, key }) => {
      setRowPending(key, student.id, false);
    },
  });

  const markAllPresentMutation = useMutation({
    mutationFn: async () => {
      const toCreate = students.filter(student => !attendanceRecords.some(r => r.student_id === student.id));
      const results = await Promise.allSettled(toCreate.map(student =>
        guardedCreate('Attendance', { school_id: userProfile.school_id, classroom_id: selectedClassroom, student_id: student.id, date: selectedDate, status: ATTENDANCE_STATUS.PRESENT, recorded_by: user.id, recorded_by_name: user.full_name })
      ));
      // A fulfilled write is a saved mark even if its body could not be read;
      // only a rejected one is a failure the teacher has to retry.
      const failed = results.filter(r => r.status === 'rejected').length;
      const created = results.filter(r => r.status === 'fulfilled' && r.value?.id).map(r => r.value);
      // Put the new records in the cache before the refetch below: a row
      // tapped while that refetch runs cancels it, and without these the
      // cache would still lack their ids and the tap would create a duplicate.
      const key = attendanceQueryKey(selectedClassroom, selectedDate);
      for (const record of created) upsertCachedRecord(key, record.student_id, record);
      for (const record of created) {
        try {
          await logAuditEvent({
            user,
            userProfile,
            entity: AUDIT_ENTITIES.ATTENDANCE,
            entityId: record.id,
            action: 'ATTENDANCE_BULK_PRESENT',
            reason: 'Bulk mark all students present',
            context: { classroom_id: selectedClassroom, date: selectedDate }
          });
        } catch (error) {
          console.error('Error writing attendance audit event:', error);
        }
      }
      return { created: results.length - failed, failed };
    },
    onSuccess: ({ created, failed }) => {
      if (failed > 0) {
        toast.error(`No se pudo registrar a ${failed} ${failed === 1 ? 'alumno' : 'alumnos'}. Revisa la lista e intenta de nuevo.`);
      } else if (created === 0) {
        toast.success('Todos los alumnos ya tenían asistencia registrada');
      } else {
        toast.success('Todos marcados como presentes');
      }
    },
    onError: () => {
      toast.error('No se pudo registrar la asistencia. Intenta de nuevo.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
    }
  });

  if (loadingUser || loadingClassrooms) return <LoadingScreen message="Cargando asistencia..." />;

  return (
    <div className="min-h-screen bg-background px-4 sm:px-6 py-6 pb-24">
      {role === 'PARENT' ? (
        <ParentAttendanceView user={user} userProfile={userProfile} />
      ) : (
        <TeacherAdminAttendanceView
          role={role}
          classrooms={classrooms}
          classroomsError={classroomsError}
          selectedClassroom={selectedClassroom}
          setSelectedClassroom={setSelectedClassroom}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          students={students}
          loadingStudents={loadingStudents}
          studentsError={studentsError}
          attendanceRecords={attendanceRecords}
          pendingRowKeys={pendingRowKeys}
          markAllPresentMutation={markAllPresentMutation}
          onMark={(student, status) => markAttendanceMutation.mutate({ student, status, key: currentKey })}
          canWrite={canWrite}
        />
      )}
    </div>
  );
}
