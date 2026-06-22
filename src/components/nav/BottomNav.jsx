import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { NavIcon } from './navIcons.jsx';
import { useNav } from './NavContext.jsx';
import { getPrimaryTabs, isActivePath, pageUrl } from './navRegistry';

/**
 * Persistent mobile bottom navigation. Four fixed tabs — Inicio · Hoy · Avisos ·
 * Más — so any screen is one tap away without returning to the home grid. The
 * "Más" tab opens the command palette (shared via NavContext). Rendered once
 * from Layout; hides itself until a profile (role) is available, which keeps it
 * off the login/onboarding screens.
 */
export default function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { role, openPalette } = useNav();

  // No role yet (loading, logged out, onboarding) → don't show the bar.
  if (!role) return null;

  const tabs = getPrimaryTabs(role);

  const handleTab = (tab) => {
    if (tab.action === 'palette') {
      openPalette();
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
    </>
  );
}
