import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { motion, AnimatePresence } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { User, CheckCircle, AlertCircle, Sparkles, ArrowRight, ArrowLeft, Send, Loader2, Undo2 } from 'lucide-react';
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
import { guardedCreate } from '@/lib/authorization/guardedWrite';
import { formatLocalDate, parseLocalDate } from '@/lib/dates';

// Etiquetas en español para los valores guardados (el resumen de revisión
// mostraba "necesita_apoyo" / "casi_todo" tal cual).
const FIELD_LABELS = {
  behavior: { excelente: 'Excelente', bueno: 'Bueno', regular: 'Regular', necesita_apoyo: 'Necesita apoyo' },
  learning: { excelente: 'Excelente', bueno: 'Bueno', regular: 'Regular', necesita_apoyo: 'Necesita apoyo' },
  mood: { feliz: 'Feliz', tranquilo: 'Tranquilo', cansado: 'Cansado', inquieto: 'Inquieto', triste: 'Triste' },
  food: { todo: 'Comió todo', casi_todo: 'Casi todo', poco: 'Poco', nada: 'No comió' },
};
const fieldLabel = (field, value) => FIELD_LABELS[field]?.[value] || value;

export default function CrearBitacora() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canWrite } = useCanWrite();
  const urlParams = new URLSearchParams(window.location.search);
  const classroomId = urlParams.get('classroomId');
  // Día local de la escuela (no toISOString: después de las 18:00 en México
  // eso ya es mañana). La misma cadena se guarda y se muestra.
  const today = formatLocalDate(new Date());
  const todayDate = parseLocalDate(today);
  
  const [step, setStep] = useState(1); // 1: select student, 2: write, 3: review, 4: confirm
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  // Sugerencia de Lumi pendiente de aceptar, y el texto previo para deshacer.
  // Lumi nunca sobrescribe lo que escribió la maestra sin que ella lo elija.
  const [suggestion, setSuggestion] = useState('');
  const [notesBeforeSuggestion, setNotesBeforeSuggestion] = useState(null);
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

  const { user, userProfile } = useCurrentProfile();

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
      const entry = await guardedCreate('DiaryEntry', data);
      
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
      
      // Si se marca para enviar a padres, notificar automáticamente. El envío
      // (destinatarios, asunto y cuerpo) ahora lo arma y ejecuta la Safe
      // function `notifyParents` server-side, a partir de la bitácora ya
      // guardada — el cliente sólo pasa el id. Ver
      // base44/functions/notifyParents/entry.ts (arreglo al hallazgo "Evitar
      // el uso no autorizado de créditos" del scan de seguridad de Base44).
      if (data.sent_to_parents) {
        try {
          await base44.functions.invoke('notifyParents', { kind: 'diary', recordId: entry.id });
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

  const hasDraftInput = Boolean(
    formData.notes_text.trim() || formData.behavior || formData.mood || formData.food || formData.learning || formData.incidents.trim()
  );

  const handleGenerateWithLumi = async () => {
    if (!selectedStudent || !hasDraftInput) return;

    setIsGenerating(true);
    try {
      // El prompt se arma server-side en la Safe function `aiAssist` (task:
      // 'diary_draft') a partir de lo que la maestra ya escribió y eligió —
      // la instrucción es redactar SIN inventar actividades. Ver su comentario
      // de cabecera. El cliente ya no llama a InvokeLLM directo.
      const response = await base44.functions.invoke('aiAssist', {
        task: 'diary_draft',
        studentId: selectedStudent.id,
        draft: formData.notes_text,
        fields: {
          behavior: formData.behavior,
          mood: formData.mood,
          food: formData.food,
          learning: formData.learning,
          incidents: formData.incidents,
        },
      });
      const text = String(response?.text || '').trim();
      if (text) setSuggestion(text);
      else toast.error('Lumi no pudo proponer un texto. Intenta de nuevo.');
    } catch (error) {
      console.error('Error generating text:', error);
      toast.error(error?.data?.error || 'Error al generar texto');
    }
    setIsGenerating(false);
  };

  const applySuggestion = (mode) => {
    setNotesBeforeSuggestion(formData.notes_text);
    const current = formData.notes_text.trim();
    const next = mode === 'append' && current ? `${current}\n\n${suggestion}` : suggestion;
    setFormData({ ...formData, notes_text: next });
    setSuggestion('');
  };

  const undoSuggestion = () => {
    if (notesBeforeSuggestion === null) return;
    setFormData({ ...formData, notes_text: notesBeforeSuggestion });
    setNotesBeforeSuggestion(null);
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
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 pb-24">
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
              s <= step ? 'bg-brand' : 'bg-muted'
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
            <h2 className="text-lg font-semibold text-foreground mb-4">
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
                  className="w-full flex items-center gap-3 p-4 bg-card text-card-foreground rounded-2xl border border-border hover:border-brand/30 hover:bg-brand/10 transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center">
                    <User className="w-5 h-5 text-brand" />
                  </div>
                  <div>
                    <p className="font-medium text-card-foreground">
                      {student.first_name} {student.last_name}
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Sin bitácora hoy
                    </p>
                  </div>
                </button>
              ))}

              {studentsWithoutDiary.length === 0 && (
                <div className="text-center py-8">
                  <CheckCircle className="w-16 h-16 text-green-500 dark:text-green-400 mx-auto mb-4" />
                  <p className="text-lg font-medium text-foreground">¡Todas las bitácoras completas!</p>
                  <p className="text-muted-foreground">Todos los alumnos tienen su bitácora de hoy.</p>
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
            <div className="bg-brand/10 rounded-2xl p-4 flex items-center gap-3">
              <User className="w-8 h-8 text-brand" />
              <div>
                <p className="font-semibold text-foreground">
                  {selectedStudent?.first_name} {selectedStudent?.last_name}
                </p>
                <p className="text-sm text-muted-foreground">{format(todayDate, "d 'de' MMMM", { locale: es })}</p>
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
                  disabled={isGenerating || !hasDraftInput}
                  title={hasDraftInput ? undefined : 'Escribe unas notas o elige comportamiento, ánimo, comida o aprendizaje'}
                  className="gap-1"
                >
                  {isGenerating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 text-brand" />
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
              {!hasDraftInput && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Lumi mejora la redacción de lo que tú escribes o eliges; no inventa actividades.
                </p>
              )}
              {notesBeforeSuggestion !== null && !suggestion && (
                <button
                  type="button"
                  onClick={undoSuggestion}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                >
                  <Undo2 className="w-3.5 h-3.5" /> Deshacer el cambio de Lumi
                </button>
              )}
              {suggestion && (
                <div
                  className="mt-3 rounded-2xl border border-brand/30 bg-brand/10 p-4"
                  role="region"
                  aria-label="Sugerencia de Lumi"
                >
                  <p className="text-xs font-semibold text-brand mb-1 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" /> Sugerencia de Lumi — revísala antes de usarla
                  </p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{suggestion}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={() => applySuggestion('replace')}>
                      Usar esta versión
                    </Button>
                    {formData.notes_text.trim() && (
                      <Button type="button" size="sm" variant="outline" onClick={() => applySuggestion('append')}>
                        Agregar al final
                      </Button>
                    )}
                    <Button type="button" size="sm" variant="ghost" onClick={() => setSuggestion('')}>
                      Descartar
                    </Button>
                  </div>
                </div>
              )}
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
                disabled={!formData.notes_text.trim() || !!suggestion}
                className="flex-1"
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
            <h2 className="text-lg font-semibold text-foreground mb-4">Revisa la bitácora</h2>

            <div className="bg-card text-card-foreground rounded-2xl p-5 shadow-sm border border-border space-y-4">
              <div className="flex items-center gap-3 pb-3 border-b border-border">
                <User className="w-10 h-10 text-brand bg-brand/10 rounded-full p-2" />
                <div>
                  <p className="font-semibold text-card-foreground">{selectedStudent?.first_name} {selectedStudent?.last_name}</p>
                  <p className="text-sm text-muted-foreground">{format(todayDate, "d 'de' MMMM, yyyy", { locale: es })}</p>
                </div>
              </div>

              <div className="bg-muted rounded-xl p-4">
                <p className="text-card-foreground whitespace-pre-wrap">{formData.notes_text}</p>
              </div>

              {formData.teacher_message && (
                <div className="bg-gradient-to-r from-pink-50 to-purple-50 dark:from-pink-950/40 dark:to-purple-950/40 rounded-xl p-4 border border-pink-200 dark:border-pink-900">
                  <p className="text-xs font-semibold text-pink-800 dark:text-pink-300 mb-1">💌 Mensajito especial</p>
                  <p className="text-sm text-purple-700 dark:text-purple-300">{formData.teacher_message}</p>
                </div>
              )}

              {(formData.behavior || formData.mood || formData.food || formData.learning) && (
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {formData.behavior && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Comportamiento:</span>
                      <span className="font-medium text-card-foreground">{fieldLabel('behavior', formData.behavior)}</span>
                    </div>
                  )}
                  {formData.mood && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Ánimo:</span>
                      <span className="font-medium text-card-foreground">{fieldLabel('mood', formData.mood)}</span>
                    </div>
                  )}
                  {formData.food && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Comida:</span>
                      <span className="font-medium text-card-foreground">{fieldLabel('food', formData.food)}</span>
                    </div>
                  )}
                  {formData.learning && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Aprendizaje:</span>
                      <span className="font-medium text-card-foreground">{fieldLabel('learning', formData.learning)}</span>
                    </div>
                  )}
                </div>
              )}

              {formData.incidents && (
                <div className="bg-amber-50 dark:bg-amber-950/40 rounded-xl p-3">
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-300">Incidentes:</p>
                  <p className="text-sm text-amber-700 dark:text-amber-200">{formData.incidents}</p>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-6">
              <Button variant="outline" onClick={() => setStep(2)} className="flex-1">
                <ArrowLeft className="w-4 h-4 mr-1" /> Editar
              </Button>
              <Button
                onClick={() => setStep(4)}
                className="flex-1"
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
            <div className="w-20 h-20 rounded-full bg-brand/10 flex items-center justify-center mx-auto mb-6">
              <Send className="w-10 h-10 text-brand" />
            </div>

            <h2 className="text-xl font-semibold text-foreground mb-2">¿Enviar a los papás?</h2>
            <p className="text-muted-foreground mb-6">
              La bitácora se guardará y se enviará notificación a los padres de {selectedStudent?.first_name}.
            </p>

            <div className="flex items-center justify-center gap-3 bg-muted rounded-xl p-4 mb-6">
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
                className="flex-1"
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
    </div>
  );
}