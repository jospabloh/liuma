import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { schoolRead } from '@/lib/data/schoolRead';
import { recordAuditRow } from '@/lib/audit';
import { humanizeError } from '@/lib/errorMessages';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { User, Link, Unlink, UserPlus, Mail, Loader2, CheckCircle, Pencil, Heart, Shield, Stethoscope } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dates';
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { createPageUrl } from '@/utils';
import { useSchoolMembers } from '@/lib/members/useSchoolMembers';
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
import { guardedCreate, guardedUpdate } from '@/lib/authorization/guardedWrite';
import { canGuardedWrite } from '@/lib/authorization/guardedWritePolicy';
import { useCanWrite, guardWrite } from '@/hooks/useCanWrite';
import { invalidateSchoolStudents } from '@/hooks/useSchoolStudents';
import StudentFormDialog from '@/components/school/StudentFormDialog';
import { studentUpdatePatch } from '@/lib/forms/directorForms';
import LoadError from '@/components/ui/LoadError';
import { blockingLoadFailure } from '@/lib/loadFailure';

export default function GestionAlumno() {
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const studentId = urlParams.get('studentId');
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [selectedParentId, setSelectedParentId] = useState('');
  const [relationship, setRelationship] = useState('tutor');
  const [showEditForm, setShowEditForm] = useState(false);
  const { canWrite } = useCanWrite();

  const { userProfile } = useCurrentProfile();

  const studentQuery = useQuery({
    queryKey: ['student', studentId],
    queryFn: async () => {
      const students = await schoolRead('Student', { id: studentId });
      return students[0];
    },
    enabled: !!studentId,
  });
  const { data: student, isLoading } = studentQuery;

  const classroomQuery = useQuery({
    queryKey: ['classroom', student?.classroom_id],
    queryFn: async () => {
      const classrooms = await schoolRead('Classroom', { id: student.classroom_id });
      return classrooms[0];
    },
    enabled: !!student?.classroom_id,
  });
  const { data: classroom } = classroomQuery;

  const parentLinksQuery = useQuery({
    queryKey: ['studentParentLinks', studentId],
    queryFn: () => schoolRead('ParentStudent', { student_id: studentId }),
    enabled: !!studentId,
  });
  const { data: parentLinks = [] } = parentLinksQuery;
  // A failed read is not "Sin salón" / "Sin padres vinculados" (v1.8.3).
  const studentFailure = blockingLoadFailure(studentQuery);
  const linksFailure = blockingLoadFailure(parentLinksQuery);
  const classroomLabel = classroomQuery.isError && !classroom
    ? 'Salón: no se pudo cargar'
    : classroom?.name || (student?.classroom_id ? (classroomQuery.isLoading ? 'Cargando salón…' : 'Salón no disponible') : 'Sin salón');

  const { data: parentProfiles = [] } = useQuery({
    queryKey: ['parentProfiles', userProfile?.school_id],
    queryFn: () => schoolRead('UserProfile', { 
      school_id: userProfile.school_id,
      app_role: 'PARENT',
      status: 'ACTIVE'
    }),
    enabled: !!userProfile,
  });

  // Parent names/emails come from the server-side member directory
  // (UserProfile has neither, and a client User.list() only returns the
  // caller's own row — every parent used to read "Sin nombre").
  const { getName: getUserName, getEmail: getUserEmail } = useSchoolMembers(userProfile?.school_id);

  // Linking a parent grants them the child's whole record (schoolRead derives
  // a parent's children from these links), so only a school ADMIN hands it
  // out — guardedEntityWrite refuses anyone else (P10b). A teacher still sees
  // who is linked.
  const canManageLinks = canGuardedWrite(userProfile?.app_role, 'ParentStudent', 'create');

  // Editing a student (name, classroom, birth date and the medical fields) is
  // ADMIN-only on the server (guardedEntityWrite, Student.update). A teacher
  // reaches this page too and still sees the record, read-only.
  const canEditStudent = canGuardedWrite(userProfile?.app_role, 'Student', 'update');

  // Same key as GestionEscuela's list (all classrooms, inactive included), so
  // creating a classroom there refreshes this select too.
  const { data: schoolClassrooms = [], isLoading: loadingClassrooms } = useQuery({
    queryKey: ['allClassrooms', userProfile?.school_id, 'all'],
    queryFn: () => schoolRead('Classroom', { school_id: userProfile.school_id }),
    enabled: !!userProfile?.school_id && canEditStudent,
  });

  const updateStudentMutation = useMutation({
    // The server records RECORD_UPDATED with the names of the changed fields
    // (never their values: these are a minor's medical data).
    mutationFn: (patch) => guardedUpdate('Student', studentId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student', studentId] });
      queryClient.invalidateQueries({ queryKey: ['classroom'] });
      invalidateSchoolStudents(queryClient);
      toast.success('Datos del alumno actualizados');
      setShowEditForm(false);
    },
    onError: (error) => {
      toast.error(`No se pudieron guardar los cambios. ${humanizeError(error)}`);
    },
  });

  const blockReadOnly = () => toast.error('Tu licencia está en modo solo lectura. Reactívala para hacer cambios.');

  const handleOpenEdit = () => {
    if (!guardWrite(canWrite, blockReadOnly)) return;
    setShowEditForm(true);
  };

  // The dialog has already validated the form, field by field.
  const handleSaveStudent = (form) => {
    if (!guardWrite(canWrite, blockReadOnly)) return;
    const patch = studentUpdatePatch(student, form);
    if (Object.keys(patch).length === 0) {
      toast.info('No hay cambios que guardar');
      setShowEditForm(false);
      return;
    }
    updateStudentMutation.mutate(patch);
  };

  const linkedParentIds = parentLinks.map(l => l.parent_id);
  const availableParents = parentProfiles.filter(p => !linkedParentIds.includes(p.user_id));

  const linkParentMutation = useMutation({
    mutationFn: async (data) => {
      const link = await guardedCreate('ParentStudent', data);
      // Best-effort: the link is already written (and the server audited it
      // as RECORD_CREATED) — a failed extra audit row must not report an
      // error that invites a duplicate retry.
      await recordAuditRow({
        schoolId: userProfile.school_id,
        action: 'PARENT_LINKED',
        entity: 'ParentStudent',
        entityId: link.id,
        context: { student_id: studentId, parent_id: data.parent_id },
      }).catch((e) => console.error('audit PARENT_LINKED failed', e));
      return link;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['studentParentLinks']);
      toast.success('Padre/madre vinculado correctamente');
      setShowLinkForm(false);
      setSelectedParentId('');
    },
    onError: (error) => {
      toast.error(`Error al vincular. ${humanizeError(error)}`);
    }
  });

  const unlinkParentMutation = useMutation({
    mutationFn: async (linkId) => {
      await guardedUpdate('ParentStudent', linkId, { status: 'REVOKED' });
      await recordAuditRow({
        schoolId: userProfile.school_id,
        action: 'PARENT_UNLINKED',
        entity: 'ParentStudent',
        entityId: linkId,
      }).catch((e) => console.error('audit PARENT_UNLINKED failed', e));
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['studentParentLinks']);
      toast.success('Vinculación removida');
    },
    onError: (error) => {
      toast.error(`No se pudo quitar la vinculación. ${humanizeError(error)}`);
    },
  });

  const handleLinkParent = () => {
    linkParentMutation.mutate({
      school_id: userProfile.school_id,
      parent_id: selectedParentId,
      student_id: studentId,
      relationship,
      status: 'ACTIVE',
      is_primary: parentLinks.filter(l => l.status === 'ACTIVE').length === 0,
    });
  };

  const relationshipLabels = {
    madre: 'Madre',
    padre: 'Padre',
    tutor: 'Tutor',
    abuelo: 'Abuelo',
    abuela: 'Abuela',
    otro: 'Otro',
  };

  if (isLoading) return <LoadingScreen message="Cargando..." />;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 pb-24">
      <PageHeader
        title="Gestión de alumno"
        showBack
        backTo={createPageUrl(userProfile?.app_role === 'ADMIN' ? 'GestionEscuela' : 'Home')}
      />

      {studentFailure && <LoadError failure={studentFailure} title="No se pudo cargar al alumno" />}

      {student && (
        <div className="space-y-6">
          {/* Student Info */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card text-card-foreground border border-border rounded-2xl shadow-sm p-5"
          >
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 shrink-0 rounded-2xl bg-brand/10 flex items-center justify-center">
                <User className="w-8 h-8 text-brand" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold text-card-foreground">
                  {student.first_name} {student.last_name}
                </h2>
                <Badge variant="secondary" className="mt-1">
                  {classroomLabel}
                </Badge>
                {parseLocalDate(student.birth_date) && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {format(parseLocalDate(student.birth_date), "d 'de' MMMM, yyyy", { locale: es })}
                  </p>
                )}
              </div>
              {canEditStudent && (
                <Button variant="outline" size="sm" onClick={handleOpenEdit} disabled={!canWrite || loadingClassrooms} className="gap-1 shrink-0">
                  <Pencil className="w-4 h-4" aria-hidden="true" /> Editar
                </Button>
              )}
            </div>

            {/* Datos médicos. Shown to whoever reaches this page: schoolRead
                only returns this student to the ADMIN and the student's own
                teachers and parents. */}
            <dl className="mt-4 pt-4 border-t border-border space-y-2 text-sm">
              <div className="flex items-start gap-2">
                <Heart className="w-4 h-4 mt-0.5 shrink-0 text-red-400" aria-hidden="true" />
                <dt className="text-muted-foreground">Tipo de sangre:</dt>
                <dd className="text-card-foreground">{student.blood_type || 'Sin registrar'}</dd>
              </div>
              <div className="flex items-start gap-2">
                <Shield className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <dt className="text-muted-foreground">Alergias:</dt>
                <dd className={student.allergies ? 'text-amber-700 dark:text-amber-300 whitespace-pre-line break-words min-w-0' : 'text-card-foreground'}>
                  {student.allergies || 'Ninguna registrada'}
                </dd>
              </div>
              <div className="flex items-start gap-2">
                <Stethoscope className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <dt className="text-muted-foreground">Notas médicas:</dt>
                <dd className="text-card-foreground whitespace-pre-line break-words min-w-0">{student.medical_notes || 'Sin notas'}</dd>
              </div>
            </dl>
          </motion.div>

          {/* Parent Links */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-card text-card-foreground border border-border rounded-2xl shadow-sm p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">Padres vinculados</h3>
              {canManageLinks && (
                <Button
                  onClick={() => setShowLinkForm(true)}
                  size="sm"
                  className="gap-1"
                >
                  <UserPlus className="w-4 h-4" /> Vincular
                </Button>
              )}
            </div>

            {linksFailure ? (
              <LoadError compact failure={linksFailure} title="No se pudieron cargar los padres vinculados" />
            ) : parentLinks.filter(l => l.status === 'ACTIVE').length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <Link className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>Sin padres vinculados</p>
              </div>
            ) : (
              <div className="space-y-3">
                {parentLinks.filter(l => l.status === 'ACTIVE').map((link) => (
                  <div
                    key={link.id}
                    className="flex items-center justify-between p-3 bg-muted rounded-xl"
                  >
                    <div>
                      <p className="font-medium text-foreground">{getUserName(link.parent_id)}</p>
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Mail className="w-3 h-3" />
                        {getUserEmail(link.parent_id)}
                      </p>
                      <Badge variant="outline" className="mt-1">
                        {relationshipLabels[link.relationship] || link.relationship}
                      </Badge>
                    </div>
                    {canManageLinks && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => unlinkParentMutation.mutate(link.id)}
                        disabled={unlinkParentMutation.isPending}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Unlink className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </div>
      )}

      {canEditStudent && student && (
        <StudentFormDialog
          open={showEditForm}
          onOpenChange={setShowEditForm}
          mode="edit"
          student={student}
          classrooms={schoolClassrooms}
          isPending={updateStudentMutation.isPending}
          onSubmit={handleSaveStudent}
        />
      )}

      {/* Link Parent Modal */}
      <Dialog open={canManageLinks && showLinkForm} onOpenChange={setShowLinkForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular padre/madre</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Seleccionar padre/madre *</Label>
              <Select
                value={selectedParentId}
                onValueChange={setSelectedParentId}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Seleccionar usuario" />
                </SelectTrigger>
                <SelectContent>
                  {availableParents.map((profile) => (
                    <SelectItem key={profile.user_id} value={profile.user_id}>
                      {getUserName(profile.user_id)} ({getUserEmail(profile.user_id)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {availableParents.length === 0 && (
                <p className="text-sm text-amber-600 mt-2">
                  No hay padres disponibles. Deben registrarse y ser aprobados primero.
                </p>
              )}
            </div>
            <div>
              <Label>Relación</Label>
              <Select
                value={relationship}
                onValueChange={setRelationship}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="madre">Madre</SelectItem>
                  <SelectItem value="padre">Padre</SelectItem>
                  <SelectItem value="tutor">Tutor</SelectItem>
                  <SelectItem value="abuelo">Abuelo</SelectItem>
                  <SelectItem value="abuela">Abuela</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => setShowLinkForm(false)} className="flex-1">
                Cancelar
              </Button>
              <Button
                onClick={handleLinkParent}
                disabled={!selectedParentId || linkParentMutation.isPending}
                className="flex-1"
              >
                {linkParentMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-1" /> Vincular
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}