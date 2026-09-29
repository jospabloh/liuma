import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import LumiButton from '@/components/ui/LumiButton';

import { isLumiBubbleExcluded } from '@/lib/lumi/bubble-visibility';

// The chat (and react-markdown with its whole micromark/mdast tree) is only
// needed once someone opens Lumi, so it is its own chunk instead of part of
// the bundle every login screen downloads. It is prefetched when the browser
// is idle, so the first tap does not wait on the network.
const loadLumiChat = () => import('@/components/lumi/LumiChat');
const LumiChat = lazy(loadLumiChat);

// Read by src/index.css to hide the corner ThemeSwitcher while the chat is
// open (the switcher is z-50 like the dialog and floated over its input).
// The switcher itself is portfolio-canonical and must not be edited here.
const OPEN_ATTRIBUTE = 'data-lumi-open';

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

  const chatVisible = isOpen && !hidden;

  useEffect(() => {
    const root = document.documentElement;
    if (chatVisible) root.setAttribute(OPEN_ATTRIBUTE, '');
    else root.removeAttribute(OPEN_ATTRIBUTE);
    return () => root.removeAttribute(OPEN_ATTRIBUTE);
  }, [chatVisible]);

  useEffect(() => {
    if (hidden) return undefined;
    const prefetch = () => {
      loadLumiChat().catch(() => {
        // Offline or a stale deploy: the lazy import retries on open.
      });
    };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(prefetch, { timeout: 4000 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const timer = setTimeout(prefetch, 2000);
    return () => clearTimeout(timer);
  }, [hidden]);

  if (hidden) return null;

  return (
    <>
      {/* On mobile the persistent bottom nav is 64px tall (h-16); sit above it.
          The nav is hidden at md+, so drop back to the corner there. The
          corner ThemeSwitcher is lifted above this bubble in src/index.css. */}
      <LumiButton isOpen={isOpen} onClick={handleBubbleToggle} className="bottom-20 right-4 md:bottom-6 md:right-6" />
      <Suspense fallback={null}>
        <AnimatePresence>
          {chatVisible && (
            <LumiChat key="lumi-chat" onClose={handleChatClose} userProfile={userProfile} />
          )}
        </AnimatePresence>
      </Suspense>
    </>
  );
}
