import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import LumiButton from '@/components/ui/LumiButton';
import LumiChat from '@/components/lumi/LumiChat';

import { isLumiBubbleExcluded } from '@/lib/lumi/bubble-visibility';

export default function GlobalLumiBubble() {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  const { data: userProfile, isLoading: isLoadingProfile } = useQuery({
    queryKey: ['globalLumiUserProfile', user?.id],
    queryFn: async () => (await base44.entities.UserProfile.filter({ user_id: user.id }))[0],
    enabled: isAuthenticated && Boolean(user?.id),
  });

  const hidden = useMemo(() => {
    if (!isAuthenticated) return true;
    if (isLoadingProfile) return true;
    if (!userProfile) return true;
    if (userProfile.status && userProfile.status !== 'ACTIVE') return true;
    return isLumiBubbleExcluded(location.pathname);
  }, [isAuthenticated, isLoadingProfile, userProfile, location.pathname]);

  const handleBubbleToggle = useCallback(() => {
    setIsOpen((current) => !current);
  }, []);

  const handleChatClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Allow other parts of the app (e.g. the Soporte page) to open the assistant.
  useEffect(() => {
    const openLumi = () => setIsOpen(true);
    window.addEventListener('lumi:open', openLumi);
    return () => window.removeEventListener('lumi:open', openLumi);
  }, []);

  if (hidden) return null;

  return (
    <>
      <LumiButton isOpen={isOpen} onClick={handleBubbleToggle} className="bottom-4 right-4 md:bottom-6 md:right-6" />
      <LumiChat isOpen={isOpen} onClose={handleChatClose} userProfile={userProfile} />
    </>
  );
}
