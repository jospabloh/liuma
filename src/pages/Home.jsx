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

  const { data: subscription } = useQuery({
    queryKey: ['schoolSubscription', userProfile?.school_id],
    queryFn: async () => {
      const subs = await base44.entities.SchoolSubscription.filter({
        school_id: userProfile.school_id
      });
      return subs.length > 0 ? subs[0] : null;
    },
    enabled: !!userProfile?.school_id,
  });

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
  // hay nada entre qué elegir).
  if (!userProfile) {
    return <Onboarding user={user} onComplete={refetchProfiles} />;
  }

  // Pending status
  if (userProfile.status === 'PENDING') {
    return <PendingApproval />;
  }

  // Suspended status
  if (userProfile.status === 'SUSPENDED') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50 p-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-800 mb-2">Cuenta suspendida</h1>
          <p className="text-red-600">Contacta al administrador de tu escuela.</p>
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
