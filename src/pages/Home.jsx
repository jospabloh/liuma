import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import LoadingScreen from '@/components/ui/LoadingScreen';
import PendingApproval from '@/components/ui/PendingApproval';
import ParentHome from '@/components/home/ParentHome';
import TeacherHome from '@/components/home/TeacherHome';
import AdminHome from '@/components/home/AdminHome';
import Onboarding from '@/components/onboarding/Onboarding';
import SchoolSwitcher from '@/components/home/SchoolSwitcher';
import WelcomeTrialModal from '@/components/subscription/WelcomeTrialModal';
import SuspendedAccountModal from '@/components/subscription/SuspendedAccountModal';
import {
  selectCurrentUserProfile,
  buildTenantSelectionContext,
  getActiveSchoolOverride,
  setActiveSchoolOverride,
} from '@/lib/tenantSelection';

export default function Home() {
  const [user, setUser] = useState(null);
  const [showWelcome, setShowWelcome] = useState(false);
  // Módulo 18: unirse a una segunda escuela vuelve a esta pantalla en vez de
  // navegar fuera de la app — no hay una ruta dedicada, así que no hace
  // falta tocar pages.config.js/routeAccess.js por esto.
  const [joiningAnother, setJoiningAnother] = useState(false);
  const queryClient = useQueryClient();

  // TODOS los perfiles del usuario, no solo el "actual" — es lo que permite
  // ofrecer un selector real cuando hay más de uno, y lo que
  // `selectCurrentUserProfile` necesita para aplicar la preferencia guardada.
  const { data: profiles = [], isLoading: profilesLoading, refetch: refetchProfiles } = useQuery({
    queryKey: ['userProfiles'],
    queryFn: async () => {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      return base44.entities.UserProfile.filter({ user_id: currentUser.id }, '-created_date');
    },
  });

  const userProfile = selectCurrentUserProfile(profiles, getActiveSchoolOverride());

  // El aviso de bienvenida (solo admin) vive en el perfil, no en
  // SchoolSubscription — este efecto reemplaza al que corría dentro del
  // queryFn de antes, ahora que la resolución del perfil se separó del fetch.
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

  // Escuelas de CADA perfil (no solo la actual) — solo hace falta pedirlas
  // cuando hay más de un perfil, que es cuando el switcher se muestra.
  const { data: schools = [] } = useQuery({
    queryKey: ['userProfileSchools', profiles.map((p) => p.school_id).join('|')],
    queryFn: async () => {
      const rows = [];
      for (const profile of profiles) {
        const found = await base44.entities.School.filter({ id: profile.school_id });
        if (found[0]) rows.push(found[0]);
      }
      return rows;
    },
    enabled: profiles.length > 1,
  });

  const tenantSelection = buildTenantSelectionContext({
    profiles,
    schools,
    currentSchoolId: userProfile?.school_id,
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

  const handleSwitchSchool = (schoolId) => {
    setActiveSchoolOverride(schoolId);
    // Recarga completa a propósito, mismo motivo que el resto del portafolio
    // (Módulo 18 §5 del estándar): cada pantalla ya cargó datos de la escuela
    // anterior por `school_id`, y un reset en el lugar es exactamente donde un
    // valor viejo sobrevive en un closure.
    window.location.reload();
  };

  const handleJoinAnotherComplete = () => {
    setJoiningAnother(false);
    refetchProfiles();
  };

  if (profilesLoading) {
    return <LoadingScreen message="Cargando tu perfil..." />;
  }

  if (joiningAnother) {
    return (
      <Onboarding
        user={user}
        onComplete={handleJoinAnotherComplete}
        onCancel={() => setJoiningAnother(false)}
      />
    );
  }

  // Sin ningún perfil todavía — el onboarding de siempre, sin selector (no
  // hay nada entre qué elegir).
  if (!userProfile) {
    return <Onboarding user={user} onComplete={refetchProfiles} />;
  }

  const schoolSwitcher = (
    <SchoolSwitcher
      options={tenantSelection.options}
      onSwitch={handleSwitchSchool}
      onJoinAnother={() => setJoiningAnother(true)}
    />
  );

  // Pending status
  if (userProfile.status === 'PENDING') {
    return (
      <>
        {schoolSwitcher}
        <PendingApproval />
      </>
    );
  }

  // Suspended status
  if (userProfile.status === 'SUSPENDED') {
    return (
      <>
        {schoolSwitcher}
        <div className="min-h-screen flex items-center justify-center bg-red-50 p-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-red-800 mb-2">Cuenta suspendida</h1>
            <p className="text-red-600">Contacta al administrador de tu escuela.</p>
          </div>
        </div>
      </>
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
      {schoolSwitcher}
      <HomeComponent />
    </>
  );
}
