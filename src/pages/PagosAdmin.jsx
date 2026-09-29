import React, { useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { CreditCard, Plus, DollarSign, Receipt, Loader2, CheckCircle, AlertTriangle, Clock, User, Calendar } from 'lucide-react';
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
import { formatLocalDate, isBeforeToday, parseLocalDate, startOfLocalDay } from '@/lib/dates';
import {
  isPaymentReminderDue,
  partitionCharges,
  selectChargesToMarkOverdue,
} from '@/lib/payments/overdue';
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
  
  const [conceptForm, setConceptForm] = useState({ name: '', default_amount: '' });
  const [chargeForm, setChargeForm] = useState({ student_id: '', concept_id: '', amount: '', due_date: '' });
  const [paymentForm, setPaymentForm] = useState({ amount: '', payment_method: 'cash', reference: '' });

  const { user, userProfile } = useCurrentProfile();

  const { data: concepts = [] } = useQuery({
    queryKey: ['paymentConcepts', userProfile?.school_id],
    queryFn: () => base44.entities.PaymentConcept.filter({ 
      school_id: userProfile.school_id,
      is_active: true 
    }),
    enabled: !!userProfile,
  });

  const { data: students = [] } = useSchoolStudents(userProfile?.school_id);
  const { data: charges = [], isLoading } = useQuery({
    queryKey: ['allCharges', userProfile?.school_id],
    queryFn: async () => {
      const allCharges = await base44.entities.ChargeItem.filter({ 
        school_id: userProfile.school_id 
      }, '-due_date');
      
      // Persist OVERDUE for charges whose due date has passed. Best-effort: the
      // tabs and counts come from partitionCharges(), which already treats a
      // PENDING charge past its due date as overdue, so a failed write (e.g. a
      // read-only license) never makes a late charge look current.
      const toMark = selectChargesToMarkOverdue(allCharges);
      const results = await Promise.allSettled(
        toMark.map((charge) => guardedUpdate('ChargeItem', charge.id, { status: 'OVERDUE' })),
      );
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') toMark[index].status = 'OVERDUE';
        else console.error('Error updating charge status:', result.reason);
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
      setConceptForm({ name: '', default_amount: '' });
    },
    onError: () => toast.error('No se pudo crear el concepto. Intenta de nuevo.'),
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
        context: { student_id: data.student_id, amount: data.amount, due_date: data.due_date }
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
    onError: () => toast.error('No se pudo crear el cargo. Intenta de nuevo.'),
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async (data) => {
      await guardedUpdate('ChargeItem', selectedCharge.id, { status: 'PAID' });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allCharges'] });
      queryClient.invalidateQueries({ queryKey: ['overdueCharges'] });
      toast.success('Pago registrado');
      setShowPaymentForm(false);
      setSelectedCharge(null);
      setPaymentForm({ amount: '', payment_method: 'cash', reference: '' });
    },
    onError: () => toast.error('No se pudo registrar el pago. Revisa el cargo e intenta de nuevo.'),
  });

  const handleCreateConcept = (e) => {
    e.preventDefault();
    if (!guardWrite(canWrite, blockReadOnly)) return;
    createConceptMutation.mutate({
      ...conceptForm,
      default_amount: parseFloat(conceptForm.default_amount),
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
    const concept = concepts.find(c => c.id === chargeForm.concept_id);
    
    // Buscar descuentos aplicables
    const discounts = await base44.entities.Discount.filter({
      school_id: userProfile.school_id,
      is_active: true
    });
    
    const originalAmount = parseFloat(chargeForm.amount);
    let discountAmount = 0;
    let applicableDiscount = null;
    const today = startOfLocalDay(new Date());

    // Buscar descuento aplicable al concepto
    for (const discount of discounts) {
      if (discount.applicable_to_concepts?.includes(concept?.concept_type)) {
        // Validar fechas de vigencia (fechas de calendario: un descuento
        // "hasta el 30" vale durante todo el 30).
        const validFrom = parseLocalDate(discount.valid_from);
        if (validFrom && validFrom > today) continue;
        if (discount.valid_until && isBeforeToday(discount.valid_until)) continue;
        
        // Calcular descuento
        if (discount.discount_type === 'PERCENTAGE') {
          discountAmount = originalAmount * (discount.discount_value / 100);
        } else {
          discountAmount = discount.discount_value;
        }
        applicableDiscount = discount;
        break;
      }
    }
    
    createChargeMutation.mutate({
      ...chargeForm,
      concept_name: concept?.name || '',
      concept_type: concept?.concept_type || 'OTRO',
      original_amount: originalAmount,
      discount_id: applicableDiscount?.id || null,
      discount_amount: discountAmount,
      amount: originalAmount - discountAmount,
      school_id: userProfile.school_id,
      status: 'PENDING',
    });
  };

  const handleRecordPayment = (e) => {
    e.preventDefault();
    if (!guardWrite(canWrite, blockReadOnly)) return;
    recordPaymentMutation.mutate({
      school_id: userProfile.school_id,
      charge_id: selectedCharge.id,
      student_id: selectedCharge.student_id,
      amount: parseFloat(paymentForm.amount),
      payment_date: formatLocalDate(new Date()),
      payment_method: paymentForm.payment_method,
      reference: paymentForm.reference,
      recorded_by: user.id,
    });
  };

  const openPaymentForm = (charge) => {
    setSelectedCharge(charge);
    setPaymentForm({ amount: charge.amount.toString(), payment_method: 'cash', reference: '' });
    setShowPaymentForm(true);
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
              <Label>Monto por defecto *</Label>
              <Input
                type="number"
                value={conceptForm.default_amount}
                onChange={(e) => setConceptForm({ ...conceptForm, default_amount: e.target.value })}
                placeholder="0.00"
                className="mt-1"
              />
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="outline" onClick={() => setShowConceptForm(false)} className="flex-1">
                Cancelar
              </Button>
              <Button type="submit" disabled={!conceptForm.name || !conceptForm.default_amount || createConceptMutation.isPending} className="flex-1">
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
                      {concept.name} (${concept.default_amount})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Monto *</Label>
              <Input
                type="number"
                value={chargeForm.amount}
                onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })}
                placeholder="0.00"
                className="mt-1"
              />
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
                disabled={!chargeForm.student_id || !chargeForm.concept_id || !chargeForm.amount || !chargeForm.due_date || createChargeMutation.isPending}
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
              </div>
              <div>
                <Label>Monto recibido *</Label>
                <Input
                  type="number"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  className="mt-1"
                />
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

function ChargeCard({ charge, studentName, onRecordPayment, isOverdue, isPaid }) {
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
          <p className="font-bold text-lg">${charge.amount?.toLocaleString()}</p>
          <Badge className={
            isPaid ? 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300' :
            isOverdue ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300' :
            'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
          }>
            {isPaid ? 'Pagado' : isOverdue ? 'Vencido' : 'Pendiente'}
          </Badge>
        </div>
      </div>
      {!isPaid && (
        <Button 
          onClick={onRecordPayment} 
          size="sm" 
          className="w-full mt-3 bg-green-600 hover:bg-green-700"
        >
          <DollarSign className="w-4 h-4 mr-1" /> Registrar pago
        </Button>
      )}
    </motion.div>
  );
}
