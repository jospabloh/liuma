import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { schoolRead } from '@/lib/data/schoolRead';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import LoadingScreen from '@/components/ui/LoadingScreen';
import PaymentStatusCard from '@/components/payments/PaymentStatusCard';
import { CreditCard, CheckCircle, Calendar } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { parseLocalDate, isBeforeToday, startOfLocalDay } from '@/lib/dates';
import { es } from 'date-fns/locale';
import { createPageUrl } from '@/utils';
import { getLinkedStudents } from '@/lib/relations/getLinkedStudents';
import { canReadEntity, buildScopedFilter } from '@/lib/authorization/policy';
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function Pagos() {
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [activeStudentId, setActiveStudentId] = useState('all');
  
  const { user, userProfile } = useCurrentProfile();

  const { data: linkedStudents = { students: [], studentIds: [], orphanedLinkIds: [] } } = useQuery({
    queryKey: ['linkedStudents', user?.id],
    queryFn: () => getLinkedStudents(user),
    enabled: !!user && canReadEntity(userProfile?.app_role, 'ChargeItem'),
  });

  const students = linkedStudents.students;
  const studentIds = linkedStudents.studentIds;
  const activeStudents = activeStudentId === 'all' ? students : students.filter((student) => student.id === activeStudentId);

  const { data: charges = [], isLoading } = useQuery({
    queryKey: ['charges', studentIds],
    queryFn: async () => {
      if (studentIds.length === 0 || !canReadEntity(userProfile?.app_role, 'ChargeItem')) return [];
      const scopedFilter = buildScopedFilter({ role: userProfile?.app_role, entity: 'ChargeItem', schoolId: userProfile?.school_id, studentIds });
      const allCharges = await schoolRead('ChargeItem', scopedFilter || { school_id: userProfile.school_id }, '-due_date');

      // El estado "Vencido" se deriva localmente para mostrar (ver isOverdue más
      // abajo). Los cargos los gestiona la administración: la vista de padres no
      // modifica ChargeItem (RLS de actualización restringida a ADMIN).
      return allCharges.filter(c => studentIds.includes(c.student_id));
    },
    enabled: studentIds.length > 0 && !!userProfile,
  });

  const getStudentStatus = (studentId) => {
    const studentCharges = charges.filter(c => c.student_id === studentId && c.status !== 'PAID' && c.status !== 'CANCELLED');
    
    if (studentCharges.length === 0) return 'Al día';
    
    const hasOverdue = studentCharges.some(c => isBeforeToday(c.due_date));
    if (hasOverdue) return 'Vencido';
    
    const daysToNext = Math.min(...studentCharges
      .map(c => parseLocalDate(c.due_date))
      .filter(Boolean)
      .map(due => differenceInDays(due, startOfLocalDay())));
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
      .filter(c => parseLocalDate(c.due_date))
      .sort((a, b) => parseLocalDate(a.due_date) - parseLocalDate(b.due_date));
    
    if (studentCharges.length === 0) return null;
    return format(parseLocalDate(studentCharges[0].due_date), "d 'de' MMM", { locale: es });
  };

  const getStudentCharges = (studentId) => {
    return charges.filter(c => c.student_id === studentId);
  };

  if (isLoading) return <LoadingScreen message="Cargando pagos..." />;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 pb-24">
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
          {students.length > 1 && (
            <div className="bg-card text-card-foreground border border-border rounded-2xl p-3 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground mb-2">Hijo activo</p>
              <Select value={activeStudentId} onValueChange={setActiveStudentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos mis hijos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos mis hijos</SelectItem>
                  {students.map((student) => (
                    <SelectItem key={student.id} value={student.id}>{student.first_name} {student.last_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {activeStudents.map((student, index) => (
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
                  <p className="text-muted-foreground">Sin cargos pendientes</p>
                </div>
              ) : (
                getStudentCharges(selectedStudent.id).map((charge) => {
                  const isOverdue = charge.status !== 'PAID' && isBeforeToday(charge.due_date);
                  return (
                    <div
                      key={charge.id}
                      className={`p-4 rounded-xl border ${
                        charge.status === 'PAID' ? 'bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-900' :
                        isOverdue ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900' :
                        'bg-card border-border'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-medium text-card-foreground">{charge.concept_name}</h4>
                          <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                            <Calendar className="w-3 h-3" />
                            Vence: {parseLocalDate(charge.due_date) ? format(parseLocalDate(charge.due_date), "d 'de' MMM, yyyy", { locale: es }) : 'sin fecha'}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-lg">${charge.amount?.toLocaleString()}</p>
                          <Badge className={
                            charge.status === 'PAID' ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300' :
                            isOverdue ? 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300' :
                            'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300'
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
    </div>
  );
}
