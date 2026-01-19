import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { Users, User, GraduationCap, Plus, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createPageUrl } from '@/utils';
import { useNavigate } from 'react-router-dom';
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

export default function GestionSalon() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const classroomId = urlParams.get('classroomId');
  const [showTeacherForm, setShowTeacherForm] = useState(false);
  const [selectedTeacherId, setSelectedTeacherId] = useState('');

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

  const { data: classroom, isLoading } = useQuery({
    queryKey: ['classroom', classroomId],
    queryFn: async () => {
      const classrooms = await base44.entities.Classroom.filter({ id: classroomId });
      return classrooms[0];
    },
    enabled: !!classroomId,
  });

  const { data: students = [] } = useQuery({
    queryKey: ['classroomStudents', classroomId],
    queryFn: () => base44.entities.Student.filter({ 
      classroom_id: classroomId,
      is_active: true 
    }),
    enabled: !!classroomId,
  });

  const { data: teacherAssignments = [] } = useQuery({
    queryKey: ['classroomTeachers', classroomId],
    queryFn: () => base44.entities.TeacherClassroom.filter({ 
      classroom_id: classroomId,
      is_active: true 
    }),
    enabled: !!classroomId,
  });

  const { data: teacherProfiles = [] } = useQuery({
    queryKey: ['teacherProfiles', userProfile?.school_id],
    queryFn: () => base44.entities.UserProfile.filter({ 
      school_id: userProfile.school_id,
      app_role: 'TEACHER',
      status: 'ACTIVE'
    }),
    enabled: !!userProfile,
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list(),
  });

  const assignedTeacherIds = teacherAssignments.map(t => t.teacher_id);
  const availableTeachers = teacherProfiles.filter(p => !assignedTeacherIds.includes(p.user_id));

  const assignTeacherMutation = useMutation({
    mutationFn: (data) => base44.entities.TeacherClassroom.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['classroomTeachers']);
      toast.success('Maestro asignado');
      setShowTeacherForm(false);
      setSelectedTeacherId('');
    },
  });

  const removeTeacherMutation = useMutation({
    mutationFn: (assignmentId) => base44.entities.TeacherClassroom.update(assignmentId, { is_active: false }),
    onSuccess: () => {
      queryClient.invalidateQueries(['classroomTeachers']);
      toast.success('Maestro removido');
    },
  });

  const handleAssignTeacher = () => {
    assignTeacherMutation.mutate({
      school_id: userProfile.school_id,
      teacher_id: selectedTeacherId,
      classroom_id: classroomId,
      is_primary: teacherAssignments.length === 0,
      is_active: true,
    });
  };

  const getUserName = (userId) => {
    const u = allUsers.find(u => u.id === userId);
    return u?.full_name || 'Sin nombre';
  };

  if (isLoading) return <LoadingScreen message="Cargando..." />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 pb-24">
      <PageHeader
        title={classroom?.name || 'Salón'}
        subtitle={`${students.length} alumnos`}
        showBack
        backTo={createPageUrl('GestionEscuela')}
      />

      <div className="space-y-6">
        {/* Teachers Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-5 shadow-sm border"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-emerald-600" />
              Maestros asignados
            </h3>
            <Button
              onClick={() => setShowTeacherForm(true)}
              size="sm"
              variant="outline"
              className="gap-1"
            >
              <Plus className="w-4 h-4" /> Asignar
            </Button>
          </div>

          {teacherAssignments.length === 0 ? (
            <p className="text-slate-500 text-center py-4">Sin maestros asignados</p>
          ) : (
            <div className="space-y-2">
              {teacherAssignments.map((assignment) => (
                <div
                  key={assignment.id}
                  className="flex items-center justify-between p-3 bg-slate-50 rounded-xl"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                      <GraduationCap className="w-4 h-4 text-emerald-600" />
                    </div>
                    <span className="font-medium">{getUserName(assignment.teacher_id)}</span>
                    {assignment.is_primary && (
                      <Badge className="bg-emerald-100 text-emerald-800">Principal</Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeTeacherMutation.mutate(assignment.id)}
                    className="text-red-600 hover:bg-red-50"
                  >
                    Remover
                  </Button>
                </div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Students Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl p-5 shadow-sm border"
        >
          <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-blue-600" />
            Alumnos ({students.length})
          </h3>

          {students.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Sin alumnos"
              description="Agrega alumnos desde la sección de Escuela."
            />
          ) : (
            <div className="space-y-2">
              {students.map((student) => (
                <div
                  key={student.id}
                  onClick={() => navigate(createPageUrl(`GestionAlumno?studentId=${student.id}`))}
                  className="flex items-center justify-between p-3 bg-slate-50 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center">
                      <User className="w-4 h-4 text-slate-500" />
                    </div>
                    <span className="font-medium">{student.first_name} {student.last_name}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>

      {/* Assign Teacher Modal */}
      <Dialog open={showTeacherForm} onOpenChange={setShowTeacherForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Asignar maestro</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Seleccionar maestro</Label>
              <Select
                value={selectedTeacherId}
                onValueChange={setSelectedTeacherId}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent>
                  {availableTeachers.map((profile) => (
                    <SelectItem key={profile.user_id} value={profile.user_id}>
                      {getUserName(profile.user_id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {availableTeachers.length === 0 && (
                <p className="text-sm text-amber-600 mt-2">
                  No hay maestros disponibles. Deben registrarse como TEACHER y ser aprobados.
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setShowTeacherForm(false)} className="flex-1">
                Cancelar
              </Button>
              <Button
                onClick={handleAssignTeacher}
                disabled={!selectedTeacherId || assignTeacherMutation.isPending}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700"
              >
                {assignTeacherMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Asignar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}