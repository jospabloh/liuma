import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { CheckCircle, AlertCircle, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Badge } from "@/components/ui/badge";
import { createPageUrl } from '@/utils';
import { useNavigate } from 'react-router-dom';

export default function BitacorasMaestro() {
  const navigate = useNavigate();
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

  const { data: teacherClassrooms = [] } = useQuery({
    queryKey: ['teacherClassrooms', user?.id],
    queryFn: () => base44.entities.TeacherClassroom.filter({ 
      teacher_id: user.id,
      is_active: true 
    }),
    enabled: !!user,
  });

  const classroomIds = teacherClassrooms.map(tc => tc.classroom_id);

  const { data: classrooms = [] } = useQuery({
    queryKey: ['classrooms', classroomIds],
    queryFn: async () => {
      if (classroomIds.length === 0) return [];
      const results = [];
      for (const id of classroomIds) {
        const classroomList = await base44.entities.Classroom.filter({ id });
        if (classroomList.length > 0) results.push(classroomList[0]);
      }
      return results;
    },
    enabled: classroomIds.length > 0,
  });

  const { data: students = [], isLoading } = useQuery({
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

  const { data: todayDiaries = [] } = useQuery({
    queryKey: ['todayDiaries', today, userProfile?.school_id],
    queryFn: () => base44.entities.DiaryEntry.filter({ 
      date: today,
      school_id: userProfile.school_id
    }),
    enabled: !!userProfile,
  });

  const studentsWithDiary = new Set(todayDiaries.map(d => d.student_id));

  const handleSelectClassroom = (classroomId) => {
    navigate(createPageUrl(`CrearBitacora?classroomId=${classroomId}`));
  };

  if (isLoading) return <LoadingScreen message="Cargando..." />;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 pb-24">
      <PageHeader
        title="Bitácoras de hoy"
        subtitle={format(new Date(), "EEEE d 'de' MMMM", { locale: es })}
        showBack
        backTo={createPageUrl('Home')}
      />

      <div className="space-y-4">
        {classrooms.map((classroom, index) => {
          const classStudents = students.filter(s => s.classroom_id === classroom.id);
          const completed = classStudents.filter(s => studentsWithDiary.has(s.id)).length;
          const total = classStudents.length;
          const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
          const isComplete = progress === 100;

          return (
            <motion.div
              key={classroom.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              onClick={() => handleSelectClassroom(classroom.id)}
              className="bg-card text-card-foreground rounded-2xl p-5 shadow-sm border border-border cursor-pointer"
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-card-foreground">{classroom.name}</h3>
                  <p className="text-sm text-muted-foreground">{total} alumnos</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={isComplete ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}>
                    {isComplete ? (
                      <><CheckCircle className="w-3 h-3 mr-1" /> Completo</>
                    ) : (
                      <><AlertCircle className="w-3 h-3 mr-1" /> {total - completed} pendientes</>
                    )}
                  </Badge>
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ delay: 0.3 + index * 0.1, duration: 0.5 }}
                  className={`h-full rounded-full ${isComplete ? 'bg-green-500' : 'bg-amber-500'}`}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">{completed} de {total} bitácoras</p>

              {/* Students preview */}
              <div className="mt-4 flex flex-wrap gap-2">
                {classStudents.slice(0, 6).map((student) => {
                  const hasDiary = studentsWithDiary.has(student.id);
                  return (
                    <div
                      key={student.id}
                      className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                        hasDiary ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {hasDiary ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                      {student.first_name}
                    </div>
                  );
                })}
                {classStudents.length > 6 && (
                  <div className="px-2 py-1 rounded-full text-xs bg-muted text-muted-foreground">
                    +{classStudents.length - 6} más
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
      </div>
    </div>
  );
}