import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import {
  Search, Shield, CheckCircle, AlertCircle, Clock,
  X, Loader2, ChevronRight, Users, Calendar,
  RefreshCw, ToggleLeft, ToggleRight, DollarSign,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { useSubscription } from '@/hooks/useSubscription';
import {
  PLAN_CATALOG, PLAN_TIERS, ACTIVATION_FEE,
  currentPeriod, planLabel,
  buildActivationUpdate, buildPaymentConfirmationUpdate,
} from '@/lib/license/licenseModel';
import { logAuditEvent } from '@/lib/audit';

const PLAN_OPTIONS = PLAN_TIERS.map((tier) => PLAN_CATALOG[tier]);

const CONTACT_FORM_URL = 'https://forms.gle/jLQ4EtWmQhkSsahy9';

const STATUS_CONFIG = {
  trial:     { label: 'Prueba',      color: 'text-blue-600 bg-blue-50',     icon: Clock },
  active:    { label: 'Activo',      color: 'text-emerald-600 bg-emerald-50', icon: CheckCircle },
  view_only: { label: 'Solo lectura', color: 'text-amber-600 bg-amber-50',   icon: AlertCircle },
  inactive:  { label: 'Inactivo',    color: 'text-muted-foreground bg-muted',  icon: AlertCircle },
  canceled:  { label: 'Cancelado',   color: 'text-muted-foreground bg-muted',  icon: AlertCircle },
  suspended: { label: 'Suspendido',  color: 'text-red-600 bg-red-50',       icon: AlertCircle },
};

// Statuses surfaced as headline counters in the owner panel.
const SUMMARY_STATUSES = ['trial', 'active', 'view_only', 'suspended'];

function fmt(iso) {
  if (!iso) return '—';
  return format(new Date(iso), "d 'de' MMM, yyyy", { locale: es });
}

// ── School-admin read-only view ("Mi Licencia") ──────────────────────────────
function SchoolLicenseView() {
  const {
    isLoading, isSchoolAdmin, subscription, billingStatus, licenseTier,
    licensedStudentLimit, trialDaysLeft, trialStartAt, trialEndAt,
    licenseActivatedAt, licenseExpiresAt,
  } = useSubscription();

  if (isLoading) return <LoadingScreen message="Cargando tu licencia..." />;

  if (!isSchoolAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Shield className="w-10 h-10 text-muted-foreground" />
        <p className="text-muted-foreground text-sm">Acceso restringido.</p>
      </div>
    );
  }

  const cfg = STATUS_CONFIG[billingStatus] || STATUS_CONFIG.trial;
  const StatusIcon = cfg.icon;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 pb-24">
      <PageHeader title="Mi Licencia" subtitle={subscription ? 'Información de tu plan LIUMA' : 'Sin suscripción registrada'} />

      <div className="space-y-4">
        <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border border-current/20 ${cfg.color}`}>
          <StatusIcon className="w-5 h-5 flex-shrink-0" />
          <div>
            <p className="text-sm font-bold">Estado: {cfg.label}</p>
            {billingStatus === 'trial' && trialDaysLeft !== null && (
              <p className="text-xs mt-0.5">
                {trialDaysLeft > 0 ? `Quedan ${trialDaysLeft} días de prueba` : 'El período de prueba ha terminado'}
              </p>
            )}
          </div>
        </div>

        <div className="bg-card text-card-foreground border border-border rounded-2xl shadow-sm p-4 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Detalles del plan</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-muted rounded-xl p-3">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Tipo de licencia</p>
              <p className="text-sm font-bold text-card-foreground">{planLabel(licenseTier)}</p>
            </div>
            <div className="bg-muted rounded-xl p-3">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Alumnos</p>
              <p className="text-sm font-bold text-card-foreground">{licensedStudentLimit ?? 'Ilimitado'}</p>
            </div>
          </div>

          <div className="space-y-2 pt-1 text-xs">
            {trialStartAt && <DetailRow icon={Calendar} label="Inicio de prueba" value={fmt(trialStartAt)} />}
            {trialEndAt && <DetailRow icon={Calendar} label="Fin de prueba" value={fmt(trialEndAt)} />}
            {licenseActivatedAt && <DetailRow icon={CheckCircle} label="Licencia activada" value={fmt(licenseActivatedAt)} />}
            {licenseExpiresAt && <DetailRow icon={Clock} label="Vence" value={fmt(licenseExpiresAt)} />}
          </div>
        </div>

        <div className="bg-muted rounded-2xl px-4 py-3 border border-border">
          <p className="text-[11px] text-muted-foreground text-center">
            Tu suscripción se gestiona vía Mercado Pago. Para cambios en tu plan, contacta al soporte de LIUMA.
          </p>
        </div>
        <a
          href={CONTACT_FORM_URL}
          target="_blank"
          rel="noreferrer"
          className="block w-full text-center py-3 rounded-2xl bg-brand text-primary-foreground font-semibold text-sm"
        >
          Contactar soporte
        </a>
      </div>
      </div>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" /> {label}</span>
      <span className="font-medium text-card-foreground">{value}</span>
    </div>
  );
}

// ── Platform-owner panel (ACACIA) ────────────────────────────────────────────
export default function LicenseAdmin() {
  const queryClient = useQueryClient();
  const session = useSubscription();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  const [payForm, setPayForm] = useState({
    payment_period: currentPeriod(),
    payment_reference: '',
    payment_notes: '',
    license_tier: 'start',
    license_expires_at: '',
    auto_renewal: false,
    activation_fee_paid: false,
  });
  const [form, setForm] = useState({
    subscription_status: 'active',
    license_tier: 'start',
    payment_reference: '',
    activation_notes: '',
    license_expires_at: '',
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['licenseAdminSchools'],
    queryFn: async () => {
      const [schools, subs] = await Promise.all([
        base44.entities.School.list('-created_date', 200),
        base44.entities.SchoolSubscription.list('-created_date', 500),
      ]);
      const subBySchool = new Map();
      for (const s of subs) {
        // keep the most recent per school (list is already date-desc)
        if (!subBySchool.has(s.school_id)) subBySchool.set(s.school_id, s);
      }
      return schools.map((school) => ({ school, sub: subBySchool.get(school.id) || null }));
    },
    enabled: session.isPlatformOwner,
    staleTime: 20 * 1000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(({ school }) =>
      school.name?.toLowerCase().includes(q) || school.id?.toLowerCase().includes(q));
  }, [rows, search]);

  async function persistSubscription(school, sub, updateData) {
    let target = sub;
    if (target?.id) {
      await base44.entities.SchoolSubscription.update(target.id, updateData);
    } else {
      target = await base44.entities.SchoolSubscription.create({
        school_id: school.id,
        subscription_plan: 'monthly',
        ...updateData,
      });
    }
    // Best-effort audit trail (never block the operation on logging failure).
    try {
      if (session.userProfile) {
        await logAuditEvent({
          user: session.user,
          userProfile: session.userProfile,
          entity: 'SchoolSubscription',
          entityId: target.id || school.id,
          action: 'LICENSE_UPDATED',
          reason: 'license_admin',
          context: { school_id: school.id, update: updateData },
        });
      }
    } catch (err) {
      console.error('license_audit_failed', String(err?.message || err));
    }
    return target;
  }

  const confirmPaymentMutation = useMutation({
    mutationFn: async () => {
      const updateData = buildPaymentConfirmationUpdate({
        subscription: selected.sub,
        license_tier: payForm.license_tier,
        payment_reference: payForm.payment_reference || undefined,
        payment_period: payForm.payment_period,
        payment_notes: payForm.payment_notes || undefined,
        license_expires_at: payForm.license_expires_at || undefined,
        auto_renewal: payForm.auto_renewal,
        activation_fee_paid: payForm.activation_fee_paid || undefined,
        adminEmail: session.user?.email,
      });
      return persistSubscription(selected.school, selected.sub, updateData);
    },
    onSuccess: () => {
      toast.success('Pago confirmado y licencia actualizada');
      queryClient.invalidateQueries({ queryKey: ['licenseAdminSchools'] });
      setSelected(null);
    },
    onError: (err) => toast.error(`Error al confirmar pago: ${err?.message || err}`),
  });

  const activateMutation = useMutation({
    mutationFn: async () => {
      const updateData = buildActivationUpdate({
        subscription_status: form.subscription_status,
        license_tier: form.license_tier,
        payment_reference: form.payment_reference || undefined,
        activation_notes: form.activation_notes || undefined,
        license_expires_at: form.license_expires_at || undefined,
        adminEmail: session.user?.email,
      });
      return persistSubscription(selected.school, selected.sub, updateData);
    },
    onSuccess: () => {
      toast.success('Licencia actualizada');
      queryClient.invalidateQueries({ queryKey: ['licenseAdminSchools'] });
      setSelected(null);
    },
    onError: (err) => toast.error(`Error al actualizar: ${err?.message || err}`),
  });

  if (session.isLoading) return <LoadingScreen message="Cargando licencias..." />;
  if (!session.isPlatformOwner) return <SchoolLicenseView />;

  function handleSelect(row) {
    const sub = row.sub;
    setSelected(row);
    setForm({
      subscription_status: sub?.subscription_status || 'trial',
      license_tier: sub?.license_tier || 'start',
      payment_reference: sub?.payment_reference || '',
      activation_notes: '',
      license_expires_at: sub?.license_expires_at ? sub.license_expires_at.slice(0, 10) : '',
    });
    setPayForm({
      payment_period: currentPeriod(),
      payment_reference: sub?.payment_reference || '',
      payment_notes: '',
      license_tier: sub?.license_tier || 'start',
      license_expires_at: '',
      auto_renewal: sub?.auto_renewal ?? false,
      activation_fee_paid: sub?.activation_fee_paid ?? false,
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 pb-24">
      <PageHeader title="Licencias LIUMA" subtitle="Panel interno ACACIA" />

      <div className="space-y-4 max-w-2xl mx-auto">
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl">
          <Shield className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <p className="text-xs font-semibold text-amber-700">
            Panel interno — ACACIA Consultoría · Solo el propietario de la plataforma
          </p>
        </div>

        {!isLoading && rows.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {SUMMARY_STATUSES.map((s) => {
              const count = rows.filter(({ sub }) => (sub?.subscription_status || 'trial') === s).length;
              const cfg = STATUS_CONFIG[s];
              return (
                <div key={s} className={`rounded-xl p-2.5 text-center ${cfg.color}`}>
                  <p className="text-xl font-black">{count}</p>
                  <p className="text-[10px] font-semibold">{cfg.label}</p>
                </div>
              );
            })}
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o ID de escuela..."
            className="w-full pl-9 pr-4 py-2.5 bg-card border border-border rounded-xl text-sm outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">No se encontraron escuelas.</p>
        ) : (
          <div className="space-y-2">
            {filtered.map((row) => {
              const { school, sub } = row;
              const status = sub?.subscription_status || 'trial';
              const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.trial;
              const StatusIcon = cfg.icon;
              const daysLeft = sub?.trial_end_date && status === 'trial'
                ? Math.max(0, Math.ceil((new Date(sub.trial_end_date) - new Date()) / 86400000))
                : null;
              return (
                <button
                  key={school.id}
                  onClick={() => handleSelect(row)}
                  className="w-full text-left bg-card text-card-foreground border border-border rounded-2xl p-4 hover:border-brand/30 transition-colors shadow-sm"
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-semibold text-sm text-card-foreground">{school.name}</p>
                    <div className="flex items-center gap-2">
                      {sub?.auto_renewal && (
                        <span className="flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full text-emerald-600 bg-emerald-50">
                          <RefreshCw className="w-2.5 h-2.5" /> MP
                        </span>
                      )}
                      <span className={`flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${cfg.color}`}>
                        <StatusIcon className="w-3 h-3" /> {cfg.label}
                      </span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" /> {sub?.licensed_student_limit ?? '—'} alumnos lic.
                    </span>
                    <span>Tier: <span className="font-medium text-card-foreground">{planLabel(sub?.license_tier)}</span></span>
                    {daysLeft !== null && (
                      <span className={daysLeft <= 7 ? 'text-orange-500 font-semibold' : ''}>{daysLeft}d restantes</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 text-[11px] text-muted-foreground mt-1">
                    <span>ID: <span className="font-mono text-muted-foreground break-all">{school.id}</span></span>
                    {sub?.license_expires_at && (
                      <span>Vence: <span className="font-medium text-card-foreground">{fmt(sub.license_expires_at)}</span></span>
                    )}
                    {sub?.last_payment_period && (
                      <span>Último pago: <span className="font-medium text-card-foreground">{sub.last_payment_period}</span></span>
                    )}
                  </div>
                  {!sub && (
                    <p className="text-[11px] text-amber-600 mt-1 italic">Sin suscripción — se creará al confirmar.</p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setSelected(null)} />
          <div
            className="fixed inset-x-4 top-[3%] z-[51] max-w-md mx-auto bg-card text-card-foreground rounded-3xl border border-border shadow-2xl overflow-y-auto"
            style={{ maxHeight: '94vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-border flex items-center justify-between sticky top-0 bg-card z-10">
              <div className="min-w-0 pr-2">
                <h3 className="font-bold text-card-foreground truncate">{selected.school.name}</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">ID: <span className="font-mono break-all">{selected.school.id}</span></p>
              </div>
              <button onClick={() => setSelected(null)} className="p-1.5 rounded-xl bg-muted">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <div className="p-5 space-y-6">
              {/* SECTION 1: Confirmar pago */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <h4 className="text-sm font-bold text-emerald-800">Confirmación de pago</h4>
                </div>
                <p className="text-[11px] text-emerald-700 -mt-2">
                  Confirma el pago recibido en Mercado Pago. LIUMA actualizará la licencia.
                </p>

                <Field label="Período de pago (YYYY-MM)">
                  <input
                    value={payForm.payment_period}
                    onChange={(e) => setPayForm((f) => ({ ...f, payment_period: e.target.value }))}
                    placeholder="2026-06"
                    className={INPUT_CLASS}
                  />
                </Field>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-2 block">Tipo de licencia</label>
                  <div className="space-y-2">
                    {PLAN_OPTIONS.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setPayForm((f) => ({ ...f, license_tier: p.id }))}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm transition-all ${
                          payForm.license_tier === p.id
                            ? 'bg-brand/10 border-brand/30 text-brand font-semibold'
                            : 'bg-card border-border text-card-foreground hover:bg-muted'
                        }`}
                      >
                        <div className="text-left">
                          <p className="font-semibold text-sm">{p.label}</p>
                          <p className="text-[11px] text-muted-foreground">{p.desc}</p>
                        </div>
                        <span className={`text-xs font-bold ${payForm.license_tier === p.id ? 'text-brand' : 'text-muted-foreground'}`}>{p.price}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <Field label="Referencia de pago (Mercado Pago)">
                  <input
                    value={payForm.payment_reference}
                    onChange={(e) => setPayForm((f) => ({ ...f, payment_reference: e.target.value }))}
                    placeholder="ID transacción, folio, nota..."
                    className={INPUT_CLASS}
                  />
                </Field>

                <Field label="Notas internas ACACIA">
                  <input
                    value={payForm.payment_notes}
                    onChange={(e) => setPayForm((f) => ({ ...f, payment_notes: e.target.value }))}
                    placeholder="Observaciones del pago..."
                    className={INPUT_CLASS}
                  />
                </Field>

                <Field label="Vencimiento (vacío = +1 mes automático)">
                  <input
                    type="date"
                    value={payForm.license_expires_at}
                    onChange={(e) => setPayForm((f) => ({ ...f, license_expires_at: e.target.value }))}
                    className={`${INPUT_CLASS} cursor-pointer`}
                  />
                </Field>

                <ToggleField
                  active={payForm.auto_renewal}
                  onToggle={() => setPayForm((f) => ({ ...f, auto_renewal: !f.auto_renewal }))}
                  onLabel="Suscripción Mercado Pago activa ✓"
                  offLabel="Sin suscripción Mercado Pago"
                  hint="El cobro se gestiona en Mercado Pago. La renovación de acceso en LIUMA se confirma manualmente por ACACIA."
                />

                <ToggleField
                  active={payForm.activation_fee_paid}
                  onToggle={() => setPayForm((f) => ({ ...f, activation_fee_paid: !f.activation_fee_paid }))}
                  onLabel={`Cuota de activación cubierta (${ACTIVATION_FEE.label}) ✓`}
                  offLabel={`Cuota de activación pendiente (${ACTIVATION_FEE.label})`}
                  hint={ACTIVATION_FEE.desc}
                />

                <button
                  onClick={() => confirmPaymentMutation.mutate()}
                  disabled={confirmPaymentMutation.isPending || !payForm.payment_period}
                  className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2 min-h-[52px] transition-colors"
                >
                  {confirmPaymentMutation.isPending
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Confirmando...</>
                    : <><CheckCircle className="w-4 h-4" /> Confirmar pago recibido</>}
                </button>
              </div>

              {/* SECTION 2: Ajuste general */}
              <div className="border border-border rounded-2xl p-4 space-y-4">
                <h4 className="text-sm font-bold text-card-foreground">Ajuste general de licencia</h4>
                <p className="text-[11px] text-muted-foreground -mt-2">Cambia el estado o datos administrativos sin confirmar un pago.</p>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-2 block">Estado</label>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(STATUS_CONFIG).map(([s, cfg]) => (
                      <button
                        key={s}
                        onClick={() => setForm((f) => ({ ...f, subscription_status: s }))}
                        className={`py-2 px-2 rounded-xl text-xs font-semibold border transition-all ${
                          form.subscription_status === s
                            ? 'bg-brand text-primary-foreground border-brand'
                            : 'bg-muted text-muted-foreground border-transparent hover:bg-secondary'
                        }`}
                      >
                        {cfg.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-2 block">Tipo de licencia</label>
                  <div className="grid grid-cols-3 gap-2">
                    {PLAN_OPTIONS.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setForm((f) => ({ ...f, license_tier: p.id }))}
                        className={`py-2 px-2 rounded-xl text-xs font-semibold border transition-all ${
                          form.license_tier === p.id
                            ? 'bg-brand text-primary-foreground border-brand'
                            : 'bg-muted text-muted-foreground border-transparent hover:bg-secondary'
                        }`}
                      >
                        {p.label.replace('LIUMA ', '')}
                      </button>
                    ))}
                  </div>
                </div>

                <Field label="Referencia de pago">
                  <input
                    value={form.payment_reference}
                    onChange={(e) => setForm((f) => ({ ...f, payment_reference: e.target.value }))}
                    placeholder="Folio, número de transacción, etc."
                    className={INPUT_CLASS}
                  />
                </Field>

                <Field label="Notas de activación (internas)">
                  <input
                    value={form.activation_notes}
                    onChange={(e) => setForm((f) => ({ ...f, activation_notes: e.target.value }))}
                    placeholder="Observaciones para el registro interno..."
                    className={INPUT_CLASS}
                  />
                </Field>

                <Field label="Vencimiento de licencia (opcional)">
                  <input
                    type="date"
                    value={form.license_expires_at}
                    onChange={(e) => setForm((f) => ({ ...f, license_expires_at: e.target.value }))}
                    className={`${INPUT_CLASS} cursor-pointer`}
                  />
                </Field>

                <button
                  onClick={() => activateMutation.mutate()}
                  disabled={activateMutation.isPending}
                  className="w-full py-3.5 rounded-2xl bg-brand hover:bg-brand/90 text-primary-foreground font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2 min-h-[52px] transition-colors"
                >
                  {activateMutation.isPending
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</>
                    : <><CheckCircle className="w-4 h-4" /> Confirmar cambio</>}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      </div>
    </div>
  );
}

const INPUT_CLASS = 'w-full bg-card border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30';

function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">{label}</label>
      {children}
    </div>
  );
}

function ToggleField({ active, onToggle, onLabel, offLabel, hint }) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all text-left ${
        active ? 'bg-emerald-100 border-emerald-300' : 'bg-card border-border'
      }`}
    >
      <div>
        <p className={`text-sm font-semibold ${active ? 'text-emerald-700' : 'text-muted-foreground'}`}>
          {active ? onLabel : offLabel}
        </p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      {active
        ? <ToggleRight className="w-6 h-6 text-emerald-600 flex-shrink-0" />
        : <ToggleLeft className="w-6 h-6 text-muted-foreground flex-shrink-0" />}
    </button>
  );
}
