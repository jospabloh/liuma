import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import LoadingScreen from '@/components/ui/LoadingScreen';
import { UserCheck, User, CheckCircle, XCircle, Clock, Mail, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createPageUrl } from '@/utils';
import { toast } from "sonner";
import { AUDIT_ENTITIES, logAuditEvent } from '@/lib/audit';
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

export default function Aprobaciones() {
  const queryClient = useQueryClient();
  const [selectedUser, setSelectedUser] = useState(null);
  const [actionType, setActionType] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: userProfile } = useQuery({
    queryKey: ['userProfile', currentUser?.id],
    queryFn: async () => {
      const profiles = await base44.entities.UserProfile.filter({ user_id: currentUser.id });
      return profiles[0];
    },
    enabled: !!currentUser,
  });

  const { data: pendingUsers = [], isLoading } = useQuery({
    queryKey: ['pendingUsers', userProfile?.school_id],
    queryFn: () => base44.entities.UserProfile.filter({ 
      school_id: userProfile.school_id,
      status: 'PENDING' 
    }),
    enabled: !!userProfile,
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list(),
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ profileId, status }) => {
      await base44.entities.UserProfile.update(profileId, { status });
      
      await logAuditEvent({
        user: currentUser,
        userProfile,
        entity: AUDIT_ENTITIES.USER_PROFILE,
        entityId: profileId,
        action: status === 'ACTIVE' ? 'USER_APPROVED' : 'USER_SUSPENDED',
        reason: status === 'ACTIVE' ? 'Admin approval flow' : 'Admin rejection flow',
        context: { approved_status: status }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['pendingUsers']);
      toast.success(actionType === 'approve' ? 'Usuario aprobado' : 'Usuario rechazado');
      setSelectedUser(null);
      setActionType(null);
    },
    onError: () => {
      toast.error('Error al actualizar usuario');
    }
  });

  const getUserEmail = (userId) => {
    const user = allUsers.find(u => u.id === userId);
    return user?.email || 'Sin correo';
  };

  const getUserName = (userId) => {
    const user = allUsers.find(u => u.id === userId);
    return user?.full_name || 'Sin nombre';
  };

  const handleAction = (profile, type) => {
    setSelectedUser(profile);
    setActionType(type);
  };

  const confirmAction = () => {
    updateUserMutation.mutate({
      profileId: selectedUser.id,
      status: actionType === 'approve' ? 'ACTIVE' : 'SUSPENDED'
    });
  };

  const roleLabels = {
    ADMIN: 'Directivo',
    TEACHER: 'Maestro',
    PARENT: 'Padre/Madre',
  };

  if (isLoading) return <LoadingScreen message="Cargando..." />;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 pb-24">
      <PageHeader
        title="Aprobaciones"
        subtitle={`${pendingUsers.length} usuario${pendingUsers.length !== 1 ? 's' : ''} pendiente${pendingUsers.length !== 1 ? 's' : ''}`}
        showBack
        backTo={createPageUrl('Home')}
      />

      {pendingUsers.length === 0 ? (
        <EmptyState
          icon={UserCheck}
          title="Sin usuarios pendientes"
          description="Todos los usuarios han sido aprobados."
        />
      ) : (
        <div className="space-y-4">
          {pendingUsers.map((profile, index) => (
            <motion.div
              key={profile.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="bg-card text-card-foreground rounded-2xl p-5 shadow-sm border border-border"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
                  <User className="w-6 h-6 text-amber-600" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-card-foreground">
                      {getUserName(profile.user_id)}
                    </h3>
                    <Badge className="bg-amber-100 text-amber-800">
                      <Clock className="w-3 h-3 mr-1" /> Pendiente
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Mail className="w-3 h-3" />
                    {getUserEmail(profile.user_id)}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="outline">{roleLabels[profile.app_role] || profile.app_role}</Badge>
                    <span className="text-xs text-muted-foreground">
                      Registrado: {format(new Date(profile.created_date), "d MMM, yyyy", { locale: es })}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 mt-4 pt-4 border-t border-border">
                <Button
                  variant="outline"
                  onClick={() => handleAction(profile, 'reject')}
                  className="flex-1 text-red-600 hover:bg-red-50 hover:text-red-700"
                >
                  <XCircle className="w-4 h-4 mr-1" /> Rechazar
                </Button>
                <Button
                  onClick={() => handleAction(profile, 'approve')}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle className="w-4 h-4 mr-1" /> Aprobar
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Confirmation Dialog */}
      <AlertDialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {actionType === 'approve' ? '¿Aprobar usuario?' : '¿Rechazar usuario?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {actionType === 'approve' 
                ? `${getUserName(selectedUser?.user_id)} podrá acceder a la aplicación como ${roleLabels[selectedUser?.app_role]?.toLowerCase()}.`
                : `${getUserName(selectedUser?.user_id)} no podrá acceder a la aplicación.`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmAction}
              className={actionType === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}
            >
              {updateUserMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                actionType === 'approve' ? 'Aprobar' : 'Rechazar'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </div>
  );
}