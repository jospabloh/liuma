import React, { useState } from 'react';
import { schoolRead, SCHOOL_READ_ALL } from '@/lib/data/schoolRead';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Calendar, TrendingDown, Users, Filter } from 'lucide-react';
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/ui/PageHeader";
import LoadingScreen from "@/components/ui/LoadingScreen";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';

export default function ResumenAsistencia() {
  const [selectedPeriod, setSelectedPeriod] = useState('week');
  const [selectedClassroom, setSelectedClassroom] = useState('all');

  const { userProfile, isLoading: loadingUser } = useCurrentProfile();

  const { data: classrooms = [] } = useQuery({
    queryKey: ['classrooms', userProfile?.school_id],
    queryFn: async () => {
      return await schoolRead('Classroom', { 
        school_id: userProfile.school_id, 
        is_active: true 
      });
    },
    enabled: !!userProfile?.school_id
  });

  const getDateRange = () => {
    const today = new Date();
    switch (selectedPeriod) {
      case 'day':
        return { start: format(today, 'yyyy-MM-dd'), end: format(today, 'yyyy-MM-dd') };
      case 'week':
        return { 
          start: format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'), 
          end: format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd') 
        };
      case 'month':
        return { 
          start: format(startOfMonth(today), 'yyyy-MM-dd'), 
          end: format(endOfMonth(today), 'yyyy-MM-dd') 
        };
      default:
        return { start: format(today, 'yyyy-MM-dd'), end: format(today, 'yyyy-MM-dd') };
    }
  };

  const { data: attendanceRecords = [], isLoading: loadingAttendance, isError: attendanceError } = useQuery({
    queryKey: ['attendanceSummary', userProfile?.school_id, selectedPeriod, selectedClassroom],
    queryFn: async () => {
      const { start, end } = getDateRange();
      const filter = {
        school_id: userProfile.school_id,
        date: { $gte: start, $lte: end }
      };
      if (selectedClassroom !== 'all') {
        filter.classroom_id = selectedClassroom;
      }
      // Every row of the period, or an error — never a silently cut month
      // (the default cap is 5000; a 300-student school logs ~6,600 a month).
      return await schoolRead('Attendance', filter, 'date', SCHOOL_READ_ALL);
    },
    enabled: !!userProfile?.school_id
  });

  const { data: students = [] } = useQuery({
    queryKey: ['students', userProfile?.school_id, selectedClassroom],
    queryFn: async () => {
      const filter = { school_id: userProfile.school_id, is_active: true };
      if (selectedClassroom !== 'all') {
        filter.classroom_id = selectedClassroom;
      }
      return await schoolRead('Student', filter);
    },
    enabled: !!userProfile?.school_id
  });

  if (loadingUser || loadingAttendance) {
    return <LoadingScreen message="Cargando resumen..." />;
  }

  const stats = {
    total: attendanceRecords.length,
    present: attendanceRecords.filter(r => r.status === 'present').length,
    absent: attendanceRecords.filter(r => r.status === 'absent').length,
    late: attendanceRecords.filter(r => r.status === 'late').length,
    excused: attendanceRecords.filter(r => r.status === 'excused').length
  };

  const absenteeismRate = stats.total > 0 ? ((stats.absent / stats.total) * 100).toFixed(1) : 0;

  // Agrupar ausencias por estudiante
  const absencesByStudent = students.map(student => {
    const studentRecords = attendanceRecords.filter(r => r.student_id === student.id);
    const absences = studentRecords.filter(r => r.status === 'absent').length;
    return { student, absences, totalRecords: studentRecords.length };
  }).filter(item => item.absences > 0).sort((a, b) => b.absences - a.absences);

  return (
    <div className="min-h-screen bg-background px-4 sm:px-6 py-6 pb-24">
      <PageHeader
        title="Resumen de Asistencia"
        subtitle="Estadísticas y reportes"
        showBack
      />

      <div className="max-w-5xl mx-auto space-y-6">
        {attendanceError && (
          <p className="text-sm text-red-600 dark:text-red-400">
            No se pudo cargar la asistencia del período; las cifras de abajo están incompletas.
          </p>
        )}
        <Card className="p-6">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                <Calendar className="w-4 h-4 inline mr-1" />
                Período
              </label>
              <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Hoy</SelectItem>
                  <SelectItem value="week">Esta Semana</SelectItem>
                  <SelectItem value="month">Este Mes</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                <Filter className="w-4 h-4 inline mr-1" />
                Salón
              </label>
              <Select value={selectedClassroom} onValueChange={setSelectedClassroom}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los salones</SelectItem>
                  {classrooms.map(classroom => (
                    <SelectItem key={classroom.id} value={classroom.id}>
                      {classroom.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        <div className="grid md:grid-cols-4 gap-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="p-6 bg-gradient-to-br from-green-50 to-green-100 border-green-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-green-700">Presentes</span>
                <Users className="w-5 h-5 text-green-600" />
              </div>
              <p className="text-3xl font-bold text-green-800">{stats.present}</p>
              <p className="text-xs text-green-600 mt-1">
                {stats.total > 0 ? ((stats.present / stats.total) * 100).toFixed(1) : 0}% del total
              </p>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card className="p-6 bg-gradient-to-br from-red-50 to-red-100 border-red-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-red-700">Ausentes</span>
                <TrendingDown className="w-5 h-5 text-red-600" />
              </div>
              <p className="text-3xl font-bold text-red-800">{stats.absent}</p>
              <p className="text-xs text-red-600 mt-1">
                {absenteeismRate}% ausentismo
              </p>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <Card className="p-6 bg-gradient-to-br from-yellow-50 to-yellow-100 border-yellow-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-yellow-700">Tardanzas</span>
                <Calendar className="w-5 h-5 text-yellow-600" />
              </div>
              <p className="text-3xl font-bold text-yellow-800">{stats.late}</p>
              <p className="text-xs text-yellow-600 mt-1">
                {stats.total > 0 ? ((stats.late / stats.total) * 100).toFixed(1) : 0}% del total
              </p>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <Card className="p-6 bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-blue-700">Justificados</span>
                <Calendar className="w-5 h-5 text-blue-600" />
              </div>
              <p className="text-3xl font-bold text-blue-800">{stats.excused}</p>
              <p className="text-xs text-blue-600 mt-1">
                {stats.total > 0 ? ((stats.excused / stats.total) * 100).toFixed(1) : 0}% del total
              </p>
            </Card>
          </motion.div>
        </div>

        {absencesByStudent.length > 0 && (
          <Card className="p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-red-600" />
              Alumnos con Mayor Ausentismo
            </h3>
            <div className="space-y-3">
              {absencesByStudent.slice(0, 10).map((item, idx) => (
                <motion.div
                  key={item.student.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="flex items-center justify-between p-3 bg-muted rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    {item.student.photo_url ? (
                      <img src={item.student.photo_url} alt={item.student.first_name} className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center">
                        <span className="text-brand font-semibold text-sm">
                          {item.student.first_name[0]}{item.student.last_name[0]}
                        </span>
                      </div>
                    )}
                    <div>
                      <p className="font-semibold text-foreground">
                        {item.student.first_name} {item.student.last_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.absences} ausencia{item.absences > 1 ? 's' : ''} de {item.totalRecords} días registrados
                      </p>
                    </div>
                  </div>
                  <Badge variant="destructive" className="bg-red-500 text-white">
                    {((item.absences / item.totalRecords) * 100).toFixed(0)}%
                  </Badge>
                </motion.div>
              ))}
            </div>
          </Card>
        )}

        {absencesByStudent.length === 0 && (
          <Card className="p-12 text-center">
            <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No hay ausencias registradas en este período</p>
          </Card>
        )}
      </div>
    </div>
  );
}