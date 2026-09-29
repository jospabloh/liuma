import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getLinkedStudents } from '@/lib/relations/getLinkedStudents';
import { familyCreate } from '@/lib/authorization/familyWrite';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate, isBeforeToday, formatLocalDate } from '@/lib/dates';
import { Badge } from '@/components/ui/badge';

export default function SolicitarAusencia() {
  const [selectedStudent, setSelectedStudent] = useState('');
  const [absenceDate, setAbsenceDate] = useState('');
  const [reason, setReason] = useState('');

  const queryClient = useQueryClient();

  const { user, userProfile } = useCurrentProfile();

  const { data: linkedStudents = { students: [], studentIds: [], orphanedLinkIds: [] } } = useQuery({
    queryKey: ['linkedStudents', user?.id],
    queryFn: () => getLinkedStudents(user),
    enabled: !!user,
  });

  const students = linkedStudents.students;

  const { data: notifications, isLoading } = useQuery({
    queryKey: ['absenceNotifications', user?.id],
    queryFn: () => base44.entities.AbsenceNotification.filter({ parent_id: user.id }, '-created_date'),
    enabled: !!user?.id,
  });

  const createNotificationMutation = useMutation({
    // guardedFamilyWrite comprueba el vínculo con el alumno y fija escuela,
    // padre y estado del lado del servidor.
    mutationFn: (data) => familyCreate('AbsenceNotification', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absenceNotifications'] });
      toast.success('Solicitud enviada');
      setSelectedStudent('');
      setAbsenceDate('');
      setReason('');
    },
    onError: () => {
      toast.error('Error al enviar solicitud');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!selectedStudent || !absenceDate || !reason) {
      toast.error('Completa todos los campos');
      return;
    }

    // Validar que la fecha sea futura o de hoy (día calendario local: con
    // new Date('YYYY-MM-DD') la fecha de hoy se leía como ayer y se rechazaba).
    if (!parseLocalDate(absenceDate) || isBeforeToday(absenceDate)) {
      toast.error('La fecha debe ser hoy o futura');
      return;
    }

    const student = students.find((item) => item.id === selectedStudent);

    createNotificationMutation.mutate({
      school_id: student?.school_id || userProfile?.school_id,
      student_id: selectedStudent,
      parent_id: user.id,
      parent_name: user.full_name,
      absence_date: absenceDate,
      reason,
    });
  };

  const statusConfig = {
    PENDING: { label: 'Pendiente', color: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300', icon: Clock },
    APPROVED: { label: 'Aprobada', color: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300', icon: CheckCircle },
    REJECTED: { label: 'Rechazada', color: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300', icon: XCircle },
  };

  if (isLoading) {
    return <LoadingScreen message="Cargando solicitudes..." />;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 pb-24">
        <PageHeader
          title="Solicitar ausencia"
          subtitle="Notifica con anticipación las ausencias de tus hijos"
          showBack
        />

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Nueva solicitud</CardTitle>
            <CardDescription>Completa el formulario para notificar una ausencia</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>Estudiante</Label>
                <Select value={selectedStudent} onValueChange={setSelectedStudent}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona un estudiante" />
                  </SelectTrigger>
                  <SelectContent>
                    {students?.map((student) => (
                      <SelectItem key={student.id} value={student.id}>
                        {student.first_name} {student.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Fecha de la ausencia</Label>
                <Input
                  type="date"
                  value={absenceDate}
                  onChange={(e) => setAbsenceDate(e.target.value)}
                  min={formatLocalDate()}
                  required
                />
              </div>

              <div>
                <Label>Motivo de la ausencia</Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Describe el motivo de la ausencia"
                  rows={4}
                  required
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={createNotificationMutation.isPending}
              >
                {createNotificationMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  'Enviar solicitud'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Solicitudes enviadas</h2>
          {notifications?.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Calendar className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No has enviado solicitudes de ausencia</p>
              </CardContent>
            </Card>
          ) : (
            notifications?.map((notification) => {
              const student = students?.find(s => s.id === notification.student_id);
              const config = statusConfig[notification.status];
              const StatusIcon = config.icon;
              
              return (
                <motion.div
                  key={notification.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <Card>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-base">
                            {student?.first_name} {student?.last_name}
                          </CardTitle>
                          <CardDescription>
                            {parseLocalDate(notification.absence_date) ? format(parseLocalDate(notification.absence_date), "EEEE d 'de' MMMM", { locale: es }) : 'Sin fecha'}
                          </CardDescription>
                        </div>
                        <Badge className={config.color}>
                          <StatusIcon className="w-3 h-3 mr-1" />
                          {config.label}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-2">
                        <strong>Motivo:</strong> {notification.reason}
                      </p>
                      {notification.admin_notes && (
                        <div className="mt-3 p-3 bg-muted rounded-lg">
                          <p className="text-xs text-muted-foreground mb-1">Respuesta de dirección:</p>
                          <p className="text-sm text-card-foreground">{notification.admin_notes}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}