import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { User, CheckCircle, AlertCircle, Sparkles, ArrowRight, ArrowLeft, Send, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createPageUrl } from '@/utils';
import { useNavigate } from 'react-router-dom';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { AUDIT_ENTITIES, logAuditEvent } from '@/lib/audit';
import ReadOnlyBanner from '@/components/subscription/ReadOnlyBanner';
import { useCanWrite, guardWrite } from '@/hooks/useCanWrite';

export default function CrearBitacora() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canWrite } = useCanWrite();
  const urlParams = new URLSearchParams(window.location.search);
  const classroomId = urlParams.get('classroomId');
  const today = format(new Date(), 'yyyy-MM-dd');
  
  const [step, setStep] = useState(1); // 1: select student, 2: write, 3: review, 4: confirm
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [sendToParents, setSendToParents] = useState(true);
  const [formData, setFormData] = useState({
    notes_text: '',
    teacher_message: '',
    behavior: '',
    learning: '',
    mood: '',
    food: '',
    naps: '',
    bathroom: '',
    incidents: '',
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

  const { data: classroom } = useQuery({
    queryKey: ['classroom', classroomId],
    queryFn: async () => {
      const classrooms = await base44.entities.Classroom.filter({ id: classroomId });
      return classrooms[0];
    },
    enabled: !!classroomId,
  });

  const { data: students = [], isLoading } = useQuery({
    queryKey: ['students', classroomId],
    queryFn: () => base44.entities.Student.filter({ 
      classroom_id: classroomId,
      is_active: true 
    }),
    enabled: !!classroomId,
  });

  const { data: todayDiaries = [] } = useQuery({
    queryKey: ['todayDiaries', today, classroomId],
    queryFn: () => base44.entities.DiaryEntry.filter({ 
      date: today,
      classroom_id: classroomId
    }),
    enabled: !!classroomId,
  });

  const studentsWithDiary = new Set(todayDiaries.map(d => d.student_id));
  const studentsWithoutDiary = students.filter(s => !studentsWithDiary.has(s.id));

  const createDiaryMutation = useMutation({
    mutationFn: async (data) => {
      const entry = await base44.entities.DiaryEntry.create(data);
      
      // Log the action
      await logAuditEvent({
        user,
        userProfile,
        entity: AUDIT_ENTITIES.DIARY_ENTRY,
        entityId: entry.id,
        action: 'DIARY_CREATED',
        reason: 'Teacher diary submission',
        context: { student_id: data.student_id, sent_to_parents: data.sent_to_parents }
      });
      
      // Si se marca para enviar a padres, notificar automáticamente
      if (data.sent_to_parents) {
        try {
          const student = students.find(s => s.id === data.student_id);
          const parentLinks = await base44.entities.ParentStudent.filter({
            student_id: data.student_id,
            status: 'ACTIVE'
          });
          
          const allUsers = await base44.entities.User.list();
          
          for (const link of parentLinks) {
            const parent = allUsers.find(u => u.id === link.parent_id);
            if (parent) {
              await base44.integrations.Core.SendEmail({
                from_name: 'LIUMA - Bitácora Escolar',
                to: parent.email,
                subject: `Nueva bitácora de ${student.first_name} - ${format(new Date(), "d 'de' MMMM", { locale: es })}`,
                body: `
                  <h2>Bitácora de ${student.first_name} ${student.last_name}</h2>
                  <p><strong>Fecha:</strong> ${format(new Date(), "d 'de' MMMM, yyyy", { locale: es })}</p>
                  
                  <div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0;">
                    <p style="color: #334155; white-space: pre-wrap;">${data.notes_text}</p>
                  </div>
                  
                  ${data.teacher_message ? `
                    <div style="background: linear-gradient(to right, #fce7f3, #f3e8ff); padding: 16px; border-radius: 8px; border: 1px solid #f9a8d4; margin: 16px 0;">
                      <p style="font-size: 12px; color: #9f1239; font-weight: bold; margin-bottom: 8px;">💌 Mensajito especial</p>
                      <p style="color: #7c3aed;">${data.teacher_message}</p>
                    </div>
                  ` : ''}
                  
                  <p style="margin-top: 16px;">Registrado por: ${data.teacher_name}</p>
                  <p style="color: #64748b; font-size: 12px; margin-top: 8px;">Este es un mensaje automático de LIUMA.</p>
                `
              });
            }
          }
        } catch (error) {
          console.error('Error sending diary notifications:', error);
        }
      }
      
      return entry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['todayDiaries']);
      toast.success('Bitácora guardada correctamente');
      navigate(createPageUrl('BitacorasMaestro'));
    },
    onError: (error) => {
      toast.error('Error al guardar la bitácora');
    }
  });

  const handleGenerateWithLumi = async () => {
    if (!selectedStudent) return;
    
    setIsGenerating(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Genera una nota de bitácora escolar en español para un alumno llamado ${selectedStudent.first_name}. 
        La nota debe ser positiva, breve (2-3 oraciones) y mencionar actividades típicas del día escolar.
        Solo devuelve el texto de la nota, sin comillas ni formato adicional.`,
      });
      
      setFormData({ ...formData, notes_text: response });
    } catch (error) {
      console.error('Error generating text:', error);
      toast.error('Error al generar texto');
    }
    setIsGenerating(false);
  };

  const handleSubmit = () => {
    if (!guardWrite(canWrite, () => toast.error('Tu licencia está en modo solo lectura. Reactívala para crear bitácoras.'))) return;
    createDiaryMutation.mutate({
      school_id: userProfile.school_id,
      classroom_id: classroomId,
      student_id: selectedStudent.id,
      date: today,
      teacher_id: user.id,
      teacher_name: user.full_name,
      notes_text: formData.notes_text,
      teacher_message: formData.teacher_message || undefined,
      behavior: formData.behavior || undefined,
      learning: formData.learning || undefined,
      mood: formData.mood || undefined,
      food: formData.food || undefined,
      naps: formData.naps || undefined,
      bathroom: formData.bathroom || undefined,
      incidents: formData.incidents || undefined,
      sent_to_parents: sendToParents,
      sent_at: sendToParents ? new Date().toISOString() : undefined,
    });
  };

  if (isLoading) return <LoadingScreen message="Cargando..." />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 pb-24">
      <PageHeader
        title="Crear bitácora"
        subtitle={classroom?.name}
        showBack
        backTo={createPageUrl('BitacorasMaestro')}
      />

      <ReadOnlyBanner />

      {/* Progress Steps */}
      <div className="flex gap-2 mb-6">
        {[1, 2, 3, 4].map((s) => (
          <div
            key={s}
            className={`flex-1 h-1.5 rounded-full transition-colors ${
              s <= step ? 'bg-emerald-600' : 'bg-slate-200'
            }`}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* Step 1: Select Student */}
        {step === 1 && (
          <motion.div
            key="step1"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            <h2 className="text-lg font-semibold text-slate-800 mb-4">
              Selecciona un alumno
            </h2>
            <div className="space-y-2">
              {studentsWithoutDiary.map((student) => (
                <button
                  key={student.id}
                  onClick={() => {
                    setSelectedStudent(student);
                    setStep(2);
                  }}
                  className="w-full flex items-center gap-3 p-4 bg-white rounded-xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                    <User className="w-5 h-5 text-slate-500" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-800">
                      {student.first_name} {student.last_name}
                    </p>
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Sin bitácora hoy
                    </p>
                  </div>
                </button>
              ))}
              
              {studentsWithoutDiary.length === 0 && (
                <div className="text-center py-8">
                  <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
                  <p className="text-lg font-medium text-slate-800">¡Todas las bitácoras completas!</p>
                  <p className="text-slate-500">Todos los alumnos tienen su bitácora de hoy.</p>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Step 2: Write */}
        {step === 2 && (
          <motion.div
            key="step2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-4"
          >
            <div className="bg-emerald-50 rounded-xl p-4 flex items-center gap-3">
              <User className="w-8 h-8 text-emerald-600" />
              <div>
                <p className="font-semibold text-emerald-800">
                  {selectedStudent?.first_name} {selectedStudent?.last_name}
                </p>
                <p className="text-sm text-emerald-600">{format(new Date(), "d 'de' MMMM", { locale: es })}</p>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Notas del día *</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateWithLumi}
                  disabled={isGenerating}
                  className="gap-1"
                >
                  {isGenerating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 text-violet-600" />
                  )}
                  Ayúdame con Lumi
                </Button>
              </div>
              <Textarea
                value={formData.notes_text}
                onChange={(e) => setFormData({ ...formData, notes_text: e.target.value })}
                placeholder="Describe cómo estuvo el día del alumno..."
                className="min-h-[120px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Comportamiento</Label>
                <Select
                  value={formData.behavior}
                  onValueChange={(value) => setFormData({ ...formData, behavior: value })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="excelente">Excelente</SelectItem>
                    <SelectItem value="bueno">Bueno</SelectItem>
                    <SelectItem value="regular">Regular</SelectItem>
                    <SelectItem value="necesita_apoyo">Necesita apoyo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Estado de ánimo</Label>
                <Select
                  value={formData.mood}
                  onValueChange={(value) => setFormData({ ...formData, mood: value })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="feliz">Feliz</SelectItem>
                    <SelectItem value="tranquilo">Tranquilo</SelectItem>
                    <SelectItem value="cansado">Cansado</SelectItem>
                    <SelectItem value="inquieto">Inquieto</SelectItem>
                    <SelectItem value="triste">Triste</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Alimentación</Label>
                <Select
                  value={formData.food}
                  onValueChange={(value) => setFormData({ ...formData, food: value })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todo">Comió todo</SelectItem>
                    <SelectItem value="casi_todo">Casi todo</SelectItem>
                    <SelectItem value="poco">Poco</SelectItem>
                    <SelectItem value="nada">No comió</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Aprendizaje</Label>
                <Select
                  value={formData.learning}
                  onValueChange={(value) => setFormData({ ...formData, learning: value })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="excelente">Excelente</SelectItem>
                    <SelectItem value="bueno">Bueno</SelectItem>
                    <SelectItem value="regular">Regular</SelectItem>
                    <SelectItem value="necesita_apoyo">Necesita apoyo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Mensajito especial para el alumno (opcional)</Label>
              <Textarea
                value={formData.teacher_message}
                onChange={(e) => setFormData({ ...formData, teacher_message: e.target.value })}
                placeholder="Ej: ¡Eres muy atento y creativo, te queremos mucho!"
                className="mt-1"
              />
            </div>

            <div>
              <Label>Incidentes (opcional)</Label>
              <Textarea
                value={formData.incidents}
                onChange={(e) => setFormData({ ...formData, incidents: e.target.value })}
                placeholder="Reportar algún incidente..."
                className="mt-1"
              />
            </div>

            <div className="flex gap-3 pt-4">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
                <ArrowLeft className="w-4 h-4 mr-1" /> Atrás
              </Button>
              <Button
                onClick={() => setStep(3)}
                disabled={!formData.notes_text}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700"
              >
                Revisar <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </motion.div>
        )}

        {/* Step 3: Review */}
        {step === 3 && (
          <motion.div
            key="step3"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Revisa la bitácora</h2>
            
            <div className="bg-white rounded-2xl p-5 shadow-sm border space-y-4">
              <div className="flex items-center gap-3 pb-3 border-b">
                <User className="w-10 h-10 text-emerald-600 bg-emerald-50 rounded-full p-2" />
                <div>
                  <p className="font-semibold">{selectedStudent?.first_name} {selectedStudent?.last_name}</p>
                  <p className="text-sm text-slate-500">{format(new Date(), "d 'de' MMMM, yyyy", { locale: es })}</p>
                </div>
              </div>

              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-slate-700 whitespace-pre-wrap">{formData.notes_text}</p>
              </div>

              {formData.teacher_message && (
                <div className="bg-gradient-to-r from-pink-50 to-purple-50 rounded-xl p-4 border border-pink-200">
                  <p className="text-xs font-semibold text-pink-800 mb-1">💌 Mensajito especial</p>
                  <p className="text-sm text-purple-700">{formData.teacher_message}</p>
                </div>
              )}

              {(formData.behavior || formData.mood || formData.food || formData.learning) && (
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {formData.behavior && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Comportamiento:</span>
                      <span className="font-medium">{formData.behavior}</span>
                    </div>
                  )}
                  {formData.mood && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Ánimo:</span>
                      <span className="font-medium">{formData.mood}</span>
                    </div>
                  )}
                  {formData.food && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Comida:</span>
                      <span className="font-medium">{formData.food}</span>
                    </div>
                  )}
                  {formData.learning && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Aprendizaje:</span>
                      <span className="font-medium">{formData.learning}</span>
                    </div>
                  )}
                </div>
              )}

              {formData.incidents && (
                <div className="bg-amber-50 rounded-xl p-3">
                  <p className="text-xs font-medium text-amber-800">Incidentes:</p>
                  <p className="text-sm text-amber-700">{formData.incidents}</p>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-6">
              <Button variant="outline" onClick={() => setStep(2)} className="flex-1">
                <ArrowLeft className="w-4 h-4 mr-1" /> Editar
              </Button>
              <Button
                onClick={() => setStep(4)}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700"
              >
                Confirmar <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </motion.div>
        )}

        {/* Step 4: Confirm & Send */}
        {step === 4 && (
          <motion.div
            key="step4"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="text-center"
          >
            <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-6">
              <Send className="w-10 h-10 text-emerald-600" />
            </div>
            
            <h2 className="text-xl font-semibold text-slate-800 mb-2">¿Enviar a los papás?</h2>
            <p className="text-slate-500 mb-6">
              La bitácora se guardará y se enviará notificación a los padres de {selectedStudent?.first_name}.
            </p>

            <div className="flex items-center justify-center gap-3 bg-slate-50 rounded-xl p-4 mb-6">
              <Switch
                checked={sendToParents}
                onCheckedChange={setSendToParents}
                id="send-parents"
              />
              <Label htmlFor="send-parents" className="cursor-pointer">
                Notificar a los papás
              </Label>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(3)} className="flex-1">
                <ArrowLeft className="w-4 h-4 mr-1" /> Atrás
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createDiaryMutation.isPending}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700"
              >
                {createDiaryMutation.isPending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-1" /> Guardar
                  </>
                )}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}