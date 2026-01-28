import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import LoadingScreen from '@/components/ui/LoadingScreen';
import PendingApproval from '@/components/ui/PendingApproval';
import ParentHome from '@/components/home/ParentHome';
import TeacherHome from '@/components/home/TeacherHome';
import AdminHome from '@/components/home/AdminHome';
import Onboarding from '@/components/onboarding/Onboarding';
import WelcomeTrialModal from '@/components/subscription/WelcomeTrialModal';
import PaymentReminderBanner from '@/components/subscription/PaymentReminderBanner';
import SuspendedAccountModal from '@/components/subscription/SuspendedAccountModal';

export default function Home() {
  const [user, setUser] = useState(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const queryClient = useQueryClient();
  
  const { data: userProfile, isLoading: profileLoading, refetch: refetchProfile } = useQuery({
    queryKey: ['userProfile'],
    queryFn: async () => {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      const profiles = await base44.entities.UserProfile.filter({ user_id: currentUser.id });
      return profiles[0] || null;
    },
  });

  const { data: subscription } = useQuery({
    queryKey: ['schoolSubscription', userProfile?.school_id],
    queryFn: async () => {
      const subs = await base44.entities.SchoolSubscription.filter({ 
        school_id: userProfile.school_id 
      });
      if (subs.length > 0) {
        if (!subs[0].welcome_message_shown) {
          setShowWelcome(true);
        }
        return subs[0];
      }
      return null;
    },
    enabled: !!userProfile?.school_id,
  });

  const markWelcomeShownMutation = useMutation({
    mutationFn: async () => {
      await base44.entities.SchoolSubscription.update(subscription.id, {
        welcome_message_shown: true
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['schoolSubscription']);
      setShowWelcome(false);
    }
  });

  const handleCloseWelcome = () => {
    markWelcomeShownMutation.mutate();
  };

  if (profileLoading) {
    return <LoadingScreen message="Cargando tu perfil..." />;
  }

  // No profile - show onboarding
  if (!userProfile) {
    return <Onboarding user={user} onComplete={refetchProfile} />;
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