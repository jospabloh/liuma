import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
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
  const reduceMotion = useReducedMotion();

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
        style={{
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)',
        }}
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
                className={`mobile-touch-target relative flex flex-col items-center justify-center gap-1 py-2 text-[11px] transition-colors ${
                  active ? 'text-brand font-semibold' : 'text-muted-foreground font-medium hover:text-foreground'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                {/* Signature: a single brand indicator that slides between tabs
                    to mark where you are (shared layoutId = orchestrated move). */}
                {active && (
                  <motion.span
                    layoutId={reduceMotion ? undefined : 'bottomNavIndicator'}
                    className="absolute top-0 h-[3px] w-7 rounded-full bg-brand"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
                <NavIcon name={tab.icon} className={`h-5 w-5 transition-transform ${active ? '-translate-y-px' : ''}`} />
                <span className="tracking-wide">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Spacer so the fixed bar never covers page content on mobile. It must
          grow with the bar: the bar is 4rem PLUS the home-indicator inset
          (34px on a notched iPhone), so a flat h-16 would leave the last 34px
          of every page under the nav once viewport-fit=cover makes the inset
          real. */}
      <div
        className="h-16 md:hidden"
        style={{ height: 'calc(4rem + env(safe-area-inset-bottom, 0px))' }}
        aria-hidden="true"
        data-bottom-nav-spacer=""
      />
    </>
  );
}
