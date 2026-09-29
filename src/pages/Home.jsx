import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import LoadingScreen from '@/components/ui/LoadingScreen';
import PendingApproval from '@/components/ui/PendingApproval';
import ParentHome from '@/components/home/ParentHome';
import TeacherHome from '@/components/home/TeacherHome';
import AdminHome from '@/components/home/AdminHome';
import Onboarding from '@/components/onboarding/Onboarding';
import WelcomeTrialModal from '@/components/subscription/WelcomeTrialModal';
import SuspendedAccountModal from '@/components/subscription/SuspendedAccountModal';
import { selectCurrentUserProfile } from '@/lib/tenantSelection';
import { useSubscription } from '@/hooks/useSubscription';
import SignOutButton from '@/components/auth/SignOutButton';
import { Ban } from 'lucide-react';

export default function Home() {
  const [user, setUser] = useState(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const queryClient = useQueryClient();

  // TODOS los perfiles del usuario: `selectCurrentUserProfile` los ordena y
  // elige uno de forma determinista. Antes había además un selector de
  // escuela; se retiró el 2026-09-10 (una cuenta, una escuela).
  const { data: profiles = [], isLoading: profilesLoading, refetch: refetchProfiles } = useQuery({
    queryKey: ['userProfiles'],
    queryFn: async () => {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      return base44.entities.UserProfile.filter({ user_id: currentUser.id }, '-created_date');
    },
  });

  const userProfile = selectCurrentUserProfile(profiles);

  // El aviso de bienvenida (solo admin) vive en el perfil, no en
  // SchoolSubscription — este efecto corre fuera del queryFn, ahora que la
  // resolución del perfil está separada del fetch.
  React.useEffect(() => {
    if (userProfile?.app_role === 'ADMIN' && !userProfile?.welcome_message_shown) {
      setShowWelcome(true);
    }
  }, [userProfile?.id, userProfile?.app_role, userProfile?.welcome_message_shown]);

  // Through getMySubscription (service role, school re-derived server-side):
  // a direct SchoolSubscription read is platform-only and returned null for
  // every school user, so these modals and banners never had data (audit F10).
  const { subscription } = useSubscription();

  const markWelcomeShownMutation = useMutation({
    mutationFn: async () => {
      await base44.entities.UserProfile.update(userProfile.id, {
        welcome_message_shown: true
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['userProfiles']);
      setShowWelcome(false);
    }
  });

  const handleCloseWelcome = () => {
    markWelcomeShownMutation.mutate();
  };

  if (profilesLoading) {
    return <LoadingScreen message="Cargando tu perfil..." />;
  }

  // Sin ningún perfil todavía — el onboarding de siempre, sin selector (no
  // hay nada entre qué elegir). "Cerrar sesión" va aquí y no dentro de
  // Onboarding: quien entró con la cuenta equivocada tiene que poder salir sin
  // crear una escuela, y el componente de onboarding es de otro paquete.
  if (!userProfile) {
    return (
      <div className="relative">
        <div className="absolute right-4 top-4 z-10">
          <SignOutButton />
        </div>
        <Onboarding user={user} onComplete={refetchProfiles} />
      </div>
    );
  }

  // Pending status
  if (userProfile.status === 'PENDING') {
    return <PendingApproval />;
  }

  // Suspended status — with a way out, and readable in dark mode.
  if (userProfile.status === 'SUSPENDED') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50 dark:bg-red-950/30 p-6">
        <div className="max-w-md w-full rounded-3xl bg-card text-card-foreground shadow-xl p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center mx-auto mb-5">
            <Ban className="w-8 h-8 text-red-600 dark:text-red-400" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-red-800 dark:text-red-300 mb-2">Cuenta suspendida</h1>
          <p className="text-red-700 dark:text-red-400 mb-6">
            Tu acceso a esta escuela está suspendido. Si crees que es un error, habla con la dirección de tu escuela.
          </p>
          <SignOutButton />
        </div>
      </div>
    );
  }

  // Active users - show role-specific home with subscription components
  const HomeComponent = () => {
    switch (userProfile.app_role) {
      case 'ADMIN':
        return <AdminHome user={user} userProfile={userProfile} subscription={subscription} />;
      case 'TEACHER':
        return <TeacherHome user={user} userProfile={userProfile} subscription={subscription} />;
      case 'PARENT':
      default:
        return <ParentHome user={user} userProfile={userProfile} subscription={subscription} />;
    }
  };

  return (
    <>
      <SuspendedAccountModal subscription={subscription} />
      {showWelcome && subscription && userProfile.app_role === 'ADMIN' && (
        <WelcomeTrialModal subscription={subscription} onClose={handleCloseWelcome} />
      )}
      <HomeComponent />
    </>
  );
}
