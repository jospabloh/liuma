import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { createPageUrl } from '@/utils';
import { toast } from 'sonner';
import { seedTestData } from '@/lib/testData/seedTestData';

/**
 * Dev/admin-only tool to seed a fully-connected, role-isolated sample dataset.
 *
 * It must be run while Base44 "Test Data" mode is ON, so the platform tags the
 * writes is_sample:true (hidden when you toggle Test Data off). Creating data
 * with Test Data OFF would write LIVE records — and the data API has no delete.
 */
export default function SeedTestData() {
  const { user, userProfile, isLoading } = useCurrentProfile();
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const [report, setReport] = useState(null);

  const append = (msg) => setLog((prev) => [...prev, `${new Date().toLocaleTimeString()}  ${msg}`]);

  if (isLoading) return <LoadingScreen message="Validando permisos…" />;

  if (userProfile?.app_role !== 'ADMIN') {
    return (
      <div className="min-h-screen bg-background">
        <PageHeader title="Seed Test Data" subtitle="Acceso restringido" showBack backTo={createPageUrl('Home')} />
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6">
          <Card className="p-4"><p className="text-card-foreground">Solo administradores pueden generar datos de prueba.</p></Card>
        </div>
      </div>
    );
  }

  const runSeed = async () => {
    setRunning(true);
    setLog([]);
    setReport(null);
    try {
      append('Iniciando seed…');
      const result = await seedTestData({
        sdk: base44,
        schoolId: userProfile.school_id,
        ownerUserId: user.id,
        log: append,
      });
      setReport(result);
      toast.success(`Seed completo: ${result.created} registros`);
    } catch (e) {
      append(`ERROR: ${e?.message || e}`);
      toast.error(e?.message || 'No se pudo generar el seed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="Seed Test Data" subtitle="Datos de prueba conectados y aislados por rol" showBack backTo={createPageUrl('Home')} />
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 pb-24 space-y-5">
        <Card className="rounded-2xl border-l-4 border-l-amber-500 p-4">
          <p className="font-bold text-card-foreground">⚠ Antes de continuar</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Activa el modo <strong>Test Data</strong> de Base44 (Advanced Capabilities → Test Data → Enabled). Solo así los registros se marcan como datos de prueba y se ocultan al apagarlo.</li>
            <li>Con Test Data <strong>apagado</strong>, esto crearía registros <strong>reales</strong>, y la API no permite borrarlos.</li>
            <li>Se ejecuta una sola vez por escuela (aborta si ya existen datos <code>[TEST]</code>).</li>
          </ol>
        </Card>

        <Card className="p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Escuela destino: <strong className="text-card-foreground">{userProfile.school_id}</strong> · Tu rol: <strong className="text-card-foreground">{userProfile.app_role}</strong>
          </p>
          <Button onClick={runSeed} disabled={running}>
            {running ? 'Generando…' : 'Generar datos de prueba'}
          </Button>
        </Card>

        {log.length > 0 && (
          <Card className="p-4">
            <p className="mb-2 text-sm font-semibold text-card-foreground">Registro de ejecución</p>
            <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-[11px] leading-5 text-muted-foreground">{log.join('\n')}</pre>
          </Card>
        )}

        {report && (
          <>
            {report.warnings.length > 0 && (
              <Card className="rounded-2xl border-l-4 border-l-amber-500 p-4">
                <p className="font-semibold text-card-foreground">Advertencias</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {report.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </Card>
            )}

            <Card className="overflow-hidden rounded-2xl">
              <div className="overflow-x-auto">
                <table className="ui-table min-w-[420px]">
                  <thead><tr><th>Entidad</th><th>Registros creados</th></tr></thead>
                  <tbody>
                    {Object.entries(report.byEntity).map(([entity, count]) => (
                      <tr key={entity}><td className="font-medium text-foreground">{entity}</td><td>{count}</td></tr>
                    ))}
                    <tr><td className="font-bold">Total</td><td className="font-bold">{report.created}</td></tr>
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="overflow-hidden rounded-2xl">
              <div className="overflow-x-auto">
                <table className="ui-table min-w-[640px]">
                  <thead><tr><th>Persona ficticia</th><th>Email (para impersonar)</th><th>Rol</th><th>Estado</th></tr></thead>
                  <tbody>
                    {Object.entries(report.users).filter(([, u]) => !u.existing).map(([localId, u]) => (
                      <tr key={localId}>
                        <td className="font-medium text-foreground">{u.full_name}</td>
                        <td className="text-muted-foreground">{u.email}</td>
                        <td>{u.role}</td>
                        <td>{u.provisioned ? '✓ creado' : '⚠ crear en Base44'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-4 py-3 text-xs text-muted-foreground">
                Para los usuarios marcados “crear en Base44”: invítalos con ese email exacto desde Base44, asígnales el rol y vincula su <code>UserProfile</code> (school_id, app_role) y los campos de alcance en <code>User.data</code> (mostrados en la consola). Ver <code>docs/test-data-report.md</code>.
              </p>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
