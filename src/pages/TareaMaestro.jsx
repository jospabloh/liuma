import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import HomeworkCard from '@/components/homework/HomeworkCard';
import EmptyState from '@/components/ui/EmptyState';
import { BookOpen, Plus, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { createPageUrl } from '@/utils';
import { toast } from "sonner";
import { loadHomeworkByClassroomIds, normalizedIdQueryKey } from '@/lib/data-loaders/batchedEntityLoaders';
import { getLinkedClassrooms } from '@/lib/relations/getLinkedClassrooms';
import ReadOnlyBanner from '@/components/subscription/ReadOnlyBanner';
import { useCanWrite, guardWrite } from '@/hooks/useCanWrite';
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
  const { canWrite } = useCanWrite();
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
    if (!guardWrite(canWrite, () => toast.error('Tu licencia está en modo solo lectura. Reactívala para crear tareas.'))) return;
    createHomeworkMutation.mutate({
      ...formData,
      school_id: userProfile.school_id,
      teacher_id: user.id,
      teacher_name: user.full_name,
      assigned_date: format(new Date(), 'yyyy-MM-dd'),
    });
  };

  const isDirty = useMemo(() => (
    formData.classroom_id || formData.subject || formData.title || formData.description || formData.due_date !== format(new Date(), 'yyyy-MM-dd')
  ), [formData]);

  const getClassroomName = (id) => {
    const classroom = classrooms.find(c => c.id === id);
    return classroom?.name || '';
  };

  if (isLoading) return <LoadingScreen message="Cargando..." />;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 pb-24">
      <PageHeader
        title="Tarea"
        showBack
        backTo={createPageUrl('Home')}
        action={
          <Button onClick={() => setShowForm(true)} disabled={!canWrite} className="gap-1">
            <Plus className="w-4 h-4" /> Crear
          </Button>
        }
      />

      <ReadOnlyBanner />

      {homework.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Sin tareas"
          description="Crea la primera tarea para tus alumnos."
          action={
            <Button onClick={() => setShowForm(true)}>
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
                <div className="absolute top-2 right-2 text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
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
        <DialogContent
          className="max-w-md"
          onInteractOutside={(event) => {
            if (isDirty && !createHomeworkMutation.isPending) {
              event.preventDefault();
              toast.error('Tienes cambios sin guardar');
            }
          }}
        >
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
              <Button type="button" variant="outline" onClick={() => {
                if (isDirty && !createHomeworkMutation.isPending && !window.confirm('¿Descartar cambios de la tarea?')) return;
                setShowForm(false);
              }} className="flex-1">
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={!formData.classroom_id || !formData.title || !formData.due_date || createHomeworkMutation.isPending}
                className="flex-1"
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
    </div>
  );
}