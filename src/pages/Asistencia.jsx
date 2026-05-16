import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Calendar, CheckCircle2, XCircle, Clock, FileText, Filter, Users } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/ui/PageHeader";
import LoadingScreen from "@/components/ui/LoadingScreen";
import { format, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import { canWriteEntity } from '@/lib/authorization/policy';

const statusConfig = {
  present: { label: 'Presente', icon: CheckCircle2, color: 'bg-green-500', textColor: 'text-green-700', bgColor: 'bg-green-50' },
  absent: { label: 'Ausente', icon: XCircle, color: 'bg-red-500', textColor: 'text-red-700', bgColor: 'bg-red-50' },
  late: { label: 'Tardanza', icon: Clock, color: 'bg-yellow-500', textColor: 'text-yellow-700', bgColor: 'bg-yellow-50' },
  excused: { label: 'Justificado', icon: FileText, color: 'bg-blue-500', textColor: 'text-blue-700', bgColor: 'bg-blue-50' }
};

export default function Asistencia() {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [selectedClassroom, setSelectedClassroom] = useState(null);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const queryClient = useQueryClient();

  const { isLoading: loadingUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      const profiles = await base44.entities.UserProfile.filter({ user_id: currentUser.id });
      setUserProfile(profiles[0]);
      return currentUser;
    }
  });

  const { data: classrooms = [], isLoading: loadingClassrooms } = useQuery({
    queryKey: ['classrooms', userProfile?.school_id, userProfile?.app_role],
    queryFn: async () => {
      if (userProfile.app_role === 'ADMIN') {
        return await base44.entities.Classroom.filter({ 
          school_id: userProfile.school_id, 
          is_active: true 
        });
      } else if (userProfile.app_role === 'TEACHER') {
        const assignments = await base44.entities.TeacherClassroom.filter({
          teacher_id: user.id,
          is_active: true
        });
        const classroomIds = assignments.map(a => a.classroom_id);
        if (classroomIds.length === 0) return [];
        return await base44.entities.Classroom.filter({
          _id: { $in: classroomIds },
          is_active: true
        });
      }
      return [];
    },
    enabled: !!userProfile && (userProfile.app_role === 'ADMIN' || userProfile.app_role === 'TEACHER')
  });

  useEffect(() => {
    if (classrooms.length > 0 && !selectedClassroom) {
      setSelectedClassroom(classrooms[0].id);
    }
  }, [classrooms, selectedClassroom]);

  const { data: students = [], isLoading: loadingStudents } = useQuery({
    queryKey: ['students', selectedClassroom],
    queryFn: async () => {
      if (!selectedClassroom) return [];
      return await base44.entities.Student.filter({
        classroom_id: selectedClassroom,
        is_active: true
      });
    },
    enabled: !!selectedClassroom
  });

  const { data: attendanceRecords = [] } = useQuery({
    queryKey: ['attendance', selectedClassroom, selectedDate],
    queryFn: async () => {
      if (!selectedClassroom || !selectedDate) return [];
      return await base44.entities.Attendance.filter({
        classroom_id: selectedClassroom,
        date: selectedDate
      });
    },
    enabled: !!selectedClassroom && !!selectedDate
  });

  const markAttendanceMutation = useMutation({
    mutationFn: async ({ student, status, reason = '' }) => {
      if (!canWriteEntity(userProfile?.app_role, 'Attendance')) throw new Error('No autorizado');
      const existingRecord = attendanceRecords.find(r => r.student_id === student.id);
      
      const data = {
        school_id: userProfile.school_id,
        classroom_id: selectedClassroom,
        student_id: student.id,
        date: selectedDate,
        status: status,
        reason: reason,
        recorded_by: user.id,
        recorded_by_name: user.full_name
      };

      let record;
      if (existingRecord) {
        record = await base44.entities.Attendance.update(existingRecord.id, data);
      } else {
        record = await base44.entities.Attendance.create(data);
      }

      // Notificar a padres si está ausente
      if (status === 'absent' && !existingRecord?.parent_notified) {
        try {
          const parentLinks = await base44.entities.ParentStudent.filter({
            student_id: student.id,
            status: 'ACTIVE'
          });

          const allUsers = await base44.entities.User.list();
          
          for (const link of parentLinks) {
            const parent = allUsers.find(u => u.id === link.parent_id);
            if (parent) {
              await base44.integrations.Core.SendEmail({
                from_name: 'LIUMA - Sistema Escolar',
                to: parent.email,
                subject: `Ausencia de ${student.first_name} ${student.last_name}`,
                body: `
                  <h2>Notificación de Ausencia</h2>
                  <p>Estimado padre/madre de familia:</p>
                  <p>Le informamos que <strong>${student.first_name} ${student.last_name}</strong> no asistió a clases el día <strong>${format(new Date(selectedDate), 'dd/MM/yyyy', { locale: es })}</strong>.</p>
                  ${reason ? `<p><strong>Motivo registrado:</strong> ${reason}</p>` : ''}
                  <p>Si tiene alguna pregunta, por favor contacte a la escuela.</p>
                  <p>Atentamente,<br>Equipo LIUMA</p>
                `
              });
            }
          }

          await base44.entities.Attendance.update(record.id, {
            parent_notified: true,
            notified_at: new Date().toISOString()
          });
        } catch (error) {
          console.error('Error notifying parents:', error);
        }
      }

      return record;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['attendance']);
      toast.success('Asistencia registrada');
    }
  });

  const markAllPresentMutation = useMutation({
    mutationFn: async () => {
      const promises = students.map(student => {
        const existingRecord = attendanceRecords.find(r => r.student_id === student.id);
        if (!existingRecord) {
          return base44.entities.Attendance.create({
            school_id: userProfile.school_id,
            classroom_id: selectedClassroom,
            student_id: student.id,
            date: selectedDate,
            status: 'present',
            recorded_by: user.id,
            recorded_by_name: user.full_name
          });
        }
        return Promise.resolve();
      });
      await Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['attendance']);
      toast.success('Todos marcados como presentes');
    }
  });

  if (loadingUser || loadingClassrooms) {
    return <LoadingScreen message="Cargando asistencia..." />;
  }

  if (userProfile?.app_role === 'PARENT') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
        <PageHeader 
          title="Asistencia"
          subtitle="Ver asistencia de tus hijos"
          showBack
        />
        <Card className="p-6 text-center">
          <Users className="w-12 h-12 text-slate-400 mx-auto mb-3" />
          <p className="text-slate-600">Vista de asistencia para padres próximamente</p>
        </Card>
      </div>
    );
  }

  const getStudentStatus = (studentId) => {
    const record = attendanceRecords.find(r => r.student_id === studentId);
    return record?.status || null;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <PageHeader 
        title="Control de Asistencia"
        subtitle="Registra la asistencia diaria"
        showBack
        action={
          <Button
            onClick={() => markAllPresentMutation.mutate()}
            disabled={students.length === 0 || markAllPresentMutation.isPending}
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            Todos Presentes
          </Button>
        }
      />

      <div className="max-w-6xl mx-auto space-y-6">
        <Card className="p-6">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                <Filter className="w-4 h-4 inline mr-1" />
                Salón
              </label>
              <Select value={selectedClassroom} onValueChange={setSelectedClassroom}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un salón" />
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
              <label className="block text-sm font-medium text-slate-700 mb-2">
                <Calendar className="w-4 h-4 inline mr-1" />
                Fecha
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>
        </Card>

        {loadingStudents ? (
          <Card className="p-12 text-center">
            <div className="animate-spin w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full mx-auto"></div>
          </Card>
        ) : students.length === 0 ? (
          <Card className="p-12 text-center">
            <Users className="w-12 h-12 text-slate-400 mx-auto mb-3" />
            <p className="text-slate-600">No hay alumnos en este salón</p>
          </Card>
        ) : (
          <div className="grid gap-3">
            {students.map((student, idx) => {
              const currentStatus = getStudentStatus(student.id);
              const config = currentStatus ? statusConfig[currentStatus] : null;

              return (
                <motion.div
                  key={student.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                >
                  <Card className={`p-4 ${config?.bgColor || 'bg-white'} border-2 ${config ? 'border-slate-200' : 'border-slate-200'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {student.photo_url ? (
                          <img src={student.photo_url} alt={student.first_name} className="w-10 h-10 rounded-full object-cover" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                            <span className="text-indigo-600 font-semibold">
                              {student.first_name[0]}{student.last_name[0]}
                            </span>
                          </div>
                        )}
                        <div>
                          <p className="font-semibold text-slate-800">
                            {student.first_name} {student.last_name}
                          </p>
                          {config && (
                            <Badge className={`${config.color} text-white text-xs mt-1`}>
                              {config.label}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        {Object.entries(statusConfig).map(([status, cfg]) => {
                          const Icon = cfg.icon;
                          const isActive = currentStatus === status;
                          return (
                            <Button
                              key={status}
                              size="sm"
                              variant={isActive ? 'default' : 'outline'}
                              onClick={() => markAttendanceMutation.mutate({ student, status })}
                              disabled={markAttendanceMutation.isPending}
                              className={isActive ? `${cfg.color} text-white hover:opacity-90` : ''}
                            >
                              <Icon className="w-4 h-4" />
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
        )}
      </div>
    </div>
  );
}