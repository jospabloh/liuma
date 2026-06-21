import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { NavIcon } from './navIcons.jsx';
import CommandPalette from './CommandPalette.jsx';
import { getPrimaryTabs, isActivePath, pageUrl } from './navRegistry';

/**
 * Persistent mobile bottom navigation. Four fixed tabs — Inicio · Hoy · Avisos ·
 * Menú — so any screen is one tap away without returning to the home grid. The
 * "Menú" tab and ⌘K open the command palette. Rendered once from Layout, so it
 * appears on every authenticated page; it hides itself until a profile (role)
 * is available, which also keeps it off the login/onboarding screens.
 */
export default function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const { data: user } = useQuery({ queryKey: ['currentUser'], queryFn: () => base44.auth.me() });
  const { data: profile } = useQuery({
    queryKey: ['userProfile', user?.id],
    queryFn: async () => (await base44.entities.UserProfile.filter({ user_id: user.id }))[0],
    enabled: !!user,
  });
  const role = profile?.app_role;

  // ⌘K / Ctrl+K toggles the palette.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // No role yet (loading, logged out, onboarding) → don't show the bar.
  if (!role) return null;

  const tabs = getPrimaryTabs(role);

  const handleTab = (tab) => {
    if (tab.action === 'palette') {
      setPaletteOpen(true);
      return;
    }
    navigate(pageUrl(tab.page));
  };

  return (
    <>
      <nav
        className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Navegación principal"
      >
        <div className="mx-auto grid max-w-lg grid-cols-4">
          {tabs.map((tab) => {
            const active = tab.page ? isActivePath(pathname, tab.page) : false;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleTab(tab)}
                className={`mobile-touch-target flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
                  active ? 'text-brand' : 'text-muted-foreground hover:text-foreground'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <NavIcon name={tab.icon} className="h-5 w-5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Spacer so fixed bar never covers page content on mobile. */}
      <div className="h-16 md:hidden" aria-hidden="true" />

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} role={role} />
    </>
  );
}
