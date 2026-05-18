import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import LoadingScreen from '@/components/ui/LoadingScreen';
import HomeworkCard from '@/components/homework/HomeworkCard';
import { BookOpen, Calendar } from 'lucide-react';
import { format, addDays, endOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { createPageUrl } from '@/utils';
import { getLinkedStudents } from '@/lib/relations/getLinkedStudents';
import { canReadEntity } from '@/lib/authorization/policy';
import { loadHomeworkByClassroomIds, normalizedIdQueryKey } from '@/lib/data-loaders/batchedEntityLoaders';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function Tarea() {
  const [selectedHomework, setSelectedHomework] = useState(null);
  const [activeTab, setActiveTab] = useState('hoy');
  const [activeStudentId, setActiveStudentId] = useState('all');
  
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

  const { data: linkedStudents = { students: [], studentIds: [], orphanedLinkIds: [] } } = useQuery({
    queryKey: ['linkedStudents', user?.id],
    queryFn: () => getLinkedStudents(user),
    enabled: !!user && canReadEntity(userProfile?.app_role, 'Homework'),
  });

  const students = linkedStudents.students;
  const studentIds = linkedStudents.studentIds;

  const classroomIds = [...new Set(students.map(s => s.classroom_id).filter(Boolean))];
  const activeStudent = students.find((student) => student.id === activeStudentId) || null;
  const activeClassroomIds = activeStudent ? [activeStudent.classroom_id].filter(Boolean) : classroomIds;

  const { data: homework = [], isLoading } = useQuery({
    queryKey: normalizedIdQueryKey('homework', activeClassroomIds),
    queryFn: async () => (await loadHomeworkByClassroomIds(activeClassroomIds)).items,
    enabled: activeClassroomIds.length > 0,
  });

  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');
  const tomorrowStr = format(addDays(today, 1), 'yyyy-MM-dd');
  const weekEnd = endOfWeek(today, { weekStartsOn: 1 });

  const todayHomework = homework.filter(h => h.due_date === todayStr);
  const weekHomework = homework.filter(h => {
    const dueDate = new Date(h.due_date);
    return dueDate >= today && dueDate <= weekEnd;
  });

  if (isLoading) return <LoadingScreen message="Cargando tareas..." />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 pb-24">
      <PageHeader
        title="Tarea"
        subtitle="Sigue tareas por hijo sin confusiones"
        showBack
        backTo={createPageUrl('Home')}
      />
      {students.length > 1 && (
        <div className="mb-4 bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-xs font-medium text-slate-500 mb-2">Hijo activo</p>
          <Select value={activeStudentId} onValueChange={setActiveStudentId}>
            <SelectTrigger>
              <SelectValue placeholder="Todos mis hijos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos mis hijos</SelectItem>
              {students.map((student) => (
                <SelectItem key={student.id} value={student.id}>{student.first_name} {student.last_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full mb-6">
          <TabsTrigger value="hoy" className="flex-1">Hoy</TabsTrigger>
          <TabsTrigger value="semana" className="flex-1">Esta semana</TabsTrigger>
        </TabsList>

        <TabsContent value="hoy">
          {todayHomework.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="Sin tarea para hoy"
              description="No hay tareas asignadas para entregar hoy."
            />
          ) : (
            <div className="space-y-4">
              {todayHomework.map((hw, index) => (
                <motion.div
                  key={hw.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <HomeworkCard
                    homework={hw}
                    onClick={() => setSelectedHomework(hw)}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="semana">
          {weekHomework.length === 0 ? (
            <EmptyState
              icon={Calendar}
              title="Sin tarea esta semana"
              description="No hay tareas pendientes para esta semana."
            />
          ) : (
            <div className="space-y-4">
              {weekHomework.map((hw, index) => (
                <motion.div
                  key={hw.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <HomeworkCard
                    homework={hw}
                    onClick={() => setSelectedHomework(hw)}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Homework Detail Modal */}
      <Dialog open={!!selectedHomework} onOpenChange={() => setSelectedHomework(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedHomework?.title}</DialogTitle>
          </DialogHeader>
          
          {selectedHomework && (
            <div className="space-y-4">
              {selectedHomework.subject && (
                <div className="flex items-center gap-2 text-indigo-600">
                  <BookOpen className="w-4 h-4" />
                  <span className="font-medium">{selectedHomework.subject}</span>
                </div>
              )}
              {activeStudent && (
                <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                  Hijo activo: {activeStudent.first_name} {activeStudent.last_name}
                </Badge>
              )}
              
              <div className="flex items-center gap-2 text-slate-600">
                <Calendar className="w-4 h-4" />
                <span>
                  Entregar: {format(new Date(selectedHomework.due_date), "EEEE d 'de' MMMM", { locale: es })}
                </span>
              </div>

              {selectedHomework.description && (
                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-slate-700 whitespace-pre-wrap">{selectedHomework.description}</p>
                </div>
              )}

              {selectedHomework.attachments?.length > 0 && (
                <div>
                  <p className="font-medium text-slate-700 mb-2">Archivos adjuntos</p>
                  <div className="space-y-2">
                    {selectedHomework.attachments.map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block bg-indigo-50 text-indigo-700 rounded-lg p-3 text-sm hover:bg-indigo-100"
                      >
                        Ver archivo {i + 1}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              
              <p className="text-xs text-slate-400 text-center">
                Asignada por {selectedHomework.teacher_name}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
