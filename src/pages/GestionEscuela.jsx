import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { recordAuditRow } from '@/lib/audit';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { School, Users, Plus, ChevronRight, User, Loader2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import UpgradePlansModal from '@/components/subscription/UpgradePlansModal';
import ReadOnlyBanner from '@/components/subscription/ReadOnlyBanner';
import { useStudentQuota } from '@/hooks/useStudentQuota';
import { useCanWrite, guardWrite } from '@/hooks/useCanWrite';
import { ENTERPRISE_CONTACT_THRESHOLD } from '@/lib/license/licenseModel';
import { useSchoolStudents, invalidateSchoolStudents } from '@/hooks/useSchoolStudents';
import { countLabel } from '@/lib/spanishText';

const CONTACT_FORM_URL = 'https://forms.gle/jLQ4EtWmQhkSsahy9';

export default function GestionEscuela() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const studentQuota = useStudentQuota();
  const { canWrite } = useCanWrite();
  const [activeTab, setActiveTab] = useState('classrooms');
  const [showClassroomForm, setShowClassroomForm] = useState(false);
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [classroomForm, setClassroomForm] = useState({ name: '', grade: '' });
  const [studentForm, setStudentForm] = useState({ 
    first_name: '', 
    last_name: '', 
    classroom_id: '',
    birth_date: '' 
  });

  const { user, userProfile } = useCurrentProfile();

  // Inactive classrooms included, so the key carries 'all': AdminHome and
  // AvisosAdmin cache ACTIVE classrooms under ['allClassrooms', school_id], and
  // sharing that slot made the home's "Salones" count include inactive ones
  // after a visit here. Invalidating ['allClassrooms'] still hits both.
  const { data: classrooms = [], isLoading: loadingClassrooms } = useQuery({
    queryKey: ['allClassrooms', userProfile?.school_id, 'all'],
    queryFn: () => base44.entities.Classroom.filter({ 
      school_id: userProfile.school_id 
    }),
    enabled: !!userProfile,
  });

  // All students, inactive included (the list below filters is_active itself).
  // `activeOnly: false` is part of the query key, so this list never shares a
  // cache slot with the active-only lists on Home, Avisos or Pagos.
  const { data: students = [], isLoading: loadingStudents } = useSchoolStudents(
    userProfile?.school_id,
    { activeOnly: false },
  );

  const createClassroomMutation = useMutation({
    mutationFn: async (data) => {
      const classroom = await base44.entities.Classroom.create(data);
      await recordAuditRow({
        schoolId: userProfile.school_id,
        action: 'CLASSROOM_CREATED',
        entity: 'Classroom',
        entityId: classroom.id,
      });
      return classroom;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allClassrooms'] });
      toast.success('Salón creado correctamente');
      setShowClassroomForm(false);
      setClassroomForm({ name: '', grade: '' });
    },
    onError: () => {
      toast.error('Error al crear salón');
    }
  });

  const createStudentMutation = useMutation({
    mutationFn: async (data) => {
      const student = await base44.entities.Student.create(data);
      await recordAuditRow({
        schoolId: userProfile.school_id,
        action: 'STUDENT_CREATED',
        entity: 'Student',
        entityId: student.id,
      });
      return student;
    },
    onSuccess: () => {
      invalidateSchoolStudents(queryClient);
      queryClient.invalidateQueries({ queryKey: ['activeStudentCount'] });
      toast.success('Alumno agregado correctamente');
      setShowStudentForm(false);
      setStudentForm({ first_name: '', last_name: '', classroom_id: '', birth_date: '' });
    },
    onError: () => {
      toast.error('Error al agregar alumno');
    }
  });

  const blockReadOnly = () => toast.error('Tu licencia está en modo solo lectura. Reactívala para hacer cambios.');

  const handleCreateClassroom = (e) => {
    e.preventDefault();
    if (!guardWrite(canWrite, blockReadOnly)) return;
    createClassroomMutation.mutate({
      ...classroomForm,
      school_id: userProfile.school_id,
      is_active: true,
    });
  };

  const handleOpenStudentForm = () => {
    if (!guardWrite(canWrite, blockReadOnly)) return;
    // Hard-block only past the grace buffer; within grace adding is still allowed.
    if (studentQuota.exceeded) {
      toast.error(`Alcanzaste el máximo de tu plan (${studentQuota.limit} + margen). Mejora tu licencia para agregar más alumnos.`);
      setShowUpgrade(true);
      return;
    }
    setShowStudentForm(true);
  };

  const handleCreateStudent = (e) => {
    e.preventDefault();
    if (!guardWrite(canWrite, blockReadOnly)) return;
    // Guard again at submit time in case the count changed while the form was open.
    if (studentQuota.exceeded) {
      setShowStudentForm(false);
      setShowUpgrade(true);
      return;
    }
    createStudentMutation.mutate({
      ...studentForm,
      school_id: userProfile.school_id,
      is_active: true,
    });
  };

  const getStudentCount = (classroomId) => {
    return students.filter(s => s.classroom_id === classroomId && s.is_active).length;
  };

  const getClassroomName = (classroomId) => {
    const classroom = classrooms.find(c => c.id === classroomId);
    return classroom?.name || 'Sin asignar';
  };

  const isLoading = loadingClassrooms || loadingStudents;

  if (isLoading) return <LoadingScreen message="Cargando..." />;

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        title="Escuela"
        showBack
        backTo={createPageUrl('Home')}
      />

      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 pb-24">
      <ReadOnlyBanner />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full mb-6">
          <TabsTrigger value="classrooms" className="flex-1">Salones</TabsTrigger>
          <TabsTrigger value="students" className="flex-1">Alumnos</TabsTrigger>
        </TabsList>

        <TabsContent value="classrooms">
          <div className="flex justify-end mb-4">
            <Button onClick={() => setShowClassroomForm(true)} disabled={!canWrite} className="gap-1">
              <Plus className="w-4 h-4" /> Nuevo salón
            </Button>
          </div>

          {classrooms.length === 0 ? (
            <EmptyState
              icon={School}
              title="Sin salones"
              description="Crea el primer salón de tu escuela."
            />
          ) : (
            <div className="space-y-3">
              {classrooms.filter(c => c.is_active).map((classroom, index) => (
                <motion.div
                  key={classroom.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => navigate(createPageUrl(`GestionSalon?classroomId=${classroom.id}`))}
                  className="bg-card text-card-foreground rounded-2xl p-4 shadow-sm border border-border cursor-pointer flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-brand/10 flex items-center justify-center">
                      <School className="w-5 h-5 text-brand" />
                    </div>
                    <div>
                      <h3 className="font-medium text-card-foreground">{classroom.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {countLabel(getStudentCount(classroom.id), 'alumno')}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </motion.div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="students">
          {/* Over-plan warning while within the grace buffer (still allowed). */}
          {studentQuota.overLimit && !studentQuota.exceeded && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 flex items-center justify-between gap-3">
              <span>Estás por encima de tu plan ({studentQuota.used}/{studentQuota.limit} alumnos). Mejora tu licencia para más capacidad.</span>
              <Button size="sm" variant="outline" className="border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-200 shrink-0" onClick={() => setShowUpgrade(true)}>Mejorar</Button>
            </div>
          )}
          {/* Enterprise nudge for very large unlimited (Plus) schools. */}
          {studentQuota.salesContactSuggested && (
            <div className="mb-4 rounded-lg border border-brand/30 bg-brand/10 p-3 text-sm text-foreground">
              Tienes más de {ENTERPRISE_CONTACT_THRESHOLD.toLocaleString('es-MX')} alumnos.{' '}
              <a href={CONTACT_FORM_URL} target="_blank" rel="noreferrer" className="font-semibold underline text-brand">Contáctanos</a>{' '}
              para un plan a medida.
            </div>
          )}
          <div className="flex items-center justify-between mb-4 gap-3">
            {studentQuota.gatingActive && studentQuota.limit != null ? (
              <p className={`text-xs font-medium ${studentQuota.exceeded ? 'text-red-600 dark:text-red-400' : studentQuota.overLimit ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                {studentQuota.used} / {studentQuota.limit} alumnos licenciados{studentQuota.exceeded ? ' · límite alcanzado' : ''}
              </p>
            ) : <span />}
            <Button onClick={handleOpenStudentForm} disabled={!canWrite} className="gap-1">
              <Plus className="w-4 h-4" /> Nuevo alumno
            </Button>
          </div>

          {students.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Sin alumnos"
              description="Agrega el primer alumno a tu escuela."
            />
          ) : (
            <div className="space-y-3">
              {students.filter(s => s.is_active).map((student, index) => (
                <motion.div
                  key={student.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => navigate(createPageUrl(`GestionAlumno?studentId=${student.id}`))}
                  className="bg-card text-card-foreground rounded-2xl p-4 shadow-sm border border-border cursor-pointer flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                      <User className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="font-medium text-card-foreground">
                        {student.first_name} {student.last_name}
                      </h3>
                      <Badge variant="secondary" className="mt-1">
                        {getClassroomName(student.classroom_id)}
                      </Badge>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </motion.div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <UpgradePlansModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        currentTier={studentQuota.licenseTier}
        reason={`Tu plan permite hasta ${studentQuota.limit} alumnos. Mejora tu licencia para agregar más.`}
      />

      {/* Create Classroom Modal */}
      <Dialog open={showClassroomForm} onOpenChange={setShowClassroomForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo salón</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateClassroom} className="space-y-4">
            <div>
              <Label>Nombre del salón *</Label>
              <Input
                value={classroomForm.name}
                onChange={(e) => setClassroomForm({ ...classroomForm, name: e.target.value })}
                placeholder="Ej: 1-A, Preescolar Azul..."
                className="mt-1"
              />
            </div>
            <div>
              <Label>Grado (opcional)</Label>
              <Input
                value={classroomForm.grade}
                onChange={(e) => setClassroomForm({ ...classroomForm, grade: e.target.value })}
                placeholder="Ej: 1°, 2°, Preescolar..."
                className="mt-1"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowClassroomForm(false)} className="flex-1">
                Cancelar
              </Button>
              <Button 
                type="submit" 
                disabled={!classroomForm.name || createClassroomMutation.isPending}
                className="flex-1"
              >
                {createClassroomMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Crear'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create Student Modal */}
      <Dialog open={showStudentForm} onOpenChange={setShowStudentForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo alumno</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateStudent} className="space-y-4">
            <div>
              <Label>Nombre *</Label>
              <Input
                value={studentForm.first_name}
                onChange={(e) => setStudentForm({ ...studentForm, first_name: e.target.value })}
                placeholder="Nombre"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Apellidos *</Label>
              <Input
                value={studentForm.last_name}
                onChange={(e) => setStudentForm({ ...studentForm, last_name: e.target.value })}
                placeholder="Apellidos"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Salón *</Label>
              <Select
                value={studentForm.classroom_id}
                onValueChange={(value) => setStudentForm({ ...studentForm, classroom_id: value })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Seleccionar salón" />
                </SelectTrigger>
                <SelectContent>
                  {classrooms.filter(c => c.is_active).map((classroom) => (
                    <SelectItem key={classroom.id} value={classroom.id}>
                      {classroom.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Fecha de nacimiento</Label>
              <Input
                type="date"
                value={studentForm.birth_date}
                onChange={(e) => setStudentForm({ ...studentForm, birth_date: e.target.value })}
                className="mt-1"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowStudentForm(false)} className="flex-1">
                Cancelar
              </Button>
              <Button 
                type="submit" 
                disabled={!studentForm.first_name || !studentForm.last_name || !studentForm.classroom_id || createStudentMutation.isPending}
                className="flex-1"
              >
                {createStudentMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Agregar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}