import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Clock, CheckCircle, XCircle, User } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dates';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ReadOnlyBanner from '@/components/subscription/ReadOnlyBanner';
import { useCanWrite, guardWrite } from '@/hooks/useCanWrite';
import { guardedCreate, guardedUpdate } from '@/lib/authorization/guardedWrite';

export default function GestionAusencias() {
  const { canWrite } = useCanWrite();
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [newStatus, setNewStatus] = useState('');
  const [adminNotes, setAdminNotes] = useState('');

  const queryClient = useQueryClient();

  const { user, userProfile } = useCurrentProfile();

  const { data: notifications, isLoading } = useQuery({
    queryKey: ['absenceNotifications', userProfile?.school_id],
    queryFn: () => base44.entities.AbsenceNotification.filter({
      school_id: userProfile.school_id
    }, '-created_date'),
    enabled: !!userProfile?.school_id,
  });

  const { data: students } = useQuery({
    queryKey: ['allStudents', userProfile?.school_id],
    queryFn: () => base44.entities.Student.filter({
      school_id: userProfile.school_id
    }),
    enabled: !!userProfile?.school_id,
  });

  const updateNotificationMutation = useMutation({
    mutationFn: async ({ notificationId, data }) => {
      const notification = notifications.find(n => n.id === notificationId);
      
      // Actualizar notificación
      await base44.entities.AbsenceNotification.update(notificationId, {
        ...data,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      });
      
      // Si se aprueba, crear/actualizar registro de asistencia como justificado
      if (data.status === 'APPROVED') {
        const existingAttendance = await base44.entities.Attendance.filter({
          school_id: notification.school_id,
          student_id: notification.student_id,
          date: notification.absence_date,
        });
        
        if (existingAttendance.length > 0) {
          // Actualizar existente
          await guardedUpdate('Attendance', existingAttendance[0].id, {
            status: 'excused',
            reason: notification.reason,
          });
        } else {
          // Crear nuevo registro justificado
          const student = students.find(s => s.id === notification.student_id);
          await guardedCreate('Attendance', {
            school_id: notification.school_id,
            classroom_id: student?.classroom_id,
            student_id: notification.student_id,
            date: notification.absence_date,
            status: 'excused',
            reason: notification.reason,
            recorded_by: user.id,
            recorded_by_name: user.full_name,
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absenceNotifications'] });
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      toast.success('Solicitud actualizada');
      closeDialog();
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!guardWrite(canWrite, () => toast.error('Tu licencia está en modo solo lectura. Reactívala para gestionar solicitudes.'))) return;
    updateNotificationMutation.mutate({
      notificationId: selectedNotification.id,
      data: {
        status: newStatus,
        admin_notes: adminNotes,
      },
    });
  };

  const openDialog = (notification) => {
    setSelectedNotification(notification);
    setNewStatus(notification.status);
    setAdminNotes(notification.admin_notes || '');
  };

  const closeDialog = () => {
    setSelectedNotification(null);
    setNewStatus('');
    setAdminNotes('');
  };

  const statusConfig = {
    PENDING: { label: 'Pendiente', color: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300', icon: Clock },
    APPROVED: { label: 'Aprobada', color: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300', icon: CheckCircle },
    REJECTED: { label: 'Rechazada', color: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300', icon: XCircle },
  };

  if (isLoading) {
    return <LoadingScreen message="Cargando solicitudes..." />;
  }

  const pendingCount = notifications?.filter(n => n.status === 'PENDING').length || 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 pb-24">
        <PageHeader
          title="Solicitudes de ausencia"
          subtitle={`${pendingCount} pendientes de revisión`}
          showBack
        />

        <ReadOnlyBanner />

        <div className="space-y-3">
          {notifications?.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Clock className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No hay solicitudes de ausencia</p>
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
                  <Card 
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => notification.status === 'PENDING' && openDialog(notification)}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-base flex items-center gap-2">
                            <User className="w-4 h-4" />
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
                      <div className="space-y-2">
                        <div>
                          <p className="text-xs text-muted-foreground">Solicitado por:</p>
                          <p className="text-sm">{notification.parent_name}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Motivo:</p>
                          <p className="text-sm">{notification.reason}</p>
                        </div>
                        {notification.admin_notes && (
                          <div className="mt-3 p-2 bg-muted rounded">
                            <p className="text-xs text-muted-foreground">Respuesta:</p>
                            <p className="text-sm">{notification.admin_notes}</p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })
          )}
        </div>

        <Dialog open={!!selectedNotification} onOpenChange={closeDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Revisar solicitud</DialogTitle>
            </DialogHeader>
            {selectedNotification && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="p-4 bg-muted rounded-lg space-y-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Estudiante:</p>
                    <p className="font-medium">
                      {students?.find(s => s.id === selectedNotification.student_id)?.first_name}{' '}
                      {students?.find(s => s.id === selectedNotification.student_id)?.last_name}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Fecha de ausencia:</p>
                    <p className="text-sm">
                      {parseLocalDate(selectedNotification.absence_date) ? format(parseLocalDate(selectedNotification.absence_date), "EEEE d 'de' MMMM", { locale: es }) : 'Sin fecha'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Motivo:</p>
                    <p className="text-sm">{selectedNotification.reason}</p>
                  </div>
                </div>

                <div>
                  <Label>Decisión</Label>
                  <Select value={newStatus} onValueChange={setNewStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="APPROVED">Aprobar justificación</SelectItem>
                      <SelectItem value="REJECTED">Rechazar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {newStatus === 'APPROVED' && (
                  <div className="p-3 bg-green-50 dark:bg-green-950/40 rounded-lg text-sm text-green-800 dark:text-green-300">
                    <p className="font-medium">La ausencia se marcará como justificada</p>
                    <p className="text-xs mt-1">
                      Se actualizará automáticamente el registro de asistencia.
                    </p>
                  </div>
                )}

                <div>
                  <Label>Respuesta para el padre</Label>
                  <Textarea
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    placeholder="Mensaje para el padre (opcional)"
                    rows={3}
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={updateNotificationMutation.isPending || !newStatus}
                >
                  Guardar Decisión
                </Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}