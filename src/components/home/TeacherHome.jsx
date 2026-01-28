import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { ClipboardList, BookOpen, Bell, Sparkles, CheckCircle, AlertCircle } from 'lucide-react';
import BigTile from '@/components/ui/BigTile';
import LumiButton from '@/components/ui/LumiButton';
import LumiChat from '@/components/lumi/LumiChat';
import PaymentReminderBanner from '@/components/subscription/PaymentReminderBanner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Badge } from "@/components/ui/badge";

export default function TeacherHome({ user, userProfile, subscription }) {
  const [showLumi, setShowLumi] = useState(false);
  const today = format(new Date(), 'yyyy-MM-dd');

  // Get teacher's classrooms
  const { data: teacherClassrooms = [] } = useQuery({
    queryKey: ['teacherClassrooms', user.id],
    queryFn: () => base44.entities.TeacherClassroom.filter({ 
      teacher_id: user.id,
      is_active: true 
    }),
  });

  const classroomIds = teacherClassrooms.map(tc => tc.classroom_id);

  // Get classrooms details
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
        <PaymentReminderBanner subscription={subscription} />
        
        {/* Main Tiles */}
        <div className="space-y-3">
          <BigTile
            icon={ClipboardList}
            title="Bitácoras de hoy"
            subtitle={`${classrooms.length} salón${classrooms.length !== 1 ? 'es' : ''}`}
            badge={studentsMissingDiary.length}
            badgeColor="bg-amber-500"
            href="BitacorasMaestro"
            color="from-emerald-50 to-white"
            iconColor="text-emerald-600"
            delay={0.1}
          />
          <BigTile
            icon={BookOpen}
            title="Tarea"
            subtitle="Asignar tarea"
            href="TareaMaestro"
            color="from-blue-50 to-white"
            iconColor="text-blue-600"
            delay={0.15}
          />
          <BigTile
            icon={Bell}
            title="Avisos"
            subtitle="Enviar comunicado"
            href="AvisosMaestro"
            color="from-violet-50 to-white"
            iconColor="text-violet-600"
            delay={0.2}
          />
        </div>

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

      {/* Lumi Button */}
      <LumiButton onClick={() => setShowLumi(true)} />
      
      {/* Lumi Chat */}
      <LumiChat 
        isOpen={showLumi} 
        onClose={() => setShowLumi(false)} 
        userProfile={userProfile}
      />
    </div>
  );
}