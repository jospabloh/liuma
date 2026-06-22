import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { AlertTriangle, Loader2, CheckCircle, ArrowLeft } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { createPageUrl } from '@/utils';
import { useNavigate } from 'react-router-dom';
import { toast } from "sonner";
import { notificationService } from '@/lib/notifications/service';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function AlertaEmergencia() {
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [sent, setSent] = useState(false);

  const { user, userProfile } = useCurrentProfile();

  const { data: school } = useQuery({
    queryKey: ['school', userProfile?.school_id],
    queryFn: async () => {
      const schools = await base44.entities.School.filter({ id: userProfile.school_id });
      return schools[0];
    },
    enabled: !!userProfile?.school_id,
  });

  const sendAlertMutation = useMutation({
    mutationFn: async () => {
      const alertMessage = message || 'Se ha activado una alerta de emergencia. Por favor, siga las instrucciones del personal de la escuela.';
      const targetProfiles = await base44.entities.UserProfile.filter({
        school_id: userProfile.school_id,
        status: 'ACTIVE',
      });
      const allUsers = await base44.entities.User.list();
      const recipients = targetProfiles
        .filter((profile) => ['PARENT', 'TEACHER'].includes(profile.app_role))
        .map((profile) => {
          const account = allUsers.find((u) => u.id === profile.user_id);
          return {
            user_id: profile.user_id,
            app_role: profile.app_role,
            email: account?.email,
            notification_preferences: profile.notification_preferences || {},
            school_notification_preferences: school?.notification_preferences || {},
          };
        });

      const title = '🚨 ALERTA DE EMERGENCIA';
      await notificationService.sendHighPriorityAlert({
        schoolId: userProfile.school_id,
        title,
        content: alertMessage,
        actorUserId: user.id,
      });
      await notificationService.sendByEvent({
        eventType: 'emergency_alert',
        schoolId: userProfile.school_id,
        actorUserId: user.id,
        recipients,
        templateContext: { schoolName: school?.name, message: alertMessage },
        channels: ['email', 'in_app'],
        priority: 'URGENT',
      });

      await base44.entities.AuditLog.create({
        school_id: userProfile.school_id,
        user_id: user.id,
        user_email: user.email,
        action: 'EMERGENCY_ALERT',
        target_type: 'Notice',
        details: { message: alertMessage }
      });

      return true;
    },
    onSuccess: () => {
      setSent(true);
      toast.success('Alerta enviada a toda la comunidad escolar');
    },
    onError: () => {
      toast.error('Error al enviar la alerta');
    }
  });

  const handleSend = () => {
    setShowConfirm(false);
    sendAlertMutation.mutate();
  };

  if (!user || !userProfile) {
    return <LoadingScreen message="Cargando..." />;
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center"
        >
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-10 h-10 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Alerta enviada
          </h1>
          <p className="text-muted-foreground mb-6">
            Todos los padres y maestros han sido notificados.
          </p>
          <Button onClick={() => navigate(createPageUrl('Home'))} className="gap-2">
            <ArrowLeft className="w-4 h-4" /> Volver al inicio
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <PageHeader
        title="Alerta de emergencia"
        showBack
        backTo={createPageUrl('Home')}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md mx-auto"
      >
        <div className="bg-card text-card-foreground border border-border rounded-2xl shadow-sm p-6">
          <div className="text-center mb-6">
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="text-xl font-bold text-card-foreground">
              Enviar alerta URGENTE
            </h2>
            <p className="text-muted-foreground mt-1">
              Esta alerta se enviará a TODA la comunidad de {school?.name}.
            </p>
          </div>

          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <p className="text-sm text-red-800 font-medium">
              ⚠️ Usa esta función solo en casos de emergencia real. 
              Todos los padres y maestros recibirán la notificación inmediatamente.
            </p>
          </div>

          <div className="mb-6">
            <Label>Mensaje (opcional)</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe la situación de emergencia..."
              className="mt-1 min-h-[100px]"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Si no escribes un mensaje, se enviará un texto genérico de alerta.
            </p>
          </div>

          <Button
            onClick={() => setShowConfirm(true)}
            disabled={sendAlertMutation.isPending}
            className="w-full h-14 bg-red-600 hover:bg-red-700 text-lg font-semibold"
          >
            {sendAlertMutation.isPending ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <>
                <AlertTriangle className="w-6 h-6 mr-2" />
                Enviar alerta de emergencia
              </>
            )}
          </Button>
        </div>
      </motion.div>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              ¿Confirmas enviar la alerta?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción enviará una notificación de EMERGENCIA a todos los padres y 
              maestros de la escuela. Solo usa esta función en casos reales de emergencia.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSend}
              className="bg-red-600 hover:bg-red-700"
            >
              Sí, enviar alerta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
