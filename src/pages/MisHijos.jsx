import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { Users, User, Calendar, Heart, Phone, Shield } from 'lucide-react';
import { format, differenceInYears } from 'date-fns';
import { es } from 'date-fns/locale';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function MisHijos() {
  const navigate = useNavigate();
  
  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: parentLinks = [], isLoading } = useQuery({
    queryKey: ['parentLinks', user?.id],
    queryFn: () => base44.entities.ParentStudent.filter({ 
      parent_id: user.id, 
      status: 'ACTIVE' 
    }),
    enabled: !!user,
  });

  const studentIds = parentLinks.map(l => l.student_id);

  const { data: students = [] } = useQuery({
    queryKey: ['students', studentIds],
    queryFn: async () => {
      if (studentIds.length === 0) return [];
      const results = [];
      for (const id of studentIds) {
        const studentList = await base44.entities.Student.filter({ id });
        if (studentList.length > 0) results.push(studentList[0]);
      }
      return results;
    },
    enabled: studentIds.length > 0,
  });

  const { data: classrooms = [] } = useQuery({
    queryKey: ['classrooms', students.map(s => s.classroom_id)],
    queryFn: async () => {
      const classroomIds = [...new Set(students.map(s => s.classroom_id).filter(Boolean))];
      if (classroomIds.length === 0) return [];
      const results = [];
      for (const id of classroomIds) {
        const classroomList = await base44.entities.Classroom.filter({ id });
        if (classroomList.length > 0) results.push(classroomList[0]);
      }
      return results;
    },
    enabled: students.length > 0,
  });

  if (isLoading) return <LoadingScreen message="Cargando..." />;

  const getClassroomName = (classroomId) => {
    const classroom = classrooms.find(c => c.id === classroomId);
    return classroom?.name || '';
  };

  const getAge = (birthDate) => {
    if (!birthDate) return null;
    return differenceInYears(new Date(), new Date(birthDate));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 pb-24">
      <PageHeader
        title="Mis hijos"
        showBack
        backTo={createPageUrl('Home')}
      />

      {students.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Sin hijos vinculados"
          description="El administrador de la escuela debe vincular a tus hijos con tu cuenta."
        />
      ) : (
        <div className="space-y-4">
          {students.map((student, index) => (
            <motion.div
              key={student.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100"
            >
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center flex-shrink-0">
                  {student.photo_url ? (
                    <img 
                      src={student.photo_url} 
                      alt={student.first_name}
                      className="w-full h-full rounded-2xl object-cover"
                    />
                  ) : (
                    <User className="w-8 h-8 text-indigo-600" />
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-slate-800">
                    {student.first_name} {student.last_name}
                  </h3>
                  {getClassroomName(student.classroom_id) && (
                    <Badge variant="secondary" className="mt-1 bg-indigo-100 text-indigo-800">
                      {getClassroomName(student.classroom_id)}
                    </Badge>
                  )}
                  
                  <div className="mt-3 space-y-1 text-sm text-slate-600">
                    {student.birth_date && (
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-slate-400" />
                        {format(new Date(student.birth_date), "d 'de' MMMM, yyyy", { locale: es })}
                        {getAge(student.birth_date) && (
                          <span className="text-slate-400">({getAge(student.birth_date)} años)</span>
                        )}
                      </div>
                    )}
                    {student.blood_type && (
                      <div className="flex items-center gap-2">
                        <Heart className="w-4 h-4 text-red-400" />
                        Tipo de sangre: {student.blood_type}
                      </div>
                    )}
                    {student.allergies && (
                      <div className="flex items-center gap-2 text-amber-600">
                        <Shield className="w-4 h-4" />
                        Alergias: {student.allergies}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-100 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(createPageUrl(`ContactosEmergencia?studentId=${student.id}`))}
                  className="flex-1"
                >
                  <Phone className="w-4 h-4 mr-1" />
                  Contactos
                </Button>
                <Button
                  size="sm"
                  onClick={() => navigate(createPageUrl(`Bitacora?studentId=${student.id}`))}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                >
                  Ver bitácora
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}