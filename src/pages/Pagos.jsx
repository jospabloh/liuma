import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import LoadingScreen from '@/components/ui/LoadingScreen';
import PaymentStatusCard from '@/components/payments/PaymentStatusCard';
import { CreditCard, CheckCircle, Clock, AlertTriangle, Calendar } from 'lucide-react';
import { format, isPast, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { createPageUrl } from '@/utils';
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function Pagos() {
  const [selectedStudent, setSelectedStudent] = useState(null);
  
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

  const { data: parentLinks = [] } = useQuery({
    queryKey: ['parentLinks', user?.id],
    queryFn: () => base44.entities.ParentStudent.filter({ 
      parent_id: user.id, 
      status: 'ACTIVE' 
    }),
    enabled: !!user,
  });

  const studentIds = parentLinks.map(l => l.student_id);

  const { data: students = [] } = useQuery({
    queryKey: ['students', studentIds],
    queryFn: async () => {
      if (studentIds.length === 0) return [];
      const results = [];
      for (const id of studentIds) {
        const studentList = await base44.entities.Student.filter({ id });
        if (studentList.length > 0) results.push(studentList[0]);
      }
      return results;
    },
    enabled: studentIds.length > 0,
  });

  const { data: charges = [], isLoading } = useQuery({
    queryKey: ['charges', studentIds],
    queryFn: async () => {
      if (studentIds.length === 0) return [];
      const allCharges = await base44.entities.ChargeItem.filter({ 
        school_id: userProfile.school_id 
      }, '-due_date');
      return allCharges.filter(c => studentIds.includes(c.student_id));
    },
    enabled: studentIds.length > 0 && !!userProfile,
  });

  const getStudentStatus = (studentId) => {
    const studentCharges = charges.filter(c => c.student_id === studentId && c.status !== 'PAID' && c.status !== 'CANCELLED');
    
    if (studentCharges.length === 0) return 'Al día';
    
    const hasOverdue = studentCharges.some(c => isPast(new Date(c.due_date)));
    if (hasOverdue) return 'Vencido';
    
    const daysToNext = Math.min(...studentCharges.map(c => differenceInDays(new Date(c.due_date), new Date())));
    if (daysToNext <= 7) return 'Próximo a vencer';
    
    return 'Al día';
  };

  const getStudentPending = (studentId) => {
    return charges
      .filter(c => c.student_id === studentId && c.status !== 'PAID' && c.status !== 'CANCELLED')
      .reduce((sum, c) => sum + (c.amount || 0), 0);
  };

  const getNextDueDate = (studentId) => {
    const studentCharges = charges
      .filter(c => c.student_id === studentId && c.status !== 'PAID' && c.status !== 'CANCELLED')
      .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
    
    if (studentCharges.length === 0) return null;
    return format(new Date(studentCharges[0].due_date), "d 'de' MMM", { locale: es });
  };

  const getStudentCharges = (studentId) => {
    return charges.filter(c => c.student_id === studentId);
  };

  if (isLoading) return <LoadingScreen message="Cargando pagos..." />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 pb-24">
      <PageHeader
        title="Pagos"
        showBack
        backTo={createPageUrl('Home')}
      />

      {students.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="Sin información de pagos"
          description="No hay hijos vinculados a tu cuenta."
        />
      ) : (
        <div className="space-y-4">
          {students.map((student, index) => (
            <motion.div
              key={student.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <PaymentStatusCard
                studentName={`${student.first_name} ${student.last_name}`}
                status={getStudentStatus(student.id)}
                totalPending={getStudentPending(student.id)}
                nextDueDate={getNextDueDate(student.id)}
                onClick={() => setSelectedStudent(student)}
              />
            </motion.div>
          ))}
        </div>
      )}

      {/* Student Charges Detail Modal */}
      <Dialog open={!!selectedStudent} onOpenChange={() => setSelectedStudent(null)}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Pagos de {selectedStudent?.first_name}
            </DialogTitle>
          </DialogHeader>
          
          {selectedStudent && (
            <div className="space-y-4">
              {getStudentCharges(selectedStudent.id).length === 0 ? (
                <div className="text-center py-6">
                  <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2" />
                  <p className="text-slate-600">Sin cargos pendientes</p>
                </div>
              ) : (
                getStudentCharges(selectedStudent.id).map((charge) => {
                  const isOverdue = charge.status !== 'PAID' && isPast(new Date(charge.due_date));
                  return (
                    <div
                      key={charge.id}
                      className={`p-4 rounded-xl border ${
                        charge.status === 'PAID' ? 'bg-green-50 border-green-200' :
                        isOverdue ? 'bg-red-50 border-red-200' :
                        'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-medium text-slate-800">{charge.concept_name}</h4>
                          <div className="flex items-center gap-2 mt-1 text-sm text-slate-500">
                            <Calendar className="w-3 h-3" />
                            Vence: {format(new Date(charge.due_date), "d 'de' MMM, yyyy", { locale: es })}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-lg">${charge.amount?.toLocaleString()}</p>
                          <Badge className={
                            charge.status === 'PAID' ? 'bg-green-100 text-green-800' :
                            isOverdue ? 'bg-red-100 text-red-800' :
                            'bg-amber-100 text-amber-800'
                          }>
                            {charge.status === 'PAID' ? 'Pagado' : isOverdue ? 'Vencido' : 'Pendiente'}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}