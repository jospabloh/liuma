import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { schoolRead } from '@/lib/data/schoolRead';
import { invokeFunction } from '@/lib/functionResponse';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { createPageUrl } from '@/utils';
import { toast } from 'sonner';
import { AUDIT_ACTIONS, AUDIT_ENTITIES, buildPermissionChangeContext, logAuditEvent } from '@/lib/audit';
import {
  createPermissionOverride,
  deletePermissionOverride,
  listPermissionOverrides,
  updatePermissionOverride,
} from '@/lib/authorization/overrides';
import { getEffectivePolicyDecision } from '@/lib/authorization/policy';
import { hasOtherActiveAdminWithManagePermissions } from '@/lib/authorization/adminSafety';
import { validateRoleChangeRequest, validateRoleChangeDecision } from '@/lib/authorization/roleGovernance';
import {
  OVERRIDE_RESOURCES,
  POLICY_ACTIONS,
  actionLabel,
  changeStatusLabel,
  effectLabel,
  precedenceLabel,
  resourceLabel,
  roleLabel,
} from '@/lib/authorization/permissionLabels';
import { useSchoolMembers } from '@/lib/members/useSchoolMembers';
import { createSupportTicket } from '@/lib/support/tickets';
import { SUPPORT_CATEGORIES, SUPPORT_PRIORITIES } from '@/lib/support/constants';
import { guardedCreate } from '@/lib/authorization/guardedWrite';
import { humanizeError } from '@/lib/errorMessages';
import FieldError from '@/components/forms/FieldError';

