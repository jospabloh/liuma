import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
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
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';

export default function SolicitarAusencia() {
  const [selectedStudent, setSelectedStudent] = useState('');
  const [absenceDate, setAbsenceDate] = useState('');
  const [reason, setReason] = useState('');

  const queryClient = useQueryClient();

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
    enabled: !!user?.id,
  });

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
    mutationFn: (data) => base44.entities.AbsenceNotification.create(data),
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

    // Validar que la fecha sea futura o de hoy
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selectedDate = new Date(absenceDate);
    
    if (selectedDate < today) {
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
    PENDING: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-800', icon: Clock },
    APPROVED: { label: 'Aprobada', color: 'bg-green-100 text-green-800', icon: CheckCircle },
    REJECTED: { label: 'Rechazada', color: 'bg-red-100 text-red-800', icon: XCircle },
  };

  if (isLoading) {
    return <LoadingScreen message="Cargando solicitudes..." />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 pb-24">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title="Solicitar Ausencia"
          subtitle="Notifica con anticipación las ausencias de tus hijos"
          showBack
        />

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Nueva Solicitud</CardTitle>
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
                  min={format(new Date(), 'yyyy-MM-dd')}
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
                className="w-full bg-indigo-600 hover:bg-indigo-700"
                disabled={createNotificationMutation.isPending}
              >
                {createNotificationMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  'Enviar Solicitud'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-800">Solicitudes Enviadas</h2>
          {notifications?.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Calendar className="w-12 h-12 mx-auto text-slate-400 mb-4" />
                <p className="text-slate-600">No has enviado solicitudes de ausencia</p>
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
                            {format(new Date(notification.absence_date), "EEEE d 'de' MMMM", { locale: es })}
                          </CardDescription>
                        </div>
                        <Badge className={config.color}>
                          <StatusIcon className="w-3 h-3 mr-1" />
                          {config.label}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-slate-600 mb-2">
                        <strong>Motivo:</strong> {notification.reason}
                      </p>
                      {notification.admin_notes && (
                        <div className="mt-3 p-3 bg-slate-50 rounded-lg">
                          <p className="text-xs text-slate-500 mb-1">Respuesta de dirección:</p>
                          <p className="text-sm text-slate-700">{notification.admin_notes}</p>
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