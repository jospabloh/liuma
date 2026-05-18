import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
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
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function GestionAusencias() {
  const [selectedNotification, setSelectedNotification] = useState(null);
  const [newStatus, setNewStatus] = useState('');
  const [adminNotes, setAdminNotes] = useState('');

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
          await base44.entities.Attendance.update(existingAttendance[0].id, {
            status: 'excused',
            reason: notification.reason,
          });
        } else {
          // Crear nuevo registro justificado
          const student = students.find(s => s.id === notification.student_id);
          await base44.entities.Attendance.create({
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
    PENDING: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-800', icon: Clock },
    APPROVED: { label: 'Aprobada', color: 'bg-green-100 text-green-800', icon: CheckCircle },
    REJECTED: { label: 'Rechazada', color: 'bg-red-100 text-red-800', icon: XCircle },
  };

  if (isLoading) {
    return <LoadingScreen message="Cargando solicitudes..." />;
  }

  const pendingCount = notifications?.filter(n => n.status === 'PENDING').length || 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 pb-24">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          title="Solicitudes de Ausencias"
          subtitle={`${pendingCount} pendientes de revisión`}
          showBack
        />

        <div className="space-y-3">
          {notifications?.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Clock className="w-12 h-12 mx-auto text-slate-400 mb-4" />
                <p className="text-slate-600">No hay solicitudes de ausencia</p>
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
                      <div className="space-y-2">
                        <div>
                          <p className="text-xs text-slate-500">Solicitado por:</p>
                          <p className="text-sm">{notification.parent_name}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Motivo:</p>
                          <p className="text-sm">{notification.reason}</p>
                        </div>
                        {notification.admin_notes && (
                          <div className="mt-3 p-2 bg-slate-50 rounded">
                            <p className="text-xs text-slate-500">Respuesta:</p>
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
              <DialogTitle>Revisar Solicitud</DialogTitle>
            </DialogHeader>
            {selectedNotification && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="p-4 bg-slate-50 rounded-lg space-y-2">
                  <div>
                    <p className="text-xs text-slate-500">Estudiante:</p>
                    <p className="font-medium">
                      {students?.find(s => s.id === selectedNotification.student_id)?.first_name}{' '}
                      {students?.find(s => s.id === selectedNotification.student_id)?.last_name}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Fecha de ausencia:</p>
                    <p className="text-sm">
                      {format(new Date(selectedNotification.absence_date), "EEEE d 'de' MMMM", { locale: es })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Motivo:</p>
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
                  <div className="p-3 bg-green-50 rounded-lg text-sm text-green-800">
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
                  className="w-full bg-indigo-600 hover:bg-indigo-700"
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