import React, { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { schoolRead } from '@/lib/data/schoolRead';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import ChargeAmounts from '@/components/payments/ChargeAmounts';
import EmptyState from '@/components/ui/EmptyState';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { CreditCard, Plus, DollarSign, Receipt, Loader2, CheckCircle, AlertTriangle, Clock, User, Calendar, Send } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { createPageUrl } from '@/utils';
import { toast } from "sonner";
import { AUDIT_ENTITIES, logAuditEvent } from '@/lib/audit';
import { notificationService } from '@/lib/notifications/service';
import ReadOnlyBanner from '@/components/subscription/ReadOnlyBanner';
import { useCanWrite, guardWrite } from '@/hooks/useCanWrite';
import { guardedCreate, guardedUpdate } from '@/lib/authorization/guardedWrite';
import { parseLocalDate, schoolToday } from '@/lib/dates';
import {
  CHARGE_STATUS,
  isPaymentReminderDue,
  partitionCharges,
  selectChargesToMarkOverdue,
} from '@/lib/payments/overdue';
import {
  CONCEPT_TYPES,
  CONCEPT_TYPE_LABELS,
  centsToAmount,
  chargeBalance,
  chargeBalanceCents,
  chargePaid,
  discountApplies,
  formatMoney,
  manualReminderAvailableAt,
  parseAmountCents,
  priceCharge,
} from '@/lib/payments/money';
import { humanizeError } from '@/lib/errorMessages';
import { formatDeliverySummary, hasUndelivered } from '@/lib/notifications/fanout';
import { functionErrorCode } from '@/lib/functionResponse';
import { useSchoolStudents } from '@/hooks/useSchoolStudents';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

export default function PagosAdmin() {
  const queryClient = useQueryClient();
  const { canWrite } = useCanWrite();
  const blockReadOnly = () => toast.error('Tu licencia está en modo solo lectura. Reactívala para registrar pagos o cargos.');
  const [activeTab, setActiveTab] = useState('pending');
  const [showConceptForm, setShowConceptForm] = useState(false);
  const [showChargeForm, setShowChargeForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [selectedCharge, setSelectedCharge] = useState(null);
  
  const [conceptForm, setConceptForm] = useState({ name: '', default_amount: '', concept_type: 'COLEGIATURA' });
  const [chargeForm, setChargeForm] = useState({ student_id: '', concept_id: '', amount: '', due_date: '' });
  const [paymentForm, setPaymentForm] = useState({ amount: '', payment_method: 'cash', reference: '' });
  const [paymentError, setPaymentError] = useState('');

  const { user, userProfile } = useCurrentProfile();

  const { data: discounts = [], isFetching: discountsLoading } = useQuery({
    queryKey: ['discounts', userProfile?.school_id, 'active'],
    queryFn: () => schoolRead('Discount', { school_id: userProfile.school_id, is_active: true }),
    enabled: !!userProfile && showChargeForm,
  });

  const { data: concepts = [] } = useQuery({
    queryKey: ['paymentConcepts', userProfile?.school_id],
    queryFn: () => schoolRead('PaymentConcept', { 
      school_id: userProfile.school_id,
      is_active: true 
    }),
    enabled: !!userProfile,
  });

  const { data: students = [] } = useSchoolStudents(userProfile?.school_id);
  const { data: charges = [], isLoading } = useQuery({
    queryKey: ['allCharges', userProfile?.school_id],
    queryFn: async () => {
      const allCharges = await schoolRead('ChargeItem', { 
        school_id: userProfile.school_id 
      }, '-due_date');
      
      // Persist OVERDUE for charges whose due date has passed. The server
      // derives the status itself (guardedEntityWrite re-sums the payments),
      // so this is a "refresh it" request and we keep whatever it answered.
      // Best-effort: the tabs and counts come from partitionCharges(), which
      // already treats a PENDING/PARTIAL charge past its due date as overdue,
      // so a failed write (e.g. a read-only license) never makes a late
      // charge look current.
      const toMark = selectChargesToMarkOverdue(allCharges);
      const results = await Promise.allSettled(
        toMark.map((charge) => guardedUpdate('ChargeItem', charge.id, { status: CHARGE_STATUS.OVERDUE })),
      );
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) Object.assign(toMark[index], result.value);
        else if (result.status === 'rejected') console.error('Error updating charge status:', result.reason);
      });

      return allCharges;
    },
    enabled: !!userProfile,
  });

  const createConceptMutation = useMutation({
    mutationFn: (data) => guardedCreate('PaymentConcept', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paymentConcepts'] });
      toast.success('Concepto creado');
      setShowConceptForm(false);
      setConceptForm({ name: '', default_amount: '', concept_type: 'COLEGIATURA' });
    },
    onError: (error) => toast.error(humanizeError(error)),
  });

  const createChargeMutation = useMutation({
    mutationFn: async (data) => {
      const charge = await guardedCreate('ChargeItem', data);
      await logAuditEvent({
        user,
        userProfile,
        entity: AUDIT_ENTITIES.CHARGE_ITEM,
        entityId: charge.id,
        action: 'CHARGE_CREATED',
        reason: 'Admin payment charge creation',
        context: { student_id: data.student_id, amount: charge?.amount, due_date: data.due_date, discount_id: charge?.discount_id || null }
      });
      return charge;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allCharges'] });
      queryClient.invalidateQueries({ queryKey: ['overdueCharges'] });
      toast.success('Cargo creado');
      setShowChargeForm(false);
      setChargeForm({ student_id: '', concept_id: '', amount: '', due_date: '' });
    },
    onError: (error) => toast.error(humanizeError(error)),
  });

  // ONE write: the payment. The server checks it against what is still owed
  // and re-derives the charge (PAID only when the payments cover it, PARTIAL
  // otherwise). This used to mark the charge PAID first, whatever amount was
  // typed — $400 on a $1,000 charge closed it — and before the payment even
  // existed, so a failed create left a PAID charge with no payment behind it.
  const recordPaymentMutation = useMutation({
    mutationFn: async (data) => {
      const payment = await guardedCreate('PaymentRecord', data);
      await logAuditEvent({
        user,
        userProfile,
        entity: AUDIT_ENTITIES.PAYMENT_RECORD,
        entityId: payment.id,
        action: 'PAYMENT_RECORDED',
        reason: 'Admin payment registration',
        context: { charge_id: selectedCharge.id, amount: data.amount, payment_method: data.payment_method }
      });
      return payment;
    },
    onSuccess: (_payment, data) => {
      queryClient.invalidateQueries({ queryKey: ['allCharges'] });
      queryClient.invalidateQueries({ queryKey: ['overdueCharges'] });
      const left = selectedCharge ? chargeBalanceCents(selectedCharge) - (parseAmountCents(data.amount).cents || 0) : 0;
      toast.success(left > 0 ? `Abono registrado. Saldo pendiente: ${formatMoney(centsToAmount(left))}` : 'Pago registrado. El cargo quedó liquidado.');
      setShowPaymentForm(false);
      setSelectedCharge(null);
      setPaymentForm({ amount: '', payment_method: 'cash', reference: '' });
      setPaymentError('');
    },
    onError: (error) => {
      // The balance moved under us (another device recorded a payment): reload
      // so the form shows the real one.
      if (['OVERPAYMENT', 'CHARGE_ALREADY_PAID'].includes(functionErrorCode(error))) {
        queryClient.invalidateQueries({ queryKey: ['allCharges'] });
      }
      setPaymentError(humanizeError(error));
    },
  });

  // "Enviar recordatorio": the director reminds a family by hand — the only
  // way an OVERDUE charge is ever reminded. The server sends it to the
  // student's ACTIVE parents, asks for the BALANCE, and allows one per charge
  // per day (REMINDER_COOLDOWN).
  const reminderMutation = useMutation({
    mutationFn: (charge) => notificationService.sendBulk({ eventType: 'payment_due', chargeId: charge.id, manual: true }),
    onSuccess: (summary) => {
      queryClient.invalidateQueries({ queryKey: ['allCharges'] });
      if (summary?.skipped) {
        toast.info('Este cargo ya no tiene saldo pendiente; no se envió recordatorio.');
        return;
      }
      const line = formatDeliverySummary(summary) || 'Recordatorio enviado.';
      if (hasUndelivered(summary)) toast.warning(`${line} Revisa que la familia tenga correo registrado.`);
      else toast.success(`Recordatorio enviado. ${line}`);
    },
    onError: (error) => toast.error(humanizeError(error)),
  });

  const conceptAmount = parseAmountCents(conceptForm.default_amount, { allowZero: true });
  const chargeConcept = concepts.find((c) => c.id === chargeForm.concept_id) || null;

  // The discount this charge would get — same rule the server applies
  // (discountApplies + priceCharge, mirrored in src/lib/payments/money.js):
  // active, in its date window, for this concept's TYPE, never more than the
  // charge. The server re-checks it and computes the amounts itself.
  const chargePreview = useMemo(() => {
    const original = parseAmountCents(chargeForm.amount);
    if (!original.ok) return { ok: false };
    const conceptType = chargeConcept?.concept_type || 'OTRO';
    const today = schoolToday();
    const discount = discounts.find((d) =>
      discountApplies(d, { conceptType, today, allowsDiscounts: chargeConcept?.allows_discounts }).ok) || null;
    return { ok: true, discount, ...priceCharge(original.cents, discount) };
  }, [chargeForm.amount, chargeConcept, discounts]);

  const handleCreateConcept = (e) => {
    e.preventDefault();
    if (!guardWrite(canWrite, blockReadOnly)) return;
    if (!conceptAmount.ok) {
      toast.error('Escribe un monto válido: 0 o más, con dos decimales como máximo.');
      return;
    }
    createConceptMutation.mutate({
      name: conceptForm.name.trim(),
      concept_type: conceptForm.concept_type,
      default_amount: centsToAmount(conceptAmount.cents),
      school_id: userProfile.school_id,
      is_active: true,
    });
  };

  const handleCreateCharge = async (e) => {
    e.preventDefault();
    if (!guardWrite(canWrite, blockReadOnly)) return;
    if (concepts.length === 0) {
      toast.error('Debes configurar al menos un concepto de pago antes de crear cargos.');
      return;
    }
    if (!chargePreview.ok) {
      toast.error('Escribe un monto mayor que 0, con dos decimales como máximo.');
      return;
    }
    // Only WHAT to charge: the server prices it (concept type from the
    // stored concept, the named discount re-checked and clamped, amount =
    // net) and sets its status. A $500 discount on a $300 charge used to be
    // saved as amount -200.
    createChargeMutation.mutate({
      student_id: chargeForm.student_id,
      concept_id: chargeForm.concept_id,
      concept_name: chargeConcept?.name || '',
      original_amount: centsToAmount(chargePreview.originalCents),
      discount_id: chargePreview.discount?.id || null,
      due_date: chargeForm.due_date,
      school_id: userProfile.school_id,
    });
  };

  const handleRecordPayment = (e) => {
    e.preventDefault();
    if (!guardWrite(canWrite, blockReadOnly)) return;
    const amount = parseAmountCents(paymentForm.amount);
    const balanceCents = chargeBalanceCents(selectedCharge);
    if (!amount.ok) {
      setPaymentError('Escribe un monto mayor que 0, con dos decimales como máximo.');
      return;
    }
    if (amount.cents > balanceCents) {
      setPaymentError(`El monto es mayor que el saldo pendiente (${formatMoney(centsToAmount(balanceCents))}).`);
      return;
    }
    setPaymentError('');
    recordPaymentMutation.mutate({
      school_id: userProfile.school_id,
      charge_id: selectedCharge.id,
      amount: centsToAmount(amount.cents),
      // No payment_date: the server stamps today's MEXICO day. A browser in
      // another time zone (or with a wrong clock) would otherwise send
      // "tomorrow" and get INVALID_PAYMENT_DATE for money received today.
      payment_method: paymentForm.payment_method,
      reference: paymentForm.reference,
    });
  };

  const openPaymentForm = (charge) => {
    setSelectedCharge(charge);
    // The default is what is still owed, not the charge's full amount.
    setPaymentForm({ amount: centsToAmount(chargeBalanceCents(charge)).toFixed(2), payment_method: 'cash', reference: '' });
    setPaymentError('');
    setShowPaymentForm(true);
  };

  const sendReminder = (charge) => {
    if (!guardWrite(canWrite, blockReadOnly)) return;
    reminderMutation.mutate(charge);
  };

  const getStudentName = (studentId) => {
    const student = students.find(s => s.id === studentId);
    return student ? `${student.first_name} ${student.last_name}` : '';
  };

  // Same "vencido" rule as the admin home (src/lib/payments/overdue.js), so
  // both screens always show the same number.
  const { pending: pendingCharges, overdue: overdueCharges, paid: paidCharges } = useMemo(
    () => partitionCharges(charges),
    [charges],
  );

  // Charges already handled in this session. The effect below re-runs whenever
  // the query data changes; without this a charge could be reminded twice
  // before its reminder_sent write lands. A failed attempt is NOT retried in
  // the same session: if the emails went out but the reminder_sent write
  // failed, retrying on every re-render would mail the parents again each time.
  const remindersHandled = useRef(new Set());

  // Enviar recordatorio automático para pagos próximos a vencer (dentro de los
  // 7 días previos; ver isPaymentReminderDue). The fan-out runs server-side in
  // sendBulkNotification (P8, wired at integration): the client names the
  // charge, and the server re-checks the caller is an ACTIVE ADMIN of the
  // charge's stored school, resolves the parents through ParentStudent, applies
  // the school's notification_preferences and writes reminder_sent itself. The
  // old browser loop read parents' emails from the client User directory, which
  // only ever returns the caller's own row — so no parent was ever emailed.
  React.useEffect(() => {
    // Read-only license: the server would refuse to mark reminder_sent, and
    // every load would try the same reminder again.
    if (!canWrite || !userProfile?.school_id || !user) return;
    const due = pendingCharges.filter(
      (charge) => isPaymentReminderDue(charge) && !remindersHandled.current.has(charge.id),
    );
    if (due.length === 0) return;
    due.forEach((charge) => remindersHandled.current.add(charge.id));

    const sendReminders = async () => {
      for (const charge of due) {
        try {
          await notificationService.sendBulk({ eventType: 'payment_due', chargeId: charge.id });
        } catch (error) {
          console.error('Error sending payment reminder:', error);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['allCharges'] });
    };

    sendReminders();
  }, [pendingCharges, userProfile, user, canWrite, queryClient]);

  if (isLoading) return <LoadingScreen message="Cargando..." />;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 pb-24">
      <PageHeader
        eyebrow="Administración"
        title="Pagos"
        showBack
        backTo={createPageUrl('Home')}
      />
      <ReadOnlyBanner />
      {concepts.length === 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Primero crea al menos un concepto de pago; después podrás generar cargos para los alumnos.
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-card text-card-foreground rounded-2xl p-3 text-center border border-border shadow-sm">
          <Clock className="w-5 h-5 text-amber-500 mx-auto mb-1" />
          <p className="text-lg font-bold">{pendingCharges.length}</p>
          <p className="text-xs text-muted-foreground">Pendientes</p>
        </div>
        <div className="bg-card text-card-foreground rounded-2xl p-3 text-center border border-border shadow-sm">
          <AlertTriangle className="w-5 h-5 text-red-500 mx-auto mb-1" />
          <p className="text-lg font-bold">{overdueCharges.length}</p>
          <p className="text-xs text-muted-foreground">Vencidos</p>
        </div>
        <div className="bg-card text-card-foreground rounded-2xl p-3 text-center border border-border shadow-sm">
          <CheckCircle className="w-5 h-5 text-green-500 mx-auto mb-1" />
          <p className="text-lg font-bold">{paidCharges.length}</p>
          <p className="text-xs text-muted-foreground">Pagados</p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 mb-6">
        <Button onClick={() => setShowConceptForm(true)} variant="outline" size="sm" className="gap-1">
          <Receipt className="w-4 h-4" /> Concepto
        </Button>
        <Button onClick={() => setShowChargeForm(true)} className="gap-1" size="sm">
          <Plus className="w-4 h-4" /> Nuevo cargo
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full mb-4">
          <TabsTrigger value="pending" className="flex-1">Pendientes</TabsTrigger>
          <TabsTrigger value="overdue" className="flex-1">Vencidos</TabsTrigger>
          <TabsTrigger value="paid" className="flex-1">Pagados</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          {pendingCharges.length === 0 ? (
            <EmptyState icon={CreditCard} title="Sin cargos pendientes" />
          ) : (
            <div className="space-y-3">
              {pendingCharges.map((charge) => (
                <ChargeCard
                  key={charge.id}
                  charge={charge}
                  studentName={getStudentName(charge.student_id)}
                  onRecordPayment={() => openPaymentForm(charge)}
                  onSendReminder={() => sendReminder(charge)}
                  reminderSending={reminderMutation.isPending && reminderMutation.variables?.id === charge.id}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="overdue">
          {overdueCharges.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="Sin cargos vencidos" />
          ) : (
            <div className="space-y-3">
              {overdueCharges.map((charge) => (
                <ChargeCard
                  key={charge.id}
                  charge={charge}
                  studentName={getStudentName(charge.student_id)}
                  onRecordPayment={() => openPaymentForm(charge)}
                  onSendReminder={() => sendReminder(charge)}
                  reminderSending={reminderMutation.isPending && reminderMutation.variables?.id === charge.id}
                  isOverdue
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="paid">
          {paidCharges.length === 0 ? (
            <EmptyState icon={CheckCircle} title="Sin pagos registrados" />
          ) : (
            <div className="space-y-3">
              {paidCharges.slice(0, 20).map((charge) => (
                <ChargeCard
                  key={charge.id}
                  charge={charge}
                  studentName={getStudentName(charge.student_id)}
                  isPaid
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Create Concept Modal */}
      <Dialog open={showConceptForm} onOpenChange={setShowConceptForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo concepto de pago</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateConcept} className="space-y-4">
            <div>
              <Label>Nombre *</Label>
              <Input
                value={conceptForm.name}
                onChange={(e) => setConceptForm({ ...conceptForm, name: e.target.value })}
                placeholder="Ej: Colegiatura, Inscripción..."
                className="mt-1"
              />
            </div>
            <div>
              <Label>Tipo de concepto *</Label>
              <Select
                value={conceptForm.concept_type}
                onValueChange={(value) => setConceptForm({ ...conceptForm, concept_type: value })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONCEPT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>{CONCEPT_TYPE_LABELS[type]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Los descuentos se aplican según este tipo.</p>
            </div>
            <div>
              <Label>Monto por defecto *</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={conceptForm.default_amount}
                onChange={(e) => setConceptForm({ ...conceptForm, default_amount: e.target.value })}
                placeholder="0.00"
                className="mt-1"
                aria-invalid={conceptForm.default_amount !== '' && !conceptAmount.ok}
              />
              {conceptForm.default_amount !== '' && !conceptAmount.ok && (
                <p className="text-xs text-destructive mt-1">Monto no válido: 0 o más, con dos decimales como máximo.</p>
              )}
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="outline" onClick={() => setShowConceptForm(false)} className="flex-1">
                Cancelar
              </Button>
              <Button type="submit" disabled={!conceptForm.name.trim() || !conceptAmount.ok || createConceptMutation.isPending} className="flex-1">
                {createConceptMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Crear'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create Charge Modal */}
      <Dialog open={showChargeForm} onOpenChange={setShowChargeForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo cargo</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateCharge} className="space-y-4">
            <div>
              <Label>Alumno *</Label>
              <Select
                value={chargeForm.student_id}
                onValueChange={(value) => setChargeForm({ ...chargeForm, student_id: value })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Seleccionar alumno" />
                </SelectTrigger>
                <SelectContent>
                  {students.map((student) => (
                    <SelectItem key={student.id} value={student.id}>
                      {student.first_name} {student.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Concepto *</Label>
              <Select
                value={chargeForm.concept_id}
                onValueChange={(value) => {
                  const concept = concepts.find(c => c.id === value);
                  setChargeForm({ 
                    ...chargeForm, 
                    concept_id: value,
                    amount: concept?.default_amount?.toString() || ''
                  });
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Seleccionar concepto" />
                </SelectTrigger>
                <SelectContent>
                  {concepts.map((concept) => (
                    <SelectItem key={concept.id} value={concept.id}>
                      {concept.name} · {CONCEPT_TYPE_LABELS[concept.concept_type] || CONCEPT_TYPE_LABELS.OTRO} ({formatMoney(concept.default_amount)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Monto *</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={chargeForm.amount}
                onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })}
                placeholder="0.00"
                className="mt-1"
                aria-invalid={chargeForm.amount !== '' && !chargePreview.ok}
              />
              {chargeForm.amount !== '' && !chargePreview.ok && (
                <p className="text-xs text-destructive mt-1">Monto no válido: mayor que 0, con dos decimales como máximo.</p>
              )}
              {chargePreview.ok && chargePreview.discount && (
                <div className="mt-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground space-y-0.5">
                  <p>Monto original: {formatMoney(centsToAmount(chargePreview.originalCents))}</p>
                  <p>Descuento «{chargePreview.discount.name}»: −{formatMoney(centsToAmount(chargePreview.discountCents))}</p>
                  <p className="font-semibold text-foreground">Total a pagar: {formatMoney(centsToAmount(chargePreview.amountCents))}</p>
                </div>
              )}
            </div>
            <div>
              <Label>Fecha de vencimiento *</Label>
              <Input
                type="date"
                value={chargeForm.due_date}
                onChange={(e) => setChargeForm({ ...chargeForm, due_date: e.target.value })}
                className="mt-1"
              />
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="outline" onClick={() => setShowChargeForm(false)} className="flex-1">
                Cancelar
              </Button>
              <Button 
                type="submit" 
                disabled={!chargeForm.student_id || !chargeForm.concept_id || !chargePreview.ok || !chargeForm.due_date || discountsLoading || createChargeMutation.isPending}
                className="flex-1"
              >
                {createChargeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Crear cargo'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Record Payment Modal */}
      <Dialog open={showPaymentForm} onOpenChange={setShowPaymentForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar pago</DialogTitle>
          </DialogHeader>
          {selectedCharge && (
            <form onSubmit={handleRecordPayment} className="space-y-4">
              <div className="bg-muted rounded-xl p-4">
                <p className="font-medium text-foreground">{getStudentName(selectedCharge.student_id)}</p>
                <p className="text-sm text-muted-foreground">{selectedCharge.concept_name}</p>
                <ChargeAmounts charge={selectedCharge} className="mt-2" />
              </div>
              <div>
                <Label>Monto recibido *</Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={paymentForm.amount}
                  onChange={(e) => { setPaymentForm({ ...paymentForm, amount: e.target.value }); setPaymentError(''); }}
                  className="mt-1"
                  aria-invalid={!!paymentError}
                  aria-describedby="payment-amount-help"
                />
                <p id="payment-amount-help" className="text-xs text-muted-foreground mt-1">
                  Puedes registrar un abono: el cargo queda como «Pago parcial» hasta cubrir el saldo.
                </p>
                {paymentError && <p role="alert" className="text-xs text-destructive mt-1">{paymentError}</p>}
              </div>
              <div>
                <Label>Método de pago</Label>
                <Select
                  value={paymentForm.payment_method}
                  onValueChange={(value) => setPaymentForm({ ...paymentForm, payment_method: value })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Efectivo</SelectItem>
                    <SelectItem value="transfer">Transferencia</SelectItem>
                    <SelectItem value="card">Tarjeta</SelectItem>
                    <SelectItem value="other">Otro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Referencia (opcional)</Label>
                <Input
                  value={paymentForm.reference}
                  onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                  placeholder="No. de transferencia, recibo, etc."
                  className="mt-1"
                />
              </div>
              <div className="flex gap-3">
                <Button type="button" variant="outline" onClick={() => setShowPaymentForm(false)} className="flex-1">
                  Cancelar
                </Button>
                <Button 
                  type="submit" 
                  disabled={!paymentForm.amount || recordPaymentMutation.isPending}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  {recordPaymentMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Registrar pago'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}

// Date-only due date as the local calendar day. A missing or malformed value
// renders a fallback instead of letting date-fns throw "Invalid time value"
// and take the whole Pagos page down with it.
function formatDueDate(dueDate, pattern) {
  const date = parseLocalDate(dueDate);
  return date ? format(date, pattern, { locale: es }) : 'Sin fecha';
}

function ChargeCard({ charge, studentName, onRecordPayment, onSendReminder, reminderSending, isOverdue, isPaid }) {
  const isPartial = !isPaid && chargePaid(charge) > 0;
  const nextReminderAt = manualReminderAvailableAt(charge);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-card text-card-foreground rounded-2xl p-4 border shadow-sm ${
        isPaid ? 'border-green-200 dark:border-green-900' : isOverdue ? 'border-red-200 dark:border-red-900' : 'border-border'
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium text-card-foreground">{studentName}</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{charge.concept_name}</p>
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <Calendar className="w-3 h-3" />
            Vence: {formatDueDate(charge.due_date, "d MMM, yyyy")}
          </div>
        </div>
        <div className="text-right">
          <p className="font-bold text-lg">{formatMoney(isPaid ? charge.amount : chargeBalance(charge))}</p>
          {isPartial && <p className="text-xs text-muted-foreground">de {formatMoney(charge.amount)}</p>}
          <Badge className={
            isPaid ? 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300' :
            isOverdue ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300' :
            isPartial ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300' :
            'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
          }>
            {isPaid ? 'Pagado' : isOverdue ? (isPartial ? 'Vencido · parcial' : 'Vencido') : isPartial ? 'Pago parcial' : 'Pendiente'}
          </Badge>
        </div>
      </div>
      <ChargeAmounts charge={charge} className="mt-3" />
      {!isPaid && (
        <div className="flex flex-wrap gap-2 mt-3">
          <Button
            onClick={onRecordPayment}
            size="sm"
            className="flex-1 bg-green-600 hover:bg-green-700"
          >
            <DollarSign className="w-4 h-4 mr-1" /> Registrar pago
          </Button>
          {onSendReminder && (
            <Button
              onClick={onSendReminder}
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={reminderSending || nextReminderAt > 0}
              title={nextReminderAt > 0 ? 'Ya se envió un recordatorio de este cargo en las últimas 24 horas.' : 'Enviar por correo a la familia un recordatorio del saldo pendiente.'}
            >
              {reminderSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
              {nextReminderAt > 0 ? 'Ya recordado' : 'Enviar recordatorio'}
            </Button>
          )}
        </div>
      )}
    </motion.div>
  );
}
