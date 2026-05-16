import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import HomeworkCard from '@/components/homework/HomeworkCard';
import EmptyState from '@/components/ui/EmptyState';
import { BookOpen, Plus, Loader2, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { createPageUrl } from '@/utils';
import { toast } from "sonner";
import { canReadEntity, canWriteEntity, buildScopedFilter, filterByRowLevel } from '@/lib/authorization/policy';
import { loadHomeworkByClassroomIds, normalizedIdQueryKey } from '@/lib/data-loaders/batchedEntityLoaders';
import { getLinkedClassrooms } from '@/lib/relations/getLinkedClassrooms';
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

export default function TareaMaestro() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    classroom_id: '',
    subject: '',
    title: '',
    description: '',
    due_date: format(new Date(), 'yyyy-MM-dd'),
  });

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

  const { data: linkedClassrooms = { classrooms: [], classroomIds: [] } } = useQuery({
    queryKey: ['linkedClassrooms', user?.id],
    queryFn: () => getLinkedClassrooms(user),
    enabled: !!user,
  });

  const classroomIds = linkedClassrooms.classroomIds;
  const classrooms = linkedClassrooms.classrooms;

  const { data: homework = [], isLoading } = useQuery({
    queryKey: normalizedIdQueryKey('teacherHomework', classroomIds),
    queryFn: async () => (await loadHomeworkByClassroomIds(classroomIds, 20)).items,
    enabled: classroomIds.length > 0,
  });

  const createHomeworkMutation = useMutation({
    mutationFn: (data) => base44.entities.Homework.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['teacherHomework']);
      toast.success('Tarea creada correctamente');
      setShowForm(false);
      setFormData({
        classroom_id: '',
        subject: '',
        title: '',
        description: '',
        due_date: format(new Date(), 'yyyy-MM-dd'),
      });
    },
    onError: () => {
      toast.error('Error al crear la tarea');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createHomeworkMutation.mutate({
      ...formData,
      school_id: userProfile.school_id,
      teacher_id: user.id,
      teacher_name: user.full_name,
      assigned_date: format(new Date(), 'yyyy-MM-dd'),
    });
  };

  const getClassroomName = (id) => {
    const classroom = classrooms.find(c => c.id === id);
    return classroom?.name || '';
  };

  if (isLoading) return <LoadingScreen message="Cargando..." />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 pb-24">
      <PageHeader
        title="Tarea"
        showBack
        backTo={createPageUrl('Home')}
        action={
          <Button onClick={() => setShowForm(true)} className="bg-blue-600 hover:bg-blue-700 gap-1">
            <Plus className="w-4 h-4" /> Crear
          </Button>
        }
      />

      {homework.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Sin tareas"
          description="Crea la primera tarea para tus alumnos."
          action={
            <Button onClick={() => setShowForm(true)} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-1" /> Crear tarea
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {homework.map((hw, index) => (
            <motion.div
              key={hw.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <div className="relative">
                <div className="absolute top-2 right-2 text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">
                  {getClassroomName(hw.classroom_id)}
                </div>
                <HomeworkCard homework={hw} />
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Create Homework Modal */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva tarea</DialogTitle>
          </DialogHeader>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Salón *</Label>
              <Select
                value={formData.classroom_id}
                onValueChange={(value) => setFormData({ ...formData, classroom_id: value })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Seleccionar salón" />
                </SelectTrigger>
                <SelectContent>
                  {classrooms.map((classroom) => (
                    <SelectItem key={classroom.id} value={classroom.id}>
                      {classroom.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Materia (opcional)</Label>
              <Input
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                placeholder="Ej: Matemáticas, Español..."
                className="mt-1"
              />
            </div>

            <div>
              <Label>Título *</Label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Título de la tarea"
                className="mt-1"
              />
            </div>

            <div>
              <Label>Descripción</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Instrucciones detalladas..."
                className="mt-1"
              />
            </div>

            <div>
              <Label>Fecha de entrega *</Label>
              <Input
                type="date"
                value={formData.due_date}
                onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                className="mt-1"
              />
            </div>

            <div className="flex gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)} className="flex-1">
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={!formData.classroom_id || !formData.title || !formData.due_date || createHomeworkMutation.isPending}
                className="flex-1 bg-blue-600 hover:bg-blue-700"
              >
                {createHomeworkMutation.isPending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  'Crear tarea'
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}