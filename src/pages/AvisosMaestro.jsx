import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import NoticeCard from '@/components/notices/NoticeCard';
import EmptyState from '@/components/ui/EmptyState';
import { Bell, Plus, Loader2, ArrowRight, ArrowLeft, Send, CheckCircle } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { createPageUrl } from '@/utils';
import { toast } from "sonner";
import { canReadEntity, canWriteEntity, buildScopedFilter, filterByRowLevel } from '@/lib/authorization/policy';
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

export default function AvisosMaestro() {
  const queryClient = useQueryClient();
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [formData, setFormData] = useState({
    scope: 'CLASSROOM',
    classroom_id: '',
    title: '',
    content: '',
    priority: 'NORMAL',
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

  const { data: notices = [], isLoading } = useQuery({
    queryKey: ['teacherNotices', user?.id],
    queryFn: () => base44.entities.Notice.filter({ 
      author_id: user.id 
    }, '-created_date', 20),
    enabled: !!user,
  });

  const createNoticeMutation = useMutation({
    mutationFn: async (data) => {
      const notice = await base44.entities.Notice.create(data);
      
      await base44.entities.AuditLog.create({
        school_id: userProfile.school_id,
        user_id: user.id,
        user_email: user.email,
        action: 'NOTICE_SENT',
        target_type: 'Notice',
        target_id: notice.id,
        details: { scope: data.scope, priority: data.priority }
      });
      
      return notice;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['teacherNotices']);
      toast.success('Aviso enviado correctamente');
      setShowWizard(false);
      resetForm();
    },
    onError: () => {
      toast.error('Error al enviar el aviso');
    }
  });

  const resetForm = () => {
    setFormData({
      scope: 'CLASSROOM',
      classroom_id: '',
      title: '',
      content: '',
      priority: 'NORMAL',
    });
    setWizardStep(1);
  };

  const handleSubmit = () => {
    createNoticeMutation.mutate({
      ...formData,
      school_id: userProfile.school_id,
      author_id: user.id,
      author_name: user.full_name,
      sent_at: new Date().toISOString(),
    });
  };

  if (isLoading) return <LoadingScreen message="Cargando..." />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 pb-24">
      <PageHeader
        title="Avisos"
        showBack
        backTo={createPageUrl('Home')}
        action={
          <Button onClick={() => setShowWizard(true)} className="bg-violet-600 hover:bg-violet-700 gap-1">
            <Plus className="w-4 h-4" /> Crear
          </Button>
        }
      />

      {notices.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Sin avisos"
          description="Crea el primer aviso para tus alumnos y sus padres."
          action={
            <Button onClick={() => setShowWizard(true)} className="bg-violet-600 hover:bg-violet-700">
              <Plus className="w-4 h-4 mr-1" /> Crear aviso
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {notices.map((notice, index) => (
            <motion.div
              key={notice.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <NoticeCard notice={notice} />
            </motion.div>
          ))}
        </div>
      )}

      {/* Create Notice Wizard */}
      <Dialog open={showWizard} onOpenChange={(open) => { setShowWizard(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo aviso</DialogTitle>
          </DialogHeader>
          
          {/* Progress */}
          <div className="flex gap-2 mb-4">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`flex-1 h-1.5 rounded-full transition-colors ${
                  s <= wizardStep ? 'bg-violet-600' : 'bg-slate-200'
                }`}
              />
            ))}
          </div>

          <AnimatePresence mode="wait">
            {/* Step 1: Scope */}
            {wizardStep === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <h3 className="font-medium text-slate-800">¿A quién va dirigido?</h3>
                
                <div>
                  <Label>Salón</Label>
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
                  <Label>Prioridad</Label>
                  <Select
                    value={formData.priority}
                    onValueChange={(value) => setFormData({ ...formData, priority: value })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NORMAL">Normal</SelectItem>
                      <SelectItem value="IMPORTANT">Importante</SelectItem>
                      <SelectItem value="URGENT">Urgente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  onClick={() => setWizardStep(2)}
                  disabled={!formData.classroom_id}
                  className="w-full bg-violet-600 hover:bg-violet-700"
                >
                  Continuar <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </motion.div>
            )}

            {/* Step 2: Content */}
            {wizardStep === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <h3 className="font-medium text-slate-800">Escribe tu mensaje</h3>
                
                <div>
                  <Label>Título *</Label>
                  <Input
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="Título del aviso"
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label>Mensaje *</Label>
                  <Textarea
                    value={formData.content}
                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                    placeholder="Escribe el contenido del aviso..."
                    className="mt-1 min-h-[120px]"
                  />
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setWizardStep(1)} className="flex-1">
                    <ArrowLeft className="w-4 h-4 mr-1" /> Atrás
                  </Button>
                  <Button
                    onClick={() => setWizardStep(3)}
                    disabled={!formData.title || !formData.content}
                    className="flex-1 bg-violet-600 hover:bg-violet-700"
                  >
                    Revisar <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Step 3: Confirm */}
            {wizardStep === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="text-center mb-4">
                  <Send className="w-12 h-12 text-violet-600 mx-auto mb-2" />
                  <h3 className="font-medium text-slate-800">Confirmar y enviar</h3>
                </div>
                
                <div className="bg-slate-50 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Para:</span>
                    <span className="font-medium">{classrooms.find(c => c.id === formData.classroom_id)?.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Prioridad:</span>
                    <span className="font-medium">{formData.priority}</span>
                  </div>
                </div>

                <div className="bg-white border rounded-xl p-4">
                  <h4 className="font-semibold text-slate-800">{formData.title}</h4>
                  <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{formData.content}</p>
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setWizardStep(2)} className="flex-1">
                    <ArrowLeft className="w-4 h-4 mr-1" /> Editar
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    disabled={createNoticeMutation.isPending}
                    className="flex-1 bg-violet-600 hover:bg-violet-700"
                  >
                    {createNoticeMutation.isPending ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4 mr-1" /> Enviar
                      </>
                    )}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </DialogContent>
      </Dialog>
    </div>
  );
}