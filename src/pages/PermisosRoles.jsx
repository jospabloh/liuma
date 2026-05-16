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
import { AUDIT_ENTITIES, logAuditEvent } from '@/lib/audit';
import {
  createPermissionOverride,
  deletePermissionOverride,
  listPermissionOverrides,
  updatePermissionOverride,
} from '@/lib/authorization/overrides';
import { getEffectivePolicyDecision } from '@/lib/authorization/policy';

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

  const activeTemplate = templates[activeTemplateIndex] || null;
  const selectedProfile = schoolProfiles.find((profile) => profile.id === selectedProfileId) || null;
  const isAdminRoleChange = selectedProfile && (selectedProfile.app_role === 'ADMIN' || selectedRole === 'ADMIN');
  const overrideTargetProfile = schoolProfiles.find((profile) => profile.id === overrideForm.user_profile_id) || null;
  const isOverrideTargetAdmin = overrideTargetProfile?.app_role === 'ADMIN';

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

    setErrorText('');
    setIsUpdatingRole(true);
    try {
      await base44.entities.UserProfile.update(selectedProfile.id, { app_role: selectedRole });
      await logAuditEvent({
        user,
        userProfile,
        entity: AUDIT_ENTITIES.USER_PROFILE,
        entityId: selectedProfile.id,
        action: selectedRole === 'ADMIN' ? 'ROLE_ADMIN_GRANTED' : selectedProfile.app_role === 'ADMIN' ? 'ROLE_ADMIN_REVOKED' : 'ROLE_CHANGED',
        reason: reasonText.trim(),
        context: {
          from_role: selectedProfile.app_role,
          to_role: selectedRole,
          risk_level: isAdminRoleChange ? 'HIGH' : 'NORMAL',
        },
      });
      await refetchSchoolProfiles();
      toast.success('Rol actualizado correctamente');
      setReasonText('');
    } catch (error) {
      toast.error('No se pudo actualizar el rol');
    } finally {
      setIsUpdatingRole(false);
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
    setErrorText('');
    setIsSavingOverride(true);
    const payload = { ...overrideForm, school_id: userProfile.school_id, reason: reasonText.trim() };
    try {
      if (editingOverrideId) {
        await updatePermissionOverride(editingOverrideId, payload);
      } else {
        await createPermissionOverride(payload);
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
    await deletePermissionOverride(overrideId);
    await refetchOverrides();
    setReasonText('');
    toast.success('Override eliminado');
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <PageHeader title="Permisos y Roles" subtitle="Configuración de acceso" showBack backTo={createPageUrl('Home')} />
      <Card className="p-4 mt-4 space-y-4">
        <p className="text-slate-700">Matriz de permisos por recurso y acción.</p>

        <div className="space-y-3 border rounded bg-white p-3">
          <p className="font-medium text-slate-800">Cambio de rol de usuario</p>
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
          <Button variant={isAdminRoleChange ? 'destructive' : 'default'} onClick={handleRoleChange} disabled={isUpdatingRole}>
            {isUpdatingRole ? 'Guardando...' : 'Actualizar rol'}
          </Button>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Motivo del cambio (obligatorio)</label>
          <Textarea value={reasonText} onChange={(event) => setReasonText(event.target.value)} placeholder="Describe el motivo" />
          {errorText ? <p className="text-sm text-red-600">{errorText}</p> : null}
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
