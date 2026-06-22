import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import LumiButton from '@/components/ui/LumiButton';
import LumiChat from '@/components/lumi/LumiChat';

import { isLumiBubbleExcluded } from '@/lib/lumi/bubble-visibility';

export default function GlobalLumiBubble() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  // Reuse the shared profile hook (shared ['userProfile', user.id] cache key)
  // rather than a second, separately-keyed UserProfile fetch.
  const { userProfile, isLoading: isLoadingProfile } = useCurrentProfile();

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
      {/* On mobile the persistent bottom nav is 64px tall (h-16); sit above it.
          The nav is hidden at md+, so drop back to the corner there. */}
      <LumiButton isOpen={isOpen} onClick={handleBubbleToggle} className="bottom-20 right-4 md:bottom-6 md:right-6" />
      <LumiChat isOpen={isOpen} onClose={handleChatClose} userProfile={userProfile} />
    </>
  );
}
