import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createPageUrl } from '@/utils';
import { AUDIT_ACTIONS, AUDIT_ENTITIES, canReadPermissionChangeAudit, maskAuditContext } from '@/lib/audit';

export default function AuditoriaAdmin() {
  const [entityFilter, setEntityFilter] = useState('ALL');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  const { user, userProfile } = useCurrentProfile();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['auditLogs', userProfile?.school_id],
    queryFn: () => base44.entities.AuditLog.filter({ school_id: userProfile.school_id }, '-created_date', 200),
    enabled: !!userProfile && userProfile.app_role === 'ADMIN',
  });

  const filtered = useMemo(() => rows.filter((row) => {
    const isPermissionChange = row.entity === AUDIT_ENTITIES.PERMISSION_CHANGE || row.action === AUDIT_ACTIONS.PERMISSION_CHANGE;
    if (isPermissionChange && !canReadPermissionChangeAudit({ row, user, userProfile })) return false;

    if (!isPermissionChange && row.entity === AUDIT_ENTITIES.PERMISSION_CHANGE) return false;
    if (entityFilter !== 'ALL' && row.entity !== entityFilter) return false;
    if (actionFilter !== 'ALL' && row.action !== actionFilter) return false;
    if (search && !`${row.actor || ''} ${row.entity_id || ''} ${row.reason || ''}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [rows, entityFilter, actionFilter, search]);

  const exportCsv = () => {
    const header = ['timestamp', 'actor', 'role', 'entity', 'entity_id', 'action', 'reason'];
    const lines = filtered.map((row) => header.map((key) => JSON.stringify(row[key] || '')).join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <LoadingScreen message="Cargando auditoría..." />;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 pb-24">
      <PageHeader title="Auditoría" subtitle="Eventos sensibles y decisiones de IA" showBack backTo={createPageUrl('Home')} />
      <Card className="p-4 mb-4 grid md:grid-cols-4 gap-3 rounded-2xl">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar actor, entidad o razón" />
        <Select value={entityFilter} onValueChange={setEntityFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Todas entidades</SelectItem><SelectItem value="Attendance">Attendance</SelectItem><SelectItem value="Notice">Notice</SelectItem><SelectItem value="DiaryEntry">DiaryEntry</SelectItem><SelectItem value="PaymentRecord">PaymentRecord</SelectItem><SelectItem value="ChargeItem">ChargeItem</SelectItem><SelectItem value="AiInteraction">AiInteraction</SelectItem></SelectContent></Select>
        <Select value={actionFilter} onValueChange={setActionFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Todas acciones</SelectItem>{[...new Set(rows.map((r) => r.action).filter(Boolean))].map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent></Select>
        <Button onClick={exportCsv}>Exportar CSV</Button>
      </Card>

      <Card className="overflow-hidden rounded-2xl">
        <div className="overflow-x-auto">
          <table className="ui-table min-w-[760px]">
            <thead>
              <tr>
                <th>Acción</th>
                <th>Entidad</th>
                <th>Fecha</th>
                <th>Rol</th>
                <th>Actor</th>
                <th>Razón</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">Sin eventos para los filtros actuales.</td>
                </tr>
              )}
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td className="font-medium text-foreground">{row.action}</td>
                  <td className="text-muted-foreground">{row.entity}{row.entity_id ? ` · ${row.entity_id}` : ''}</td>
                  <td className="whitespace-nowrap text-muted-foreground">{row.timestamp || row.created_date}</td>
                  <td className="text-muted-foreground">{row.role}</td>
                  <td className="ui-truncate-cell text-muted-foreground">{row.actor || row.user_id}</td>
                  <td className="ui-truncate-cell" title={row.reason || ''}>{row.reason || '—'}</td>
                  <td>
                    {row.context ? (
                      <details>
                        <summary className="cursor-pointer text-brand">Ver</summary>
                        <pre className="mt-2 max-w-xs overflow-auto rounded-lg bg-muted p-2 text-[11px] text-muted-foreground">{JSON.stringify(maskAuditContext(row.context), null, 2)}</pre>
                      </details>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      </div>
    </div>
  );
}
