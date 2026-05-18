import React, { useMemo, useState } from 'react';
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

  const { data: userProfile } = useQuery({
    queryKey: ['globalLumiUserProfile', user?.id],
    queryFn: async () => (await base44.entities.UserProfile.filter({ user_id: user.id }))[0],
    enabled: isAuthenticated && Boolean(user?.id),
  });

  const hidden = useMemo(() => {
    if (!isAuthenticated) return true;
    return isLumiBubbleExcluded(location.pathname);
  }, [isAuthenticated, location.pathname]);

  if (hidden) return null;

  return (
    <>
      <LumiButton onClick={() => setIsOpen(true)} className="bottom-4 right-4 md:bottom-6 md:right-6" />
      <LumiChat isOpen={isOpen} onClose={() => setIsOpen(false)} userProfile={userProfile} />
    </>
  );
}
