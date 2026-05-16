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

  const activeTemplate = templates[activeTemplateIndex] || null;

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

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <PageHeader title="Permisos y Roles" subtitle="Configuración de acceso" showBack backTo={createPageUrl('Home')} />
      <Card className="p-4 mt-4 space-y-4">
        <p className="text-slate-700">Matriz de permisos por recurso y acción.</p>

        <div className="space-y-2">
          <label className="text-sm font-medium">Motivo del cambio (obligatorio)</label>
          <Textarea value={reasonText} onChange={(event) => setReasonText(event.target.value)} placeholder="Describe el motivo" />
          {errorText ? <p className="text-sm text-red-600">{errorText}</p> : null}
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
