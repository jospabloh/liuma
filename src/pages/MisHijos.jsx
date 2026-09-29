import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentProfile';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { Users, User, Calendar, Heart, Phone, Shield } from 'lucide-react';
import { format, differenceInYears } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dates';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { getLinkedStudents } from '@/lib/relations/getLinkedStudents';
import { loadClassroomsByIds, normalizedIdQueryKey } from '@/lib/data-loaders/batchedEntityLoaders';

export default function MisHijos() {
  const navigate = useNavigate();
  
  const { user } = useCurrentUser();

  const { data: linkedStudents = { students: [], studentIds: [], orphanedLinkIds: [] }, isLoading } = useQuery({
    queryKey: ['linkedStudents', user?.id],
    queryFn: () => getLinkedStudents(user),
    enabled: !!user,
  });

  const students = linkedStudents.students;
  const studentIds = linkedStudents.studentIds;

  const classroomIds = students.map(s => s.classroom_id);

  const { data: classrooms = [] } = useQuery({
    queryKey: normalizedIdQueryKey('classrooms', classroomIds),
    queryFn: async () => (await loadClassroomsByIds(classroomIds)).items,
    enabled: students.length > 0,
  });

  if (isLoading) return <LoadingScreen message="Cargando..." />;

  const getClassroomName = (classroomId) => {
    const classroom = classrooms.find(c => c.id === classroomId);
    return classroom?.name || '';
  };

  const getAge = (birthDate) => {
    const born = parseLocalDate(birthDate);
    if (!born) return null;
    return differenceInYears(new Date(), born);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 pb-24">
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
              className="bg-card text-card-foreground border border-border rounded-2xl shadow-sm p-5"
            >
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 rounded-2xl bg-brand/10 flex items-center justify-center flex-shrink-0">
                  {student.photo_url ? (
                    <img
                      src={student.photo_url}
                      alt={student.first_name}
                      className="w-full h-full rounded-2xl object-cover"
                    />
                  ) : (
                    <User className="w-8 h-8 text-brand" />
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-card-foreground">
                    {student.first_name} {student.last_name}
                  </h3>
                  {getClassroomName(student.classroom_id) && (
                    <Badge variant="secondary" className="mt-1 bg-brand/10 text-brand">
                      {getClassroomName(student.classroom_id)}
                    </Badge>
                  )}

                  <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                    {student.birth_date && (
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        {parseLocalDate(student.birth_date) ? format(parseLocalDate(student.birth_date), "d 'de' MMMM, yyyy", { locale: es }) : 'Sin fecha'}
                        {getAge(student.birth_date) && (
                          <span className="text-muted-foreground">({getAge(student.birth_date)} años)</span>
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
                      <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                        <Shield className="w-4 h-4" />
                        Alergias: {student.allergies}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-border flex gap-2">
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
                  className="flex-1"
                >
                  Ver bitácora
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}