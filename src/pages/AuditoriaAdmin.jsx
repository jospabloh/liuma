import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createPageUrl } from '@/utils';
import { maskAuditContext } from '@/lib/audit';

export default function AuditoriaAdmin() {
  const [entityFilter, setEntityFilter] = useState('ALL');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  const { data: user } = useQuery({ queryKey: ['currentUser'], queryFn: () => base44.auth.me() });
  const { data: userProfile } = useQuery({
    queryKey: ['userProfile', user?.id],
    queryFn: async () => (await base44.entities.UserProfile.filter({ user_id: user.id }))[0],
    enabled: !!user,
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['auditLogs', userProfile?.school_id],
    queryFn: () => base44.entities.AuditLog.filter({ school_id: userProfile.school_id }, '-created_date', 200),
    enabled: !!userProfile && userProfile.app_role === 'ADMIN',
  });

  const filtered = useMemo(() => rows.filter((row) => {
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
    <div className="min-h-screen bg-slate-50 p-6">
      <PageHeader title="Auditoría" subtitle="Eventos sensibles y decisiones de IA" showBack backTo={createPageUrl('Home')} />
      <Card className="p-4 mb-4 grid md:grid-cols-4 gap-3">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar actor, entidad o razón" />
        <Select value={entityFilter} onValueChange={setEntityFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Todas entidades</SelectItem><SelectItem value="Attendance">Attendance</SelectItem><SelectItem value="Notice">Notice</SelectItem><SelectItem value="DiaryEntry">DiaryEntry</SelectItem><SelectItem value="PaymentRecord">PaymentRecord</SelectItem><SelectItem value="ChargeItem">ChargeItem</SelectItem><SelectItem value="AiInteraction">AiInteraction</SelectItem></SelectContent></Select>
        <Select value={actionFilter} onValueChange={setActionFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Todas acciones</SelectItem>{[...new Set(rows.map((r) => r.action).filter(Boolean))].map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent></Select>
        <Button onClick={exportCsv}>Exportar CSV</Button>
      </Card>

      <div className="space-y-3">
        {filtered.map((row) => (
          <Card key={row.id} className="p-4 text-sm">
            <p><strong>{row.action}</strong> · {row.entity} · {row.entity_id}</p>
            <p className="text-slate-500">{row.timestamp || row.created_date} · {row.role} · {row.actor || row.user_id}</p>
            {row.reason && <p className="mt-1">Razón: {row.reason}</p>}
            {row.context && <pre className="mt-2 bg-slate-100 p-2 rounded overflow-auto">{JSON.stringify(maskAuditContext(row.context), null, 2)}</pre>}
          </Card>
        ))}
      </div>
    </div>
  );
}