const PENDING_CHANGE_ENTITY = 'PendingChange';
// The "plantillas de rol" grid and the tenant "Danger Zone" spec table that
// used to live on this page were removed (sales-readiness audit F20,
// 2026-09-29): the grid was local useState that was never saved or read
// anywhere, and the spec table showed customers internal developer notes
// ("Ver CLAUDE.md (Module 7)"). Everything left on this page is real and
// persisted. tenantDangerZone.js keeps the spec for whoever builds it.
const ROLLBACK_MODULES = OVERRIDE_RESOURCES;
const PENDING_CHANGE_STATUSES = {
  PENDING_ADMIN_APPROVAL: 'PENDING_ADMIN_APPROVAL',
  PENDING_SECOND_ADMIN_APPROVAL: 'PENDING_SECOND_ADMIN_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};

const REASON_REQUIRED = 'El motivo es obligatorio para cualquier cambio.';
// Shown in the section whose button was pressed: the "Motivo" box is shared by
// every section and sits away from most of them, so a message only under it
// was easy to miss (QA 2026-09-30) — this one says where to go.
const REASON_POINTER = 'Falta el motivo: escríbelo en «Motivo del cambio» y vuelve a intentarlo.';

function hasMutationReason(value) {
  return Boolean(value && value.trim().length > 0);
}

function requireExplicitConfirmation(message) {
  return window.confirm(message);
}

export default function PermisosRoles() {
  const { user, userProfile, isLoading: profileLoading } = useCurrentProfile();

  const [reasonText, setReasonText] = React.useState('');
  // Errors by section ('role' | 'rollback' | 'override' | 'deletion') plus
  // 'reason' for the shared Motivo box — each one rendered next to its own
  // controls instead of one line under Motivo for all of them.
  const [errors, setErrors] = React.useState({});
  const [deletingOverrideId, setDeletingOverrideId] = React.useState('');
  const reasonRef = React.useRef(null);
  const [selectedProfileId, setSelectedProfileId] = React.useState('');
  const [selectedRole, setSelectedRole] = React.useState('PARENT');
  const [isUpdatingRole, setIsUpdatingRole] = React.useState(false);
  const [overrideForm, setOverrideForm] = React.useState({ user_profile_id: '', resource: 'Notice', action: 'read', effect: 'deny' });
  const [editingOverrideId, setEditingOverrideId] = React.useState('');
  const [isSavingOverride, setIsSavingOverride] = React.useState(false);
  const [pendingDecisionByChangeId, setPendingDecisionByChangeId] = React.useState({});
  const [rollbackModule, setRollbackModule] = React.useState('Notice');
  const [rollbackOverrideId, setRollbackOverrideId] = React.useState('');
  const [isApplyingRollback, setIsApplyingRollback] = React.useState(false);
  const [isExporting, setIsExporting] = React.useState(false);
  const [isRequestingDeletion, setIsRequestingDeletion] = React.useState(false);
  const [deletionReason, setDeletionReason] = React.useState('');

  const { data: schoolProfiles = [], refetch: refetchSchoolProfiles } = useQuery({
    queryKey: ['schoolUserProfiles', userProfile?.school_id],
    queryFn: () => schoolRead('UserProfile', { school_id: userProfile.school_id }),
    enabled: !!userProfile?.school_id,
  });

  // Names come from the server-side member directory: UserProfile has no
  // name, and a client User.list() only returns the caller's own row.
  const { getName: getUserName } = useSchoolMembers(userProfile?.school_id);
  const { data: permissionOverrides = [], refetch: refetchOverrides } = useQuery({
    queryKey: ['permissionOverrides', userProfile?.school_id],
    queryFn: () => listPermissionOverrides({ schoolId: userProfile.school_id }),
    enabled: !!userProfile?.school_id,
  });
  const { data: pendingRoleChanges = [], refetch: refetchPendingRoleChanges } = useQuery({
    queryKey: ['pendingRoleChanges', userProfile?.school_id],
    queryFn: () => schoolRead(PENDING_CHANGE_ENTITY, { school_id: userProfile.school_id, type: 'ROLE_CHANGE' }),
    enabled: !!userProfile?.school_id,
  });

  const selectedProfile = schoolProfiles.find((profile) => profile.id === selectedProfileId) || null;
  const isAdminRoleChange = selectedProfile && (selectedProfile.app_role === 'ADMIN' || selectedRole === 'ADMIN');
  const overrideTargetProfile = schoolProfiles.find((profile) => profile.id === overrideForm.user_profile_id) || null;
  const isOverrideTargetAdmin = overrideTargetProfile?.app_role === 'ADMIN';
  const isSelfRoleChange = selectedProfile?.id === userProfile?.id;
  const isSelfAdminDemotion = isSelfRoleChange && selectedProfile?.app_role === 'ADMIN' && selectedRole !== 'ADMIN';
  const isLastManagePermissionsAdminAtRisk = selectedProfile?.app_role === 'ADMIN' && selectedRole !== 'ADMIN' && !hasOtherActiveAdminWithManagePermissions({
    profiles: schoolProfiles,
    actorProfileId: userProfile?.id,
    targetProfileId: selectedProfile?.id,
  });
  const rollbackCandidates = permissionOverrides.filter((entry) => entry.resource === rollbackModule);
  const rollbackOverride = rollbackCandidates.find((entry) => entry.id === rollbackOverrideId) || null;

  if (profileLoading) {
    return <LoadingScreen message="Validando permisos..." />;
  }

  if (userProfile?.app_role !== 'ADMIN') {
    return (
      <div className="min-h-screen bg-background">
        <PageHeader title="Permisos y Roles" subtitle="Acceso restringido" showBack backTo={createPageUrl('Home')} />
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 pb-24">
          <Card className="p-4">
            <p className="text-card-foreground">Esta página está disponible solo para administradores.</p>
          </Card>
        </div>
      </div>
    );
  }

  const overrideOwnerName = (override) => {
    const profile = schoolProfiles.find((entry) => entry.id === override.user_profile_id);
    return profile ? getUserName(profile.user_id) : 'esta persona';
  };

  const describeOverride = (override) =>
    `${overrideOwnerName(override)}: ${effectLabel(override.effect).toLowerCase()} ${actionLabel(override.action).toLowerCase()}`;

  const showError = (section, message) => setErrors({ [section]: message });
  const clearErrors = () => setErrors({});
  /** False (and both messages shown, Motivo focused) when the reason is missing. */
  const requireReason = (section) => {
    if (hasMutationReason(reasonText)) return true;
    setErrors({ reason: REASON_REQUIRED, [section]: REASON_POINTER });
    reasonRef.current?.focus();
    return false;
  };

  const handleRoleChange = async () => {
    if (!selectedProfile) {
      showError('role', 'Selecciona un usuario para cambiar el rol.');
      return;
    }
    if (!requireReason('role')) return;
    if (selectedProfile.app_role === selectedRole) {
      showError('role', 'Selecciona un rol distinto al actual.');
      return;
    }
    if (isSelfAdminDemotion) {
      showError('role', 'No puedes quitarte a ti mismo el rol de directivo.');
      return;
    }
    if (isLastManagePermissionsAdminAtRisk) {
      showError('role', 'Debe haber otro directivo activo antes de quitar este rol: la escuela no puede quedarse sin directivos.');
      return;
    }

    const pendingOpenRequest = pendingRoleChanges.find((change) =>
      change.target_profile_id === selectedProfile.id &&
      [PENDING_CHANGE_STATUSES.PENDING_ADMIN_APPROVAL, PENDING_CHANGE_STATUSES.PENDING_SECOND_ADMIN_APPROVAL].includes(change.status),
    );
    if (pendingOpenRequest) {
      showError('role', 'Ya existe una solicitud pendiente para este usuario.');
      return;
    }
    // Shared maker-checker rules (mirrored server-side in governRoleChange).
    const requestValidation = validateRoleChangeRequest({
      requesterProfile: userProfile,
      targetProfile: selectedProfile,
      toRole: selectedRole,
      profiles: schoolProfiles,
    });
    if (!requestValidation.ok) {
      showError('role', requestValidation.message);
      return;
    }
    if (isAdminRoleChange && !requireExplicitConfirmation('Este cambio da o quita el rol de directivo y requiere la aprobación de un segundo directivo. ¿Deseas continuar?')) {
      return;
    }
    clearErrors();
    setIsUpdatingRole(true);
    try {
      // Role mutations go exclusively through the server-authoritative function;
      // it re-validates and creates the PendingChange with the service role, so
      // the maker-checker cannot be bypassed from the client (findings C1/C2).
      await invokeFunction(base44, 'governRoleChange', {
        action: 'request',
        targetProfileId: selectedProfile.id,
        toRole: selectedRole,
        reason: reasonText.trim(),
      });
      await logAuditEvent({
        user,
        userProfile,
        entity: AUDIT_ENTITIES.USER_PROFILE,
        entityId: selectedProfile.id,
        action: 'ROLE_CHANGE_REQUESTED',
        reason: reasonText.trim(),
        context: {
          from_role: selectedProfile.app_role,
          to_role: selectedRole,
          risk_level: isAdminRoleChange ? 'HIGH' : 'NORMAL',
        },
      });
      await logAuditEvent({
        user,
        userProfile,
        entity: AUDIT_ENTITIES.PERMISSION_CHANGE,
        entityId: selectedProfile.id,
        action: AUDIT_ACTIONS.PERMISSION_CHANGE,
        reason: reasonText.trim(),
        context: buildPermissionChangeContext({
          changeType: 'ROLE_CHANGE',
          before: { app_role: selectedProfile.app_role },
          after: { app_role: selectedRole },
          actorProfileId: userProfile.id,
          reason: reasonText.trim(),
          snapshot: { applied_at: new Date().toISOString() },
        }),
      });
      await refetchPendingRoleChanges();
      await refetchSchoolProfiles();
      toast.success('Solicitud de cambio enviada');
      setReasonText('');
    } catch (error) {
      toast.error(error?.data?.error || 'No se pudo enviar la solicitud de cambio');
    } finally {
      setIsUpdatingRole(false);
    }
  };
  const handlePendingRoleChangeDecision = async (change, decision) => {
    const targetProfile = schoolProfiles.find((profile) => profile.id === change.target_profile_id);
    // Shared maker-checker rules (mirrored server-side in governRoleChange):
    // closes C2 by rejecting a decision where the approver is the requester.
    const decisionValidation = validateRoleChangeDecision({
      change,
      approverProfile: userProfile,
      targetProfile,
      profiles: schoolProfiles,
      decision,
    });
    if (!decisionValidation.ok) {
      toast.error(decisionValidation.message);
      return;
    }
    if (decision === 'approve' && !requireExplicitConfirmation('Confirmación: aprobar este cambio aplicará el nuevo rol inmediatamente. ¿Continuar?')) {
      return;
    }
    setPendingDecisionByChangeId((prev) => ({ ...prev, [change.id]: true }));
    try {
      // The server function re-checks approver != requester and applies the role
      // with the service role; the client never writes the approval directly.
      await invokeFunction(base44, 'governRoleChange', {
        action: 'decide',
        changeId: change.id,
        decision,
      });
      const resolvedStatus = decision === 'approve'
        ? PENDING_CHANGE_STATUSES.APPROVED
        : PENDING_CHANGE_STATUSES.REJECTED;
      await logAuditEvent({
        user,
        userProfile,
        entity: AUDIT_ENTITIES.PERMISSION_CHANGE,
        entityId: change.target_profile_id,
        action: AUDIT_ACTIONS.PERMISSION_CHANGE,
        reason: `ROLE_CHANGE_${decision.toUpperCase()}`,
        context: buildPermissionChangeContext({
          changeType: 'ROLE_CHANGE_REVIEW',
          before: { app_role: change.payload?.from_role, status: change.status },
          after: { app_role: change.payload?.to_role, status: resolvedStatus },
          actorProfileId: change.requester_profile_id,
          reviewerProfileId: userProfile.id,
          reason: `ROLE_CHANGE_${decision.toUpperCase()}`,
          snapshot: { applied_at: new Date().toISOString() },
        }),
      });
      await refetchPendingRoleChanges();
      await refetchSchoolProfiles();
      toast.success(decision === 'approve' ? 'Cambio aprobado' : 'Cambio rechazado');
    } catch (error) {
      toast.error(error?.data?.error || 'No se pudo resolver la solicitud');
    } finally {
      setPendingDecisionByChangeId((prev) => ({ ...prev, [change.id]: false }));
    }
  };
  const handleSaveOverride = async () => {
    if (!requireReason('override')) return;
    if (!overrideTargetProfile) {
      showError('override', 'Selecciona a la persona para la excepción.');
      return;
    }
    if (isOverrideTargetAdmin) {
      showError('override', 'Los directivos ya tienen todos los permisos; no se les pueden poner excepciones.');
      return;
    }
    if (overrideForm.action === 'manage_permissions' && overrideForm.user_profile_id === userProfile?.id) {
      showError('override', 'No puedes cambiar tus propios permisos de administración.');
      return;
    }
    clearErrors();
    setIsSavingOverride(true);
    const payload = {
      ...overrideForm,
      school_id: userProfile.school_id,
      reason: reasonText.trim(),
      actor_profile_id: userProfile.id,
    };
    try {
      if (editingOverrideId) {
        const current = permissionOverrides.find((entry) => entry.id === editingOverrideId);
        await updatePermissionOverride(editingOverrideId, payload);
        await logAuditEvent({
          user,
          userProfile,
          entity: AUDIT_ENTITIES.PERMISSION_CHANGE,
          entityId: editingOverrideId,
          action: AUDIT_ACTIONS.PERMISSION_CHANGE,
          reason: payload.reason,
          context: buildPermissionChangeContext({
            changeType: 'PERMISSION_OVERRIDE_UPDATE',
            before: current || null,
            after: payload,
            actorProfileId: userProfile.id,
            reason: payload.reason,
            snapshot: { applied_at: new Date().toISOString() },
          }),
        });
      } else {
        const created = await createPermissionOverride(payload);
        await logAuditEvent({
          user,
          userProfile,
          entity: AUDIT_ENTITIES.PERMISSION_CHANGE,
          entityId: created?.id || payload.user_profile_id,
          action: AUDIT_ACTIONS.PERMISSION_CHANGE,
          reason: payload.reason,
          context: buildPermissionChangeContext({
            changeType: 'PERMISSION_OVERRIDE_CREATE',
            before: null,
            after: payload,
            actorProfileId: userProfile.id,
            reason: payload.reason,
            snapshot: { applied_at: new Date().toISOString() },
          }),
        });
      }
      await refetchOverrides();
      setReasonText('');
      setEditingOverrideId('');
      toast.success('Excepción guardada');
    } catch (error) {
      toast.error(`No se pudo guardar la excepción. ${humanizeError(error)}`);
    } finally {
      setIsSavingOverride(false);
    }
  };

  const handleEditOverride = (override) => {
    setEditingOverrideId(override.id);
    setOverrideForm({
      user_profile_id: override.user_profile_id,
      resource: override.resource,
      action: override.action,
      effect: override.effect,
    });
  };

  // Before 2026-09-30 this had no try/catch (unlike handleSaveOverride): a
  // failed delete showed nothing, rejected unhandled, and left the page as if
  // nothing had been pressed.
  const handleDeleteOverride = async (overrideId) => {
    if (!requireReason('override')) return;
    if (!requireExplicitConfirmation('Vas a eliminar esta excepción; la persona volverá a los permisos de su rol. ¿Deseas continuar?')) {
      return;
    }
    clearErrors();
    setDeletingOverrideId(overrideId);
    const current = permissionOverrides.find((entry) => entry.id === overrideId);
    const reason = reasonText.trim();
    try {
      await deletePermissionOverride(overrideId);
    } catch (error) {
      // The exception is still there: keep the reason so a retry is one click.
      const message = `No se pudo eliminar la excepción. ${humanizeError(error)}`;
      showError('override', message);
      toast.error(message);
      setDeletingOverrideId('');
      return;
    }
    // The delete happened (and guardedEntityWrite audited it as
    // RECORD_DELETED). This extra PERMISSION_CHANGE row carries the reason; if
    // it fails, the change must not be reported as failed — that would invite
    // deleting something that is already gone.
    await logAuditEvent({
      user,
      userProfile,
      entity: AUDIT_ENTITIES.PERMISSION_CHANGE,
      entityId: overrideId,
      action: AUDIT_ACTIONS.PERMISSION_CHANGE,
      reason,
      context: buildPermissionChangeContext({
        changeType: 'PERMISSION_OVERRIDE_DELETE',
        before: current || null,
        after: null,
        actorProfileId: userProfile.id,
        reason,
        snapshot: { applied_at: new Date().toISOString() },
      }),
    }).catch((e) => console.error('audit PERMISSION_OVERRIDE_DELETE failed', e));
    if (editingOverrideId === overrideId) setEditingOverrideId('');
    setReasonText('');
    setDeletingOverrideId('');
    toast.success('Excepción eliminada');
    await refetchOverrides().catch(() => {});
  };

  const handleApplyRollback = async () => {
    if (!requireReason('rollback')) return;
    if (!rollbackOverride) {
      showError('rollback', 'Selecciona la excepción que quieres revertir.');
      return;
    }
    if (!requireExplicitConfirmation('Vas a revertir esta excepción de permisos. ¿Deseas continuar?')) {
      return;
    }
    clearErrors();
    setIsApplyingRollback(true);
    const isHighRiskRollback = rollbackOverride.action === 'manage_permissions';
    try {
      if (isHighRiskRollback) {
        // type, status and requester are stamped by guardedEntityWrite (P10b).
        await guardedCreate(PENDING_CHANGE_ENTITY, {
          school_id: userProfile.school_id,
          target_profile_id: rollbackOverride.user_profile_id,
          payload: { override_id: rollbackOverride.id, module: rollbackOverride.resource, action: rollbackOverride.action, effect: rollbackOverride.effect, risk_level: 'HIGH' },
        });
      } else {
        await deletePermissionOverride(rollbackOverride.id);
      }
      await logAuditEvent({
        user,
        userProfile,
        entity: AUDIT_ENTITIES.PERMISSION_CHANGE,
        entityId: rollbackOverride.id,
        action: AUDIT_ACTIONS.PERMISSION_CHANGE,
        reason: reasonText.trim(),
        context: buildPermissionChangeContext({
          changeType: isHighRiskRollback ? 'PERMISSION_ROLLBACK_REQUESTED' : 'PERMISSION_ROLLBACK_APPLIED',
          before: rollbackOverride,
          after: null,
          actorProfileId: userProfile.id,
          reason: reasonText.trim(),
          snapshot: { applied_at: new Date().toISOString(), target_profile_id: rollbackOverride.user_profile_id },
        }),
      });
      await refetchOverrides();
      await refetchPendingRoleChanges();
      setRollbackOverrideId('');
      setReasonText('');
      toast.success(isHighRiskRollback ? 'Solicitud enviada: otro directivo debe aprobarla' : 'Excepción revertida');
    } catch {
      toast.error('No se pudo revertir la excepción');
    } finally {
      setIsApplyingRollback(false);
    }
  };

  // Data export: client-side download of everything base44/functions/exportSchoolData
  // returns for this admin's own school (never a client-supplied id). Purely
  // read-only -- no confirmation dialog needed.
  const handleExportSchoolData = async () => {
    setIsExporting(true);
    try {
      // invokeFunction unwraps the axios response to the export body.
      // Export has to work in read-only mode — it is the half of "solo
      // lectura" that promises nothing is held hostage.
      const payload = await invokeFunction(base44, 'exportSchoolData', {});
      if (!payload?.ok) throw new Error(payload?.error || 'export failed');
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `liuma-${userProfile.school_id}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success('Descarga iniciada');
    } catch {
      toast.error('No se pudo generar la exportación');
    } finally {
      setIsExporting(false);
    }
  };

  // "Solicitar eliminación de la escuela" -- NOT a direct delete. School.delete's
  // RLS requires role:admin (the ACACIA platform owner); a school's own ADMIN
  // cannot delete their own school via RLS at all, by design. So this creates a
  // SupportTicket (routed to the platform owner regardless of category, since
  // resolveSupportRouting always sends an ADMIN's own tickets there) instead of
  // an instant, irreversible self-service action -- same principle as every
  // other tenant-wide deletion in this portfolio going through a human.
  const handleRequestSchoolDeletion = async () => {
    if (!deletionReason.trim()) {
      showError('deletion', 'Describe el motivo de la solicitud.');
      return;
    }
    clearErrors();
    if (!requireExplicitConfirmation('Vas a solicitar la eliminación de tu escuela. Esta acción es irreversible una vez procesada. ¿Deseas continuar?')) {
      return;
    }
    setIsRequestingDeletion(true);
    try {
      await createSupportTicket({
        user,
        userProfile,
        subject: 'Solicitud de eliminación de la escuela',
        description: deletionReason.trim(),
        category: SUPPORT_CATEGORIES.ACCOUNT,
        priority: SUPPORT_PRIORITIES.HIGH,
      });
      setDeletionReason('');
      toast.success('Solicitud enviada. El equipo de ACACIA se pondrá en contacto contigo.');
    } catch {
      toast.error('No se pudo enviar la solicitud');
    } finally {
      setIsRequestingDeletion(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Permisos y Roles" subtitle="Configuración de acceso" showBack backTo={createPageUrl('Home')} />
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 pb-24">
      <Card className="p-4 space-y-4">
        <p className="text-card-foreground">
          Cambia el rol de las personas de tu escuela y da o quita permisos puntuales. Todo cambio pide un motivo y queda registrado.
        </p>

        <div className="space-y-3 border border-border rounded-2xl bg-card p-3">
          <p className="font-medium text-card-foreground">Cambio de rol de usuario</p>
          <p className="text-xs text-muted-foreground">Los cambios que dan o quitan el rol de directivo necesitan la aprobación de un segundo directivo.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <select
              className="ui-field"
              value={selectedProfileId}
              onChange={(event) => setSelectedProfileId(event.target.value)}
            >
              <option value="">Selecciona un usuario</option>
              {schoolProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {getUserName(profile.user_id)} ({roleLabel(profile.app_role)})
                </option>
              ))}
            </select>

            <select
              className="ui-field"
              value={selectedRole}
              onChange={(event) => setSelectedRole(event.target.value)}
            >
              <option value="PARENT">{roleLabel('PARENT')}</option>
              <option value="TEACHER">{roleLabel('TEACHER')}</option>
              <option value="ADMIN">{roleLabel('ADMIN')}</option>
            </select>
          </div>
          {isAdminRoleChange ? <p className="text-sm text-red-700 dark:text-red-400">Este cambio da o quita el rol de directivo: requiere la aprobación de un segundo directivo.</p> : null}
          {isSelfAdminDemotion ? <p className="text-sm text-red-700 dark:text-red-400">No puedes quitarte a ti mismo el rol de directivo.</p> : null}
          {isLastManagePermissionsAdminAtRisk ? <p className="text-sm text-red-700 dark:text-red-400">Debe haber otro directivo activo antes de quitar este rol.</p> : null}
          <FieldError id="role-error" message={errors.role} />
          <Button variant={isAdminRoleChange ? 'destructive' : 'default'} onClick={handleRoleChange} disabled={isUpdatingRole}>
            {isUpdatingRole ? 'Guardando...' : isAdminRoleChange ? 'Solicitar cambio de rol de directivo' : 'Solicitar cambio de rol'}
          </Button>
        </div>
        <div className="space-y-3 border border-border rounded-2xl bg-card p-3">
          <p className="font-medium text-card-foreground">Revertir una excepción</p>
          <div className="grid gap-3 md:grid-cols-2">
            <select className="ui-field" value={rollbackModule} onChange={(event) => { setRollbackModule(event.target.value); setRollbackOverrideId(''); }}>
              {ROLLBACK_MODULES.map((module) => <option key={module} value={module}>{resourceLabel(module)}</option>)}
            </select>
            <select className="ui-field" value={rollbackOverrideId} onChange={(event) => setRollbackOverrideId(event.target.value)}>
              <option value="">Selecciona la excepción</option>
              {rollbackCandidates.map((entry) => <option key={entry.id} value={entry.id}>{describeOverride(entry)}</option>)}
            </select>
          </div>
          {rollbackOverride ? (
            <p className="rounded-xl bg-muted p-2 text-sm text-muted-foreground">
              Al revertirla, {overrideOwnerName(rollbackOverride)} volverá a los permisos de su rol para {resourceLabel(rollbackOverride.resource).toLowerCase()}.
            </p>
          ) : null}
          {rollbackOverride?.action === 'manage_permissions' ? <p className="text-sm text-red-700 dark:text-red-400">Requiere la aprobación de un segundo directivo.</p> : null}
          <FieldError id="rollback-error" message={errors.rollback} />
          <Button variant={rollbackOverride?.action === 'manage_permissions' ? 'destructive' : 'outline'} onClick={handleApplyRollback} disabled={isApplyingRollback}>
            {isApplyingRollback ? 'Aplicando...' : rollbackOverride?.action === 'manage_permissions' ? 'Solicitar reversión' : 'Revertir excepción'}
          </Button>
        </div>
        <div className="space-y-3 border border-border rounded-2xl bg-card p-3">
          <p className="font-medium text-card-foreground">Solicitudes pendientes de cambio de rol</p>
          <div className="overflow-auto border border-border rounded-2xl">
            <table className="ui-table min-w-full">
              <thead><tr className="bg-muted"><th className="sticky top-0 bg-muted p-2 text-left">Usuario objetivo</th><th className="sticky top-0 bg-muted p-2 text-left">Desde</th><th className="sticky top-0 bg-muted p-2 text-left">Hacia</th><th className="sticky top-0 bg-muted p-2 text-left">Estado</th><th className="sticky top-0 bg-muted p-2 text-left">Acciones</th></tr></thead>
              <tbody>
                {pendingRoleChanges.map((change) => {
                  const targetProfile = schoolProfiles.find((profile) => profile.id === change.target_profile_id);
                  const disabledByRequesterRule = change.requester_profile_id === userProfile.id;
                  return (
                    <tr key={change.id}>
                      <td className="p-2">{targetProfile ? `${getUserName(targetProfile.user_id)} (${roleLabel(targetProfile.app_role)})` : 'Usuario no encontrado'}</td>
                      <td className="p-2">{roleLabel(change.payload?.from_role)}</td>
                      <td className="p-2">{roleLabel(change.payload?.to_role)}</td>
                      <td className="p-2">{changeStatusLabel(change.status)}</td>
                      <td className="p-2 space-x-2">
                        <Button variant="outline" disabled={disabledByRequesterRule || pendingDecisionByChangeId[change.id]} onClick={() => handlePendingRoleChangeDecision(change, 'reject')}>Rechazar</Button>
                        <Button disabled={disabledByRequesterRule || pendingDecisionByChangeId[change.id]} onClick={() => handlePendingRoleChangeDecision(change, 'approve')}>Aprobar</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="permission-reason" className="text-sm font-medium">Motivo del cambio (obligatorio)</label>
          <Textarea
            id="permission-reason"
            ref={reasonRef}
            value={reasonText}
            onChange={(event) => {
              setReasonText(event.target.value);
              if (errors.reason) clearErrors();
            }}
            placeholder="Describe el motivo"
            aria-invalid={Boolean(errors.reason)}
            aria-describedby={errors.reason ? 'permission-reason-error' : undefined}
            className={errors.reason ? 'border-red-500 dark:border-red-400' : undefined}
          />
          <FieldError id="permission-reason-error" message={errors.reason} />
        </div>

        <div className="space-y-3 border border-border rounded-2xl bg-card p-3">
          <p className="font-medium text-card-foreground">Cuenta y zona de peligro</p>
          <p className="text-sm text-muted-foreground">Descarga los datos de tu escuela, o solicita su eliminación.</p>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={handleExportSchoolData} disabled={isExporting}>
              {isExporting ? 'Generando...' : 'Descargar datos de la escuela'}
            </Button>
          </div>
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">Solicitar eliminación de la escuela</p>
            <p className="text-xs text-muted-foreground">
              No es instantáneo: se envía como solicitud al equipo de ACACIA, quien la procesará manualmente.
              Descarga tus datos primero — la eliminación no tiene marcha atrás.
            </p>
            <Textarea
              value={deletionReason}
              onChange={(event) => {
                setDeletionReason(event.target.value);
                if (errors.deletion) clearErrors();
              }}
              placeholder="Motivo de la solicitud (obligatorio)"
              aria-label="Motivo de la solicitud de eliminación"
              aria-invalid={Boolean(errors.deletion)}
              aria-describedby={errors.deletion ? 'deletion-error' : undefined}
              className={errors.deletion ? 'border-red-500 dark:border-red-400' : undefined}
            />
            <FieldError id="deletion-error" message={errors.deletion} />
            <Button variant="destructive" onClick={handleRequestSchoolDeletion} disabled={isRequestingDeletion}>
              {isRequestingDeletion ? 'Enviando...' : 'Solicitar eliminación de la escuela'}
            </Button>
          </div>
        </div>

        <div className="space-y-3 border border-border rounded-2xl bg-card p-3">
          <p className="font-medium text-card-foreground">Excepciones por persona</p>
          <p className="text-xs text-muted-foreground">Da o quita un permiso a una persona concreta, por encima de lo que permite su rol.</p>
          <div className="grid gap-3 md:grid-cols-4">
            <select className="ui-field" value={overrideForm.user_profile_id} onChange={(event) => setOverrideForm((prev) => ({ ...prev, user_profile_id: event.target.value }))}>
              <option value="">Selecciona a la persona</option>
              {schoolProfiles.map((profile) => <option key={profile.id} value={profile.id}>{getUserName(profile.user_id)} ({roleLabel(profile.app_role)})</option>)}
            </select>
            <select className="ui-field" value={overrideForm.resource} onChange={(event) => setOverrideForm((prev) => ({ ...prev, resource: event.target.value }))}>
              {OVERRIDE_RESOURCES.map((resource) => <option key={resource} value={resource}>{resourceLabel(resource)}</option>)}
            </select>
            <select className="ui-field" value={overrideForm.action} onChange={(event) => setOverrideForm((prev) => ({ ...prev, action: event.target.value }))}>
              {POLICY_ACTIONS.map((action) => <option key={action} value={action}>{actionLabel(action)}</option>)}
            </select>
            <select className="ui-field" value={overrideForm.effect} onChange={(event) => setOverrideForm((prev) => ({ ...prev, effect: event.target.value }))}>
              <option value="deny">{effectLabel('deny')}</option>
              <option value="allow">{effectLabel('allow')}</option>
            </select>
          </div>
          {isOverrideTargetAdmin ? <p className="text-sm text-red-700 dark:text-red-400">Los directivos ya tienen todos los permisos; no se les pueden poner excepciones.</p> : null}
          {overrideForm.action === 'manage_permissions' && overrideForm.user_profile_id === userProfile?.id ? <p className="text-sm text-red-700 dark:text-red-400">No puedes cambiar tus propios permisos de administración.</p> : null}
          <FieldError id="override-error" message={errors.override} />
          <Button onClick={handleSaveOverride} disabled={isSavingOverride || isOverrideTargetAdmin}>{editingOverrideId ? 'Actualizar excepción' : 'Crear excepción'}</Button>
          <div className="overflow-auto border border-border rounded-2xl">
            <table className="ui-table min-w-full">
              <thead><tr className="bg-muted"><th className="sticky top-0 bg-muted p-2 text-left">Persona</th><th className="sticky top-0 bg-muted p-2 text-left">Sección</th><th className="sticky top-0 bg-muted p-2 text-left">Permiso</th><th className="sticky top-0 bg-muted p-2 text-left">Excepción</th><th className="sticky top-0 bg-muted p-2 text-left">Resultado</th><th className="sticky top-0 bg-muted p-2 text-left">Acciones</th></tr></thead>
              <tbody>
                {permissionOverrides.map((override) => {
                  const profile = schoolProfiles.find((entry) => entry.id === override.user_profile_id);
                  const preview = getEffectivePolicyDecision({ role: profile?.app_role, entity: override.resource, action: override.action, userProfileId: override.user_profile_id, overrides: permissionOverrides });
                  return (
                    <tr key={override.id}>
                      <td className="p-2">{profile ? `${getUserName(profile.user_id)} (${roleLabel(profile.app_role)})` : 'Usuario no encontrado'}</td>
                      <td className="p-2">{resourceLabel(override.resource)}</td><td className="p-2">{actionLabel(override.action)}</td><td className="p-2">{effectLabel(override.effect)}</td>
                      <td className="p-2">{preview.allowed ? 'Permitido' : 'Denegado'} ({precedenceLabel(preview.precedence)})</td>
                      <td className="p-2 space-x-2"><Button variant="outline" onClick={() => handleEditOverride(override)}>Editar</Button><Button variant="destructive" onClick={() => handleDeleteOverride(override.id)} disabled={Boolean(deletingOverrideId)}>{deletingOverrideId === override.id ? 'Eliminando...' : 'Eliminar'}</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

      </Card>
      </div>
    </div>
  );
}
