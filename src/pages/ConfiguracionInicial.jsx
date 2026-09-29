import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { motion } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { CheckCircle2, Circle, Upload, FileText, Plus, X, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSchoolStudents } from '@/hooks/useSchoolStudents';
import { percentOfStudentsCovered } from '@/lib/schoolStudents';

export default function ConfiguracionInicial() {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [selectedStep, setSelectedStep] = useState(null);
  const [newStep, setNewStep] = useState({
    step_name: '',
    description: '',
    category: 'GENERAL',
    step_number: 1,
    is_annual: false
  });
  const [stepNotes, setStepNotes] = useState('');
  const [stepDocuments, setStepDocuments] = useState([]);

  const queryClient = useQueryClient();

  const { user, userProfile } = useCurrentProfile();

  const { data: steps = [], isLoading } = useQuery({
    queryKey: ['setupGuide', userProfile?.school_id],
    queryFn: () => base44.entities.SchoolSetupGuide.filter(
      { school_id: userProfile.school_id },
      'step_number'
    ),
    enabled: !!userProfile?.school_id,
  });
  const { data: allProfiles = [] } = useQuery({
    queryKey: ['allUserProfiles', userProfile?.school_id],
    queryFn: () => base44.entities.UserProfile.filter({ school_id: userProfile.school_id }),
    enabled: !!userProfile?.school_id,
  });
  const { data: students = [] } = useSchoolStudents(userProfile?.school_id);
  const { data: teacherAssignments = [] } = useQuery({
    queryKey: ['setupTeacherAssignments', userProfile?.school_id],
    queryFn: () => base44.entities.TeacherClassroom.filter({ school_id: userProfile.school_id, is_active: true }),
    enabled: !!userProfile?.school_id,
  });
  const { data: parentLinks = [] } = useQuery({
    queryKey: ['setupParentLinks', userProfile?.school_id],
    queryFn: () => base44.entities.ParentStudent.filter({ school_id: userProfile.school_id, status: 'ACTIVE' }),
    enabled: !!userProfile?.school_id,
  });
  const { data: concepts = [] } = useQuery({
    queryKey: ['setupPaymentConcepts', userProfile?.school_id],
    queryFn: () => base44.entities.PaymentConcept.filter({ school_id: userProfile.school_id, is_active: true }),
    enabled: !!userProfile?.school_id,
  });
  // One request for the whole school instead of one per student, in sequence.
  const { data: emergencyContacts = [] } = useQuery({
    queryKey: ['setupEmergencyContacts', userProfile?.school_id],
    queryFn: () => base44.entities.EmergencyContact.filter(
      { school_id: userProfile.school_id },
      undefined,
      5000,
    ),
    enabled: !!userProfile?.school_id,
  });

  const createStepMutation = useMutation({
    mutationFn: (data) => base44.entities.SchoolSetupGuide.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setupGuide'] });
      queryClient.invalidateQueries({ queryKey: ['homeSetupGuide'] });
      toast.success('Paso agregado');
      setShowAddDialog(false);
      setNewStep({ step_name: '', description: '', category: 'GENERAL', step_number: 1, is_annual: false });
    },
    onError: () => toast.error('No se pudo agregar el paso. Intenta de nuevo.'),
  });

  const updateStepMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.SchoolSetupGuide.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setupGuide'] });
      queryClient.invalidateQueries({ queryKey: ['homeSetupGuide'] });
      toast.success('Paso actualizado');
    },
    onError: () => toast.error('No se pudo guardar el cambio. Intenta de nuevo.'),
  });

  const deleteStepMutation = useMutation({
    mutationFn: (id) => base44.entities.SchoolSetupGuide.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setupGuide'] });
      queryClient.invalidateQueries({ queryKey: ['homeSetupGuide'] });
      toast.success('Paso eliminado');
    },
    onError: () => toast.error('No se pudo eliminar el paso. Intenta de nuevo.'),
  });

  const handleFileUpload = async (e, stepId) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadingFile(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      const step = steps.find(s => s.id === stepId);
      const existingDocs = step.documents || [];
      
      await updateStepMutation.mutateAsync({
        id: stepId,
        data: {
          ...step,
          documents: [...existingDocs, { name: file.name, url: file_url }]
        }
      });
      
      toast.success('Documento subido');
    } catch (error) {
      toast.error('Error al subir documento');
    }
    setUploadingFile(false);
  };

  const handleToggleComplete = async (step) => {
    await updateStepMutation.mutateAsync({
      id: step.id,
      data: {
        ...step,
        is_completed: !step.is_completed,
        completed_by: !step.is_completed ? user.id : null,
        completed_at: !step.is_completed ? new Date().toISOString() : null
      }
    });
  };
  const handleReopenStep = async (step) => {
    await updateStepMutation.mutateAsync({
      id: step.id,
      data: {
        ...step,
        is_completed: false,
        reopened_by: user.id,
        reopened_at: new Date().toISOString(),
      }
    });
    toast.success('Paso reabierto para corrección');
  };

  const handleConfirmStep = async (step) => {
    await updateStepMutation.mutateAsync({
      id: step.id,
      data: {
        ...step,
        last_confirmed_at: new Date().toISOString(),
        confirmed_by: user.id
      }
    });
    toast.success('Información confirmada como vigente');
  };

  const handleAddNotes = async (step) => {
    await updateStepMutation.mutateAsync({
      id: step.id,
      data: {
        ...step,
        notes: stepNotes
      }
    });
    setSelectedStep(null);
    setStepNotes('');
  };

  const handleRemoveDocument = async (step, docIndex) => {
    const updatedDocs = step.documents.filter((_, idx) => idx !== docIndex);
    await updateStepMutation.mutateAsync({
      id: step.id,
      data: {
        ...step,
        documents: updatedDocs
      }
    });
  };

  const initializeDefaultSteps = async () => {
    const defaultSteps = [
      // GENERAL - Anual
      { step_number: 1, step_name: 'Crear salones/grupos', description: 'Configurar los salones y grupos de la escuela', category: 'GENERAL', is_annual: true },
      { step_number: 2, step_name: 'Invitar maestros', description: 'Enviar invitaciones a los maestros y asignarlos a salones', category: 'GENERAL', is_annual: true },
      { step_number: 3, step_name: 'Registrar alumnos', description: 'Dar de alta a todos los alumnos en el sistema', category: 'GENERAL', is_annual: true },
      { step_number: 4, step_name: 'Invitar padres', description: 'Enviar invitaciones a padres y vincularlos con sus hijos', category: 'GENERAL', is_annual: true },
      { step_number: 5, step_name: 'Configurar conceptos de pago', description: 'Definir inscripciones, colegiaturas y otros conceptos', category: 'GENERAL', is_annual: true },
      { step_number: 6, step_name: 'Subir documentos oficiales', description: 'Cargar menús, comunicaciones y documentos importantes', category: 'GENERAL', is_annual: false },
      
      // GUARDERÍA
      { step_number: 7, step_name: 'Configurar horarios de alimentación', description: 'Definir horarios de desayuno, comida y snacks', category: 'GUARDERIA', is_annual: false },
      { step_number: 8, step_name: 'Protocolo de cambio de pañal', description: 'Documentar procedimientos de higiene y cambio', category: 'GUARDERIA', is_annual: false },
      { step_number: 9, step_name: 'Lista de alergias alimentarias', description: 'Registrar alergias de cada alumno', category: 'GUARDERIA', is_annual: true },
      { step_number: 10, step_name: 'Horarios de siesta', description: 'Establecer horarios de descanso', category: 'GUARDERIA', is_annual: false },
      
      // ESCUELA
      { step_number: 11, step_name: 'Subir plan de estudios', description: 'Cargar el programa educativo y materias', category: 'ESCUELA', is_annual: false },
      { step_number: 12, step_name: 'Calendario escolar', description: 'Definir días festivos, vacaciones y eventos importantes', category: 'ESCUELA', is_annual: true },
      { step_number: 13, step_name: 'Horarios de clase', description: 'Establecer horarios por materia y salón', category: 'ESCUELA', is_annual: true },
      { step_number: 14, step_name: 'Sistema de calificaciones', description: 'Configurar escalas y períodos de evaluación', category: 'ESCUELA', is_annual: false },
      
      // COLEGIO
      { step_number: 15, step_name: 'Reglamento interno', description: 'Subir reglamento escolar y código de conducta', category: 'COLEGIO', is_annual: false },
      { step_number: 16, step_name: 'Protocolo de seguridad', description: 'Documentar procedimientos de emergencia', category: 'COLEGIO', is_annual: false },
      { step_number: 17, step_name: 'Actividades extracurriculares', description: 'Configurar talleres y actividades opcionales', category: 'COLEGIO', is_annual: true },
      { step_number: 18, step_name: 'Uniformes y material', description: 'Subir catálogo de uniformes y lista de útiles', category: 'COLEGIO', is_annual: true },
    ];

    for (const step of defaultSteps) {
      await base44.entities.SchoolSetupGuide.create({
        ...step,
        school_id: userProfile.school_id
      });
    }
    
    queryClient.invalidateQueries({ queryKey: ['setupGuide'] });
    queryClient.invalidateQueries({ queryKey: ['homeSetupGuide'] });
    toast.success('Pasos iniciales creados');
  };

  if (isLoading) return <LoadingScreen />;

  const categories = ['GENERAL', 'GUARDERIA', 'ESCUELA', 'COLEGIO'];
  // Same labels as the category <Select> in the add-step dialog; the stored
  // value stays the enum.
  const categoryLabels = { GENERAL: 'General', GUARDERIA: 'Guardería', ESCUELA: 'Escuela', COLEGIO: 'Colegio' };
  const completedSteps = steps.filter(s => s.is_completed).length;
  const progress = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : 0;
  const teachers = allProfiles.filter((p) => p.app_role === 'TEACHER');
  const roleBootstrap = allProfiles.length > 0 ? Math.round((allProfiles.filter((p) => p.status === 'ACTIVE').length / allProfiles.length) * 100) : 0;
  const teacherCoverage = teachers.length > 0 ? Math.round((new Set(teacherAssignments.map((a) => a.teacher_id)).size / teachers.length) * 100) : 0;
  const parentCoverage = percentOfStudentsCovered(students, parentLinks);
  const paymentConceptBaseline = concepts.length > 0 ? 100 : 0;
  const emergencyCoverage = percentOfStudentsCovered(students, emergencyContacts);
  const setupChecklist = [
    { key: 'role_bootstrap', label: 'Usuarios activos', value: roleBootstrap },
    { key: 'classroom_teacher', label: 'Maestros con salón asignado', value: teacherCoverage },
    { key: 'student_parent', label: 'Alumnos con tutor vinculado', value: parentCoverage },
    { key: 'payment_concepts', label: 'Conceptos de pago creados', value: paymentConceptBaseline },
    { key: 'emergency_contacts', label: 'Alumnos con contacto de emergencia', value: emergencyCoverage },
  ];

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        title="Configuración inicial"
        subtitle="Guía paso a paso para configurar tu escuela"
        showBack
      />

      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 pb-24">
      {/* Progress */}
      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-muted-foreground">Progreso general</p>
            <p className="text-2xl font-bold text-brand">{progress}%</p>
          </div>
          <div className="w-full bg-muted rounded-full h-3">
            <div
              className="bg-brand h-3 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {completedSteps} de {steps.length} pasos completados
          </p>
        </CardContent>
      </Card>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Lista de arranque</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {setupChecklist.map((item) => (
            <div key={item.key}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-card-foreground">{item.label}</span>
                <span className="font-semibold text-card-foreground">{item.value}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div className="bg-brand h-2 rounded-full transition-all" style={{ width: `${item.value}%` }} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-3 mb-6">
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Agregar paso
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Agregar nuevo paso</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <Label>Número de paso</Label>
                <Input
                  type="number"
                  value={newStep.step_number}
                  onChange={(e) => setNewStep({ ...newStep, step_number: parseInt(e.target.value) })}
                />
              </div>
              <div>
                <Label>Nombre del paso</Label>
                <Input
                  value={newStep.step_name}
                  onChange={(e) => setNewStep({ ...newStep, step_name: e.target.value })}
                  placeholder="Ej: Configurar horarios"
                />
              </div>
              <div>
                <Label>Descripción</Label>
                <Textarea
                  value={newStep.description}
                  onChange={(e) => setNewStep({ ...newStep, description: e.target.value })}
                  placeholder="Describe qué se debe hacer en este paso"
                />
              </div>
              <div>
                <Label>Categoría</Label>
                <Select value={newStep.category} onValueChange={(v) => setNewStep({ ...newStep, category: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GENERAL">General</SelectItem>
                    <SelectItem value="GUARDERIA">Guardería</SelectItem>
                    <SelectItem value="ESCUELA">Escuela</SelectItem>
                    <SelectItem value="COLEGIO">Colegio</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_annual"
                  checked={newStep.is_annual}
                  onChange={(e) => setNewStep({ ...newStep, is_annual: e.target.checked })}
                  className="w-4 h-4"
                />
                <Label htmlFor="is_annual" className="cursor-pointer">
                  Requiere revisión anual
                </Label>
              </div>
              <Button
                onClick={() => createStepMutation.mutate({
                  ...newStep,
                  school_id: userProfile.school_id
                })}
                disabled={!newStep.step_name || createStepMutation.isPending}
                className="w-full"
              >
                {createStepMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Crear paso'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {steps.length === 0 && (
          <Button onClick={initializeDefaultSteps} variant="outline">
            Cargar pasos sugeridos
          </Button>
        )}
      </div>

      {/* Steps by Category */}
      {categories.map(category => {
        const categorySteps = steps.filter(s => s.category === category);
        if (categorySteps.length === 0) return null;

        return (
          <div key={category} className="mb-8">
            <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
              {categoryLabels[category] || category}
              <Badge variant="outline">{categorySteps.length}</Badge>
            </h2>
            <div className="space-y-3">
              {categorySteps.map((step, idx) => (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                >
                  <Card className={step.is_completed ? 'bg-green-50 border-green-200 dark:bg-green-950/40 dark:border-green-900' : ''}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => handleToggleComplete(step)}
                          className="mt-1"
                        >
                          {step.is_completed ? (
                            <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
                          ) : (
                            <Circle className="w-6 h-6 text-muted-foreground" />
                          )}
                        </button>
                        <div className="flex-1">
                          <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                            {step.step_number}. {step.step_name}
                            {step.is_completed && (
                              <Badge className="bg-green-600">Completado</Badge>
                            )}
                            {step.is_annual && (
                              <Badge variant="outline" className="text-xs">Revisar anualmente</Badge>
                            )}
                          </CardTitle>
                          <p className="text-sm text-muted-foreground mt-1">{step.description}</p>
                          {step.notes && (
                            <div className="mt-2 p-2 bg-muted rounded text-xs text-card-foreground">
                              📝 {step.notes}
                            </div>
                          )}
                          {step.last_confirmed_at && (
                            <div className="mt-2 p-2 bg-blue-50 rounded text-xs text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                              ✓ Confirmado vigente el {new Date(step.last_confirmed_at).toLocaleDateString('es-MX')}
                            </div>
                          )}
                          {step.completed_at && (
                            <div className="mt-2 text-xs text-muted-foreground">
                              Completado por {step.completed_by || 'N/D'} el {new Date(step.completed_at).toLocaleDateString('es-MX')}
                            </div>
                          )}
                          {step.reopened_at && (
                            <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                              Reabierto por {step.reopened_by || 'N/D'} el {new Date(step.reopened_at).toLocaleDateString('es-MX')}
                            </div>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteStepMutation.mutate(step.id)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {step.is_completed && step.is_annual && (
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleConfirmStep(step)}
                          >
                            <Check className="w-4 h-4 mr-2" />
                            Confirmar vigencia
                          </Button>
                        )}
                        {step.is_completed && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleReopenStep(step)}
                          >
                            Reabrir paso
                          </Button>
                        )}
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm" onClick={() => {
                              setSelectedStep(step);
                              setStepNotes(step.notes || '');
                            }}>
                              <FileText className="w-4 h-4 mr-2" />
                              Agregar notas
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Notas del paso</DialogTitle>
                            </DialogHeader>
                            <Textarea
                              value={stepNotes}
                              onChange={(e) => setStepNotes(e.target.value)}
                              placeholder="Agrega notas o comentarios sobre este paso"
                              rows={4}
                            />
                            <Button onClick={() => handleAddNotes(step)}>
                              Guardar notas
                            </Button>
                          </DialogContent>
                        </Dialog>

                        <label>
                          <Button variant="outline" size="sm" disabled={uploadingFile} asChild>
                            <span>
                              {uploadingFile ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              ) : (
                                <Upload className="w-4 h-4 mr-2" />
                              )}
                              Subir documento
                            </span>
                          </Button>
                          <input
                            type="file"
                            className="hidden"
                            onChange={(e) => handleFileUpload(e, step.id)}
                            accept=".pdf,.doc,.docx,.jpg,.png"
                          />
                        </label>
                      </div>

                      {step.documents && step.documents.length > 0 && (
                        <div className="mt-3 space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">Documentos adjuntos:</p>
                          {step.documents.map((doc, docIdx) => (
                            <div key={docIdx} className="flex items-center justify-between p-2 bg-muted rounded">
                              <a
                                href={doc.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-brand hover:underline flex items-center gap-2"
                              >
                                <FileText className="w-4 h-4" />
                                {doc.name}
                              </a>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveDocument(step, docIdx)}
                              >
                                <X className="w-3 h-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          </div>
        );
      })}

      {steps.length === 0 && (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground mb-4">No hay pasos configurados aún</p>
          <Button onClick={initializeDefaultSteps}>
            Cargar pasos sugeridos
          </Button>
        </Card>
      )}
      </div>
    </div>
  );
}
