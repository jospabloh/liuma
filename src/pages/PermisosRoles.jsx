import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { DANGER_ZONE_OPERATIONS, getRollbackPolicy } from '@/lib/authorization/tenantDangerZone';

const RESOURCES = [
  'Students',
  'Classrooms',
  'Attendance',
  'Homework',
  'Diary',
  'Notices',
  'Payments',
  'Documents',
  'Reports',
  'AI',
  'Audit',
  'Tenant Danger Zone',
];

const ACTIONS = ['view', 'add', 'edit', 'delete', 'approve', 'export', 'manage_permissions'];
const POLICY_ACTIONS = ['read', 'write'];
const PENDING_CHANGE_ENTITY = 'PendingChange';
const ROLLBACK_MODULES = ['Notice', 'Attendance', 'Homework', 'DiaryEntry', 'ChargeItem', 'PaymentConcept', 'PaymentRecord'];
const PENDING_CHANGE_STATUSES = {
  PENDING_ADMIN_APPROVAL: 'PENDING_ADMIN_APPROVAL',
  PENDING_SECOND_ADMIN_APPROVAL: 'PENDING_SECOND_ADMIN_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};

const DEFAULT_TEMPLATE = {
  name: 'Plantilla Admin',
  permissions: RESOURCES.reduce((acc, resource) => {
    acc[resource] = ACTIONS.reduce((actions, action) => {
      actions[action] = true;
      return actions;
    }, {});
    return acc;
  }, {}),
};

function hasMutationReason(value) {
  return Boolean(value && value.trim().length > 0);
}

export default function PermisosRoles() {
  const { data: user, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: userProfile, isLoading: profileLoading } = useQuery({
    queryKey: ['userProfile', user?.id],
    queryFn: async () => (await base44.entities.UserProfile.filter({ user_id: user.id }))[0],
    enabled: !!user,
  });

  const [templates, setTemplates] = React.useState([DEFAULT_TEMPLATE]);
  const [newTemplateName, setNewTemplateName] = React.useState('');
  const [activeTemplateIndex, setActiveTemplateIndex] = React.useState(0);
  const [editTemplateName, setEditTemplateName] = React.useState('');
  const [reasonText, setReasonText] = React.useState('');
  const [errorText, setErrorText] = React.useState('');
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

  const { data: schoolProfiles = [], refetch: refetchSchoolProfiles } = useQuery({
    queryKey: ['schoolUserProfiles', userProfile?.school_id],
    queryFn: () => base44.entities.UserProfile.filter({ school_id: userProfile.school_id }),
    enabled: !!userProfile?.school_id,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['allUsersForRoleChange'],
    queryFn: () => base44.entities.User.list(),
    enabled: !!schoolProfiles.length,
  });
  const { data: permissionOverrides = [], refetch: refetchOverrides } = useQuery({
    queryKey: ['permissionOverrides', userProfile?.school_id],
    queryFn: () => listPermissionOverrides({ schoolId: userProfile.school_id }),
    enabled: !!userProfile?.school_id,
  });
  const { data: pendingRoleChanges = [], refetch: refetchPendingRoleChanges } = useQuery({
    queryKey: ['pendingRoleChanges', userProfile?.school_id],
    queryFn: () => base44.entities[PENDING_CHANGE_ENTITY].filter({ school_id: userProfile.school_id, type: 'ROLE_CHANGE' }),
    enabled: !!userProfile?.school_id,
  });

  const activeTemplate = templates[activeTemplateIndex] || null;
  const selectedProfile = schoolProfiles.find((profile) => profile.id === selectedProfileId) || null;
  const isAdminRoleChange = selectedProfile && (selectedProfile.app_role === 'ADMIN' || selectedRole === 'ADMIN');
  const overrideTargetProfile = schoolProfiles.find((profile) => profile.id === overrideForm.user_profile_id) || null;
  const isOverrideTargetAdmin = overrideTargetProfile?.app_role === 'ADMIN';
  const isAppOwner = selectedProfile?.user_id === userProfile?.user_id;
  const isSelfRoleChange = selectedProfile?.id === userProfile?.id;
  const isSelfAdminDemotion = isSelfRoleChange && selectedProfile?.app_role === 'ADMIN' && selectedRole !== 'ADMIN';
  const isLastManagePermissionsAdminAtRisk = selectedProfile?.app_role === 'ADMIN' && selectedRole !== 'ADMIN' && !hasOtherActiveAdminWithManagePermissions({
    profiles: schoolProfiles,
    actorProfileId: userProfile?.id,
    targetProfileId: selectedProfile?.id,
  });
  const rollbackCandidates = permissionOverrides.filter((entry) => entry.resource === rollbackModule);
  const rollbackOverride = rollbackCandidates.find((entry) => entry.id === rollbackOverrideId) || null;

  const dangerZoneOperations = [
    { key: DANGER_ZONE_OPERATIONS.DELETE_TENANT, label: 'delete tenant' },
    { key: DANGER_ZONE_OPERATIONS.SUSPEND_TENANT, label: 'suspend tenant' },
    { key: DANGER_ZONE_OPERATIONS.RESET_TENANT_DATA, label: 'reset tenant data' },
    { key: DANGER_ZONE_OPERATIONS.TRANSFER_TENANT_OWNERSHIP, label: 'transfer tenant ownership' },
  ];

  if (userLoading || profileLoading) {
    return <LoadingScreen message="Validando permisos..." />;
  }

  if (userProfile?.app_role !== 'ADMIN') {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <PageHeader title="Permisos y Roles" subtitle="Acceso restringido" showBack backTo={createPageUrl('Home')} />
        <Card className="p-4 mt-4">
          <p className="text-slate-700">Esta página está disponible solo para administradores.</p>
        </Card>
      </div>
    );
  }

  const requireReason = (callback) => {
    if (!hasMutationReason(reasonText)) {
      setErrorText('El motivo es obligatorio para cualquier cambio.');
      return;
    }
    setErrorText('');
    callback();
    setReasonText('');
  };

  const handleAddTemplate = () => {
    requireReason(() => {
      const name = newTemplateName.trim();
      if (!name) return;

      const nextTemplate = {
        name,
        permissions: RESOURCES.reduce((acc, resource) => {
          acc[resource] = ACTIONS.reduce((actions, action) => {
            actions[action] = action === 'view';
            return actions;
          }, {});
          return acc;
        }, {}),
      };

      const updated = [...templates, nextTemplate];
      setTemplates(updated);
      setActiveTemplateIndex(updated.length - 1);
      setNewTemplateName('');
    });
  };

  const handleEditTemplateName = () => {
    requireReason(() => {
      const nextName = editTemplateName.trim();
      if (!nextName || !activeTemplate) return;
      const updated = templates.map((template, index) =>
        index === activeTemplateIndex ? { ...template, name: nextName } : template,
      );
      setTemplates(updated);
      setEditTemplateName('');
    });
  };

  const handleDeleteTemplate = () => {
    requireReason(() => {
      if (templates.length <= 1) return;
      const updated = templates.filter((_, index) => index !== activeTemplateIndex);
      setTemplates(updated);
      setActiveTemplateIndex(0);
    });
  };

  const handleTogglePermission = (resource, action) => {
    requireReason(() => {
      const updated = templates.map((template, index) => {
        if (index !== activeTemplateIndex) return template;
        return {
          ...template,
          permissions: {
            ...template.permissions,
            [resource]: {
              ...template.permissions[resource],
              [action]: !template.permissions[resource][action],
            },
          },
        };
      });
      setTemplates(updated);
    });
  };

  const getUserName = (userId) => users.find((entry) => entry.id === userId)?.full_name || 'Sin nombre';

  const handleRoleChange = async () => {
    if (!selectedProfile) {
      setErrorText('Selecciona un usuario para cambiar el rol.');
      return;
    }
    if (!hasMutationReason(reasonText)) {
      setErrorText('El motivo es obligatorio para cualquier cambio.');
      return;
    }
    if (selectedProfile.app_role === selectedRole) {
      setErrorText('Selecciona un rol distinto al actual.');
      return;
    }
    if (isSelfAdminDemotion) {
      setErrorText('Bloqueado: no puedes remover tu propio manage_permissions.');
      return;
    }
    if (isLastManagePermissionsAdminAtRisk) {
      setErrorText('Bloqueado: debe existir otro ADMIN activo con manage_permissions antes de este cambio.');
      return;
    }

    const pendingOpenRequest = pendingRoleChanges.find((change) =>
      change.target_profile_id === selectedProfile.id &&
      [PENDING_CHANGE_STATUSES.PENDING_ADMIN_APPROVAL, PENDING_CHANGE_STATUSES.PENDING_SECOND_ADMIN_APPROVAL].includes(change.status),
    );
    if (pendingOpenRequest) {
      setErrorText('Ya existe una solicitud pendiente para este usuario.');
      return;
    }
    setErrorText('');
    setIsUpdatingRole(true);
    try {
      if (isAppOwner) {
        await base44.entities.UserProfile.update(selectedProfile.id, { app_role: selectedRole });
      } else {
        const isHighRiskChange = selectedProfile.app_role === 'ADMIN' || selectedRole === 'ADMIN';
        await base44.entities[PENDING_CHANGE_ENTITY].create({
          school_id: userProfile.school_id,
          type: 'ROLE_CHANGE',
          status: isHighRiskChange ? PENDING_CHANGE_STATUSES.PENDING_SECOND_ADMIN_APPROVAL : PENDING_CHANGE_STATUSES.PENDING_ADMIN_APPROVAL,
          requester_profile_id: userProfile.id,
          requester_user_id: user.id,
          target_profile_id: selectedProfile.id,
          payload: {
            from_role: selectedProfile.app_role,
            to_role: selectedRole,
            risk_level: isHighRiskChange ? 'HIGH' : 'NORMAL',
          },
        });
      }
      await logAuditEvent({
        user,
        userProfile,
        entity: AUDIT_ENTITIES.USER_PROFILE,
        entityId: selectedProfile.id,
        action: isAppOwner ? 'ROLE_CHANGED_OWNER_BYPASS' : 'ROLE_CHANGE_REQUESTED',
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
      toast.success(isAppOwner ? 'Rol actualizado correctamente' : 'Solicitud de cambio enviada');
      setReasonText('');
    } catch (error) {
      toast.error('No se pudo actualizar el rol');
    } finally {
      setIsUpdatingRole(false);
    }
  };
  const handlePendingRoleChangeDecision = async (change, decision) => {
    const isRequester = change.requester_profile_id === userProfile.id;
    if (isRequester) {
      toast.error('El aprobador no puede ser el mismo solicitante.');
      return;
    }
    setPendingDecisionByChangeId((prev) => ({ ...prev, [change.id]: true }));
    try {
      const targetProfile = schoolProfiles.find((profile) => profile.id === change.target_profile_id);
      const approvesAdminDemotion = decision === 'approve' && targetProfile?.app_role === 'ADMIN' && change.payload?.to_role !== 'ADMIN';
      if (approvesAdminDemotion && !hasOtherActiveAdminWithManagePermissions({
        profiles: schoolProfiles,
        actorProfileId: userProfile?.id,
        targetProfileId: targetProfile?.id,
      })) {
        toast.error('Bloqueado: debe existir otro ADMIN activo con manage_permissions antes de aprobar este cambio.');
        return;
      }
      const updateData = {
        status: decision === 'approve' ? PENDING_CHANGE_STATUSES.APPROVED : PENDING_CHANGE_STATUSES.REJECTED,
        approver_profile_id: userProfile.id,
        approver_user_id: user.id,
        approved_at: new Date().toISOString(),
      };
      await base44.entities[PENDING_CHANGE_ENTITY].update(change.id, updateData);
      if (decision === 'approve') {
        await base44.entities.UserProfile.update(change.target_profile_id, { app_role: change.payload?.to_role });
      }
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
          after: { app_role: change.payload?.to_role, status: updateData.status },
          actorProfileId: change.requester_profile_id,
          reviewerProfileId: userProfile.id,
          reason: `ROLE_CHANGE_${decision.toUpperCase()}`,
          snapshot: { applied_at: new Date().toISOString() },
        }),
      });
      await refetchPendingRoleChanges();
      await refetchSchoolProfiles();
      toast.success(decision === 'approve' ? 'Cambio aprobado' : 'Cambio rechazado');
    } finally {
      setPendingDecisionByChangeId((prev) => ({ ...prev, [change.id]: false }));
    }
  };
  const handleSaveOverride = async () => {
    if (!hasMutationReason(reasonText)) {
      setErrorText('El motivo es obligatorio para cualquier cambio.');
      return;
    }
    if (!overrideTargetProfile) {
      setErrorText('Selecciona un usuario para el override.');
      return;
    }
    if (isOverrideTargetAdmin) {
      setErrorText('No se permiten overrides sobre usuarios ADMIN.');
      return;
    }
    if (overrideForm.action === 'manage_permissions' && overrideForm.user_profile_id === userProfile?.id) {
      setErrorText('Bloqueado: no puedes remover tu propio manage_permissions.');
      return;
    }
    setErrorText('');
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
      toast.success('Override guardado');
    } catch {
      toast.error('No se pudo guardar el override');
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

  const handleDeleteOverride = async (overrideId) => {
    if (!hasMutationReason(reasonText)) {
      setErrorText('El motivo es obligatorio para cualquier cambio.');
      return;
    }
    const current = permissionOverrides.find((entry) => entry.id === overrideId);
    await deletePermissionOverride(overrideId);
    await logAuditEvent({
      user,
      userProfile,
      entity: AUDIT_ENTITIES.PERMISSION_CHANGE,
      entityId: overrideId,
      action: AUDIT_ACTIONS.PERMISSION_CHANGE,
      reason: reasonText.trim(),
      context: buildPermissionChangeContext({
        changeType: 'PERMISSION_OVERRIDE_DELETE',
        before: current || null,
        after: null,
        actorProfileId: userProfile.id,
        reason: reasonText.trim(),
        snapshot: { applied_at: new Date().toISOString() },
      }),
    });
    await refetchOverrides();
    setReasonText('');
    toast.success('Override eliminado');
  };

  const handleApplyRollback = async () => {
    if (!hasMutationReason(reasonText)) {
      setErrorText('El motivo es obligatorio para cualquier cambio.');
      return;
    }
    if (!rollbackOverride) {
      setErrorText('Selecciona un override para rollback.');
      return;
    }
    setErrorText('');
    setIsApplyingRollback(true);
    const isHighRiskRollback = rollbackOverride.action === 'manage_permissions';
    try {
      if (isHighRiskRollback) {
        await base44.entities[PENDING_CHANGE_ENTITY].create({
          school_id: userProfile.school_id,
          type: 'PERMISSION_ROLLBACK',
          status: PENDING_CHANGE_STATUSES.PENDING_SECOND_ADMIN_APPROVAL,
          requester_profile_id: userProfile.id,
          requester_user_id: user.id,
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
      toast.success(isHighRiskRollback ? 'Solicitud de rollback enviada' : 'Rollback aplicado');
    } catch {
      toast.error('No se pudo aplicar el rollback');
    } finally {
      setIsApplyingRollback(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <PageHeader title="Permisos y Roles" subtitle="Configuración de acceso" showBack backTo={createPageUrl('Home')} />
      <Card className="p-4 mt-4 space-y-4">
        <p className="text-slate-700">Matriz de permisos por recurso y acción.</p>

        <div className="space-y-3 border rounded bg-white p-3">
          <p className="font-medium text-slate-800">Cambio de rol de usuario</p>
          <p className="text-xs text-slate-500">El dueño de la app está exento del maker-checker y aplica el cambio directo.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <select
              className="h-10 rounded-md border border-slate-200 px-3 text-sm"
              value={selectedProfileId}
              onChange={(event) => setSelectedProfileId(event.target.value)}
            >
              <option value="">Selecciona un usuario</option>
              {schoolProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {getUserName(profile.user_id)} ({profile.app_role})
                </option>
              ))}
            </select>

            <select
              className="h-10 rounded-md border border-slate-200 px-3 text-sm"
              value={selectedRole}
              onChange={(event) => setSelectedRole(event.target.value)}
            >
              <option value="PARENT">PARENT</option>
              <option value="TEACHER">TEACHER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>
          {isAdminRoleChange ? <p className="text-sm text-red-700">Cambio de alto riesgo: otorgar o revocar ADMIN.</p> : null}
          {isSelfAdminDemotion ? <p className="text-sm text-red-700">Bloqueado: no puedes remover tu propio manage_permissions.</p> : null}
          {isLastManagePermissionsAdminAtRisk ? <p className="text-sm text-red-700">Bloqueado: se requiere otro ADMIN activo para conservar manage_permissions.</p> : null}
          <Button variant={isAdminRoleChange ? 'destructive' : 'default'} onClick={handleRoleChange} disabled={isUpdatingRole}>
            {isUpdatingRole ? 'Guardando...' : 'Actualizar rol'}
          </Button>
        </div>
        <div className="space-y-3 border rounded bg-white p-3">
          <p className="font-medium text-slate-800">Rollback por módulo</p>
          <div className="grid gap-3 md:grid-cols-2">
            <select className="h-10 rounded-md border border-slate-200 px-3 text-sm" value={rollbackModule} onChange={(event) => { setRollbackModule(event.target.value); setRollbackOverrideId(''); }}>
              {ROLLBACK_MODULES.map((module) => <option key={module} value={module}>{module}</option>)}
            </select>
            <select className="h-10 rounded-md border border-slate-200 px-3 text-sm" value={rollbackOverrideId} onChange={(event) => setRollbackOverrideId(event.target.value)}>
              <option value="">Selecciona override</option>
              {rollbackCandidates.map((entry) => <option key={entry.id} value={entry.id}>{entry.action} / {entry.effect} / {entry.user_profile_id}</option>)}
            </select>
          </div>
          {rollbackOverride ? <pre className="rounded bg-slate-50 p-2 text-xs">{JSON.stringify({ before: rollbackOverride, after: null }, null, 2)}</pre> : null}
          {rollbackOverride?.action === 'manage_permissions' ? <p className="text-sm text-red-700">Alto riesgo: requiere maker-checker.</p> : null}
          <Button variant={rollbackOverride?.action === 'manage_permissions' ? 'destructive' : 'outline'} onClick={handleApplyRollback} disabled={isApplyingRollback}>
            {isApplyingRollback ? 'Aplicando...' : 'Aplicar rollback'}
          </Button>
        </div>
        <div className="space-y-3 border rounded bg-white p-3">
          <p className="font-medium text-slate-800">Solicitudes pendientes de cambio de rol</p>
          <div className="overflow-auto border rounded">
            <table className="min-w-full text-sm">
              <thead><tr className="bg-slate-100"><th className="p-2 text-left">Usuario objetivo</th><th className="p-2 text-left">Desde</th><th className="p-2 text-left">Hacia</th><th className="p-2 text-left">Estado</th><th className="p-2 text-left">Acciones</th></tr></thead>
              <tbody>
                {pendingRoleChanges.map((change) => {
                  const targetProfile = schoolProfiles.find((profile) => profile.id === change.target_profile_id);
                  const disabledByRequesterRule = change.requester_profile_id === userProfile.id;
                  return (
                    <tr key={change.id} className="border-t">
                      <td className="p-2">{targetProfile ? `${getUserName(targetProfile.user_id)} (${targetProfile.app_role})` : change.target_profile_id}</td>
                      <td className="p-2">{change.payload?.from_role}</td>
                      <td className="p-2">{change.payload?.to_role}</td>
                      <td className="p-2">{change.status}</td>
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
          <label className="text-sm font-medium">Motivo del cambio (obligatorio)</label>
          <Textarea value={reasonText} onChange={(event) => setReasonText(event.target.value)} placeholder="Describe el motivo" />
          {errorText ? <p className="text-sm text-red-600">{errorText}</p> : null}
        </div>

        <div className="space-y-3 border rounded bg-white p-3">
          <p className="font-medium text-slate-800">Danger Zone (Permisos y Roles)</p>
          <p className="text-xs text-red-700">Todas las operaciones son de alto riesgo, irreversibles en algunos casos, y usan maker-checker con segundo ADMIN (excepto app owner).</p>
          <div className="overflow-auto border rounded">
            <table className="min-w-full text-sm">
              <thead><tr className="bg-slate-100"><th className="p-2 text-left">Operación</th><th className="p-2 text-left">Riesgo</th><th className="p-2 text-left">Confirmación requerida</th><th className="p-2 text-left">Rollback/Compensación</th></tr></thead>
              <tbody>
                {dangerZoneOperations.map((operation) => (
                  <tr key={operation.key} className="border-t">
                    <td className="p-2">{operation.label}</td>
                    <td className="p-2 text-red-700">High-risk</td>
                    <td className="p-2">Frase escrita + warning irreversible + preview de tenant objetivo</td>
                    <td className="p-2">{getRollbackPolicy(operation.key)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-600">Guardrails backend: verificación de tenant, verificación de rol ADMIN, y deny-by-default si falta contexto.</p>
          <p className="text-xs text-slate-600">Auditoría obligatoria por acción: requested_by, approved_by, reason, before/after, timestamp, outcome.</p>
        </div>

        <div className="space-y-3 border rounded bg-white p-3">
          <p className="font-medium text-slate-800">Overrides por usuario</p>
          <div className="grid gap-3 md:grid-cols-4">
            <select className="h-10 rounded-md border border-slate-200 px-3 text-sm" value={overrideForm.user_profile_id} onChange={(event) => setOverrideForm((prev) => ({ ...prev, user_profile_id: event.target.value }))}>
              <option value="">Selecciona usuario</option>
              {schoolProfiles.map((profile) => <option key={profile.id} value={profile.id}>{getUserName(profile.user_id)} ({profile.app_role})</option>)}
            </select>
            <select className="h-10 rounded-md border border-slate-200 px-3 text-sm" value={overrideForm.resource} onChange={(event) => setOverrideForm((prev) => ({ ...prev, resource: event.target.value }))}>
              {['Notice', 'Attendance', 'Homework', 'DiaryEntry', 'ChargeItem', 'PaymentConcept', 'PaymentRecord'].map((resource) => <option key={resource} value={resource}>{resource}</option>)}
            </select>
            <select className="h-10 rounded-md border border-slate-200 px-3 text-sm" value={overrideForm.action} onChange={(event) => setOverrideForm((prev) => ({ ...prev, action: event.target.value }))}>
              {POLICY_ACTIONS.map((action) => <option key={action} value={action}>{action}</option>)}
            </select>
            <select className="h-10 rounded-md border border-slate-200 px-3 text-sm" value={overrideForm.effect} onChange={(event) => setOverrideForm((prev) => ({ ...prev, effect: event.target.value }))}>
              <option value="deny">deny</option>
              <option value="allow">allow</option>
            </select>
          </div>
          {isOverrideTargetAdmin ? <p className="text-sm text-red-700">Bloqueado: no se permiten overrides para ADMIN.</p> : null}
          {overrideForm.action === 'manage_permissions' && overrideForm.user_profile_id === userProfile?.id ? <p className="text-sm text-red-700">Bloqueado: no puedes cambiar tu propio manage_permissions.</p> : null}
          <Button onClick={handleSaveOverride} disabled={isSavingOverride || isOverrideTargetAdmin}>{editingOverrideId ? 'Actualizar override' : 'Crear override'}</Button>
          <div className="overflow-auto border rounded">
            <table className="min-w-full text-sm">
              <thead><tr className="bg-slate-100"><th className="p-2 text-left">Usuario</th><th className="p-2 text-left">Recurso</th><th className="p-2 text-left">Acción</th><th className="p-2 text-left">Efecto</th><th className="p-2 text-left">Preview</th><th className="p-2 text-left">Acciones</th></tr></thead>
              <tbody>
                {permissionOverrides.map((override) => {
                  const profile = schoolProfiles.find((entry) => entry.id === override.user_profile_id);
                  const preview = getEffectivePolicyDecision({ role: profile?.app_role, entity: override.resource, action: override.action, userProfileId: override.user_profile_id, overrides: permissionOverrides });
                  return (
                    <tr key={override.id} className="border-t">
                      <td className="p-2">{profile ? `${getUserName(profile.user_id)} (${profile.app_role})` : override.user_profile_id}</td>
                      <td className="p-2">{override.resource}</td><td className="p-2">{override.action}</td><td className="p-2">{override.effect}</td>
                      <td className="p-2">{preview.allowed ? 'Permitido' : 'Denegado'} ({preview.precedence})</td>
                      <td className="p-2 space-x-2"><Button variant="outline" onClick={() => handleEditOverride(override)}>Editar</Button><Button variant="destructive" onClick={() => handleDeleteOverride(override.id)}>Eliminar</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Input value={newTemplateName} onChange={(event) => setNewTemplateName(event.target.value)} placeholder="Nombre de nueva plantilla" />
          <Button onClick={handleAddTemplate}>Agregar plantilla</Button>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {templates.map((template, index) => (
            <button
              key={`${template.name}-${index}`}
              type="button"
              onClick={() => setActiveTemplateIndex(index)}
              className={`rounded border p-2 text-left ${index === activeTemplateIndex ? 'border-slate-900 bg-white' : 'border-slate-200 bg-slate-100'}`}
            >
              {template.name}
            </button>
          ))}
        </div>

        {activeTemplate ? (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
              <Input value={editTemplateName} onChange={(event) => setEditTemplateName(event.target.value)} placeholder="Nuevo nombre de plantilla" />
              <Button onClick={handleEditTemplateName}>Editar nombre</Button>
              <Button variant="destructive" onClick={handleDeleteTemplate}>Eliminar plantilla</Button>
            </div>

            <div className="overflow-auto border rounded bg-white">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="p-2 text-left">Recurso</th>
                    {ACTIONS.map((action) => (
                      <th key={action} className="p-2 text-left">{action}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {RESOURCES.map((resource) => (
                    <tr key={resource} className="border-t">
                      <td className="p-2 font-medium">{resource}</td>
                      {ACTIONS.map((action) => (
                        <td key={`${resource}-${action}`} className="p-2">
                          <input
                            type="checkbox"
                            checked={Boolean(activeTemplate.permissions[resource][action])}
                            onChange={() => handleTogglePermission(resource, action)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
