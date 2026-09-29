import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
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
// React.lazy caches a rejected import forever, so after a failed load (offline,
// or a chunk hash that a newer deploy removed) the boundary below swaps in a
// fresh lazy wrapper. Browsers may also cache the failed module URL for the
// page's lifetime, which is why the toast asks for a reload.
let LumiChat = lazy(loadLumiChat);

// A chunk that fails to load throws into the tree, and there is no error
// boundary above Layout: without this, tapping Lumi on a stale tab would blank
// the whole app instead of just not opening the chat.
class LumiChatBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('Lumi chat failed to load:', error);
    LumiChat = lazy(loadLumiChat);
    this.props.onFail();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// Read by src/index.css. `data-lumi-bubble`: the bubble owns the bottom-right
// corner, so lift the corner ThemeSwitcher above it (only while the bubble is
// actually on screen — not on login or excluded routes). `data-lumi-open`:
// hide the switcher while the chat is open (it is z-50 like the dialog and
// floated over its input). The switcher itself is portfolio-canonical and
// must not be edited here.
const BUBBLE_ATTRIBUTE = 'data-lumi-bubble';
const OPEN_ATTRIBUTE = 'data-lumi-open';

export default function GlobalLumiBubble() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

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

  const handleLoadFailure = useCallback(() => {
    setIsOpen(false);
    setLoadAttempt((n) => n + 1);
    toast.error('No se pudo abrir Lumi. Revisa tu conexión y recarga la página.');
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (hidden) root.removeAttribute(BUBBLE_ATTRIBUTE);
    else root.setAttribute(BUBBLE_ATTRIBUTE, '');
    return () => root.removeAttribute(BUBBLE_ATTRIBUTE);
  }, [hidden]);

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
        // Offline or a stale deploy: opening the chat will fail too, and the
        // boundary turns that into a toast instead of a blank app.
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
      <LumiChatBoundary key={loadAttempt} onFail={handleLoadFailure}>
        <Suspense fallback={null}>
          <AnimatePresence>
            {chatVisible && (
              <LumiChat key="lumi-chat" onClose={handleChatClose} userProfile={userProfile} />
            )}
          </AnimatePresence>
        </Suspense>
      </LumiChatBoundary>
    </>
  );
}
