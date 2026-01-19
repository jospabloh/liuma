import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { CreditCard, Plus, DollarSign, Receipt, Loader2, CheckCircle, AlertTriangle, Clock, User, Calendar } from 'lucide-react';
import { format, isPast } from 'date-fns';
import { es } from 'date-fns/locale';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { createPageUrl } from '@/utils';
import { toast } from "sonner";
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
  const [activeTab, setActiveTab] = useState('pending');
  const [showConceptForm, setShowConceptForm] = useState(false);
  const [showChargeForm, setShowChargeForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [selectedCharge, setSelectedCharge] = useState(null);
  
  const [conceptForm, setConceptForm] = useState({ name: '', default_amount: '' });
  const [chargeForm, setChargeForm] = useState({ student_id: '', concept_id: '', amount: '', due_date: '' });
  const [paymentForm, setPaymentForm] = useState({ amount: '', payment_method: 'cash', reference: '' });

  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: userProfile } = useQuery({
    queryKey: ['userProfile', user?.id],
    queryFn: async () => {
      const profiles = await base44.entities.UserProfile.filter({ user_id: user.id });
      return profiles[0];
    },
    enabled: !!user,
  });

  const { data: concepts = [] } = useQuery({
    queryKey: ['paymentConcepts', userProfile?.school_id],
    queryFn: () => base44.entities.PaymentConcept.filter({ 
      school_id: userProfile.school_id,
      is_active: true 
    }),
    enabled: !!userProfile,
  });

  const { data: students = [] } = useQuery({
    queryKey: ['allStudents', userProfile?.school_id],
    queryFn: () => base44.entities.Student.filter({ 
      school_id: userProfile.school_id,
      is_active: true 
    }),
    enabled: !!userProfile,
  });

  const { data: charges = [], isLoading } = useQuery({
    queryKey: ['allCharges', userProfile?.school_id],
    queryFn: () => base44.entities.ChargeItem.filter({ 
      school_id: userProfile.school_id 
    }, '-due_date'),
    enabled: !!userProfile,
  });

  const createConceptMutation = useMutation({
    mutationFn: (data) => base44.entities.PaymentConcept.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['paymentConcepts']);
      toast.success('Concepto creado');
      setShowConceptForm(false);
      setConceptForm({ name: '', default_amount: '' });
    },
  });

  const createChargeMutation = useMutation({
    mutationFn: async (data) => {
      const charge = await base44.entities.ChargeItem.create(data);
      await base44.entities.AuditLog.create({
        school_id: userProfile.school_id,
        user_id: user.id,
        user_email: user.email,
        action: 'CHARGE_CREATED',
        target_type: 'ChargeItem',
        target_id: charge.id,
      });
      return charge;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['allCharges']);
      toast.success('Cargo creado');
      setShowChargeForm(false);
      setChargeForm({ student_id: '', concept_id: '', amount: '', due_date: '' });
    },
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async (data) => {
      await base44.entities.ChargeItem.update(selectedCharge.id, { status: 'PAID' });
      const payment = await base44.entities.PaymentRecord.create(data);
      await base44.entities.AuditLog.create({
        school_id: userProfile.school_id,
        user_id: user.id,
        user_email: user.email,
        action: 'PAYMENT_RECORDED',
        target_type: 'PaymentRecord',
        target_id: payment.id,
      });
      return payment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['allCharges']);
      toast.success('Pago registrado');
      setShowPaymentForm(false);
      setSelectedCharge(null);
      setPaymentForm({ amount: '', payment_method: 'cash', reference: '' });
    },
  });

  const handleCreateConcept = (e) => {
    e.preventDefault();
    createConceptMutation.mutate({
      ...conceptForm,
      default_amount: parseFloat(conceptForm.default_amount),
      school_id: userProfile.school_id,
      is_active: true,
    });
  };

  const handleCreateCharge = (e) => {
    e.preventDefault();
    const concept = concepts.find(c => c.id === chargeForm.concept_id);
    createChargeMutation.mutate({
      ...chargeForm,
      concept_name: concept?.name || '',
      amount: parseFloat(chargeForm.amount),
      school_id: userProfile.school_id,
      status: 'PENDING',
    });
  };

  const handleRecordPayment = (e) => {
    e.preventDefault();
    recordPaymentMutation.mutate({
      school_id: userProfile.school_id,
      charge_id: selectedCharge.id,
      student_id: selectedCharge.student_id,
      amount: parseFloat(paymentForm.amount),
      payment_date: format(new Date(), 'yyyy-MM-dd'),
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

  const pendingCharges = charges.filter(c => c.status !== 'PAID' && c.status !== 'CANCELLED');
  const overdueCharges = pendingCharges.filter(c => isPast(new Date(c.due_date)));
  const paidCharges = charges.filter(c => c.status === 'PAID');

  if (isLoading) return <LoadingScreen message="Cargando..." />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 pb-24">
      <PageHeader
        title="Pagos"
        showBack
        backTo={createPageUrl('Home')}
      />

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white rounded-xl p-3 text-center border">
          <Clock className="w-5 h-5 text-amber-500 mx-auto mb-1" />
          <p className="text-lg font-bold">{pendingCharges.length}</p>
          <p className="text-xs text-slate-500">Pendientes</p>
        </div>
        <div className="bg-white rounded-xl p-3 text-center border">
          <AlertTriangle className="w-5 h-5 text-red-500 mx-auto mb-1" />
          <p className="text-lg font-bold">{overdueCharges.length}</p>
          <p className="text-xs text-slate-500">Vencidos</p>
        </div>
        <div className="bg-white rounded-xl p-3 text-center border">
          <CheckCircle className="w-5 h-5 text-green-500 mx-auto mb-1" />
          <p className="text-lg font-bold">{paidCharges.length}</p>
          <p className="text-xs text-slate-500">Pagados</p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 mb-6">
        <Button onClick={() => setShowConceptForm(true)} variant="outline" size="sm" className="gap-1">
          <Receipt className="w-4 h-4" /> Concepto
        </Button>
        <Button onClick={() => setShowChargeForm(true)} className="bg-rose-600 hover:bg-rose-700 gap-1" size="sm">
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
                className="flex-1 bg-rose-600 hover:bg-rose-700"
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
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="font-medium">{getStudentName(selectedCharge.student_id)}</p>
                <p className="text-sm text-slate-500">{selectedCharge.concept_name}</p>
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
  );
}

function ChargeCard({ charge, studentName, onRecordPayment, isOverdue, isPaid }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-white rounded-xl p-4 border ${
        isPaid ? 'border-green-200' : isOverdue ? 'border-red-200' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-slate-400" />
            <span className="font-medium text-slate-800">{studentName}</span>
          </div>
          <p className="text-sm text-slate-600 mt-1">{charge.concept_name}</p>
          <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
            <Calendar className="w-3 h-3" />
            Vence: {format(new Date(charge.due_date), "d MMM, yyyy", { locale: es })}
          </div>
        </div>
        <div className="text-right">
          <p className="font-bold text-lg">${charge.amount?.toLocaleString()}</p>
          <Badge className={
            isPaid ? 'bg-green-100 text-green-800' :
            isOverdue ? 'bg-red-100 text-red-800' :
            'bg-amber-100 text-amber-800'
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