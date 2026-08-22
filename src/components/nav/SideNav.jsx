import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Search, LifeBuoy } from 'lucide-react';
import { NavIcon } from './navIcons.jsx';
import { useNav } from './NavContext.jsx';
import { getGroupedDestinations, isActivePath, pageUrl } from './navRegistry';

/**
 * Persistent desktop navigation rail (md and up). Mobile keeps the four-item
 * BottomNav; on a wide screen there is room for the role's full menu to live
 * permanently on the left, so switching sections never bounces back to the home
 * grid. Reads the exact same source of truth as the bottom bar and the command
 * palette (navRegistry), so there is still only one place to curate navigation.
 *
 * The active item is marked with an accent left bar + tinted brand background
 * and aria-current. Navigation is client-side (<Link>), so there is no reload
 * and React Query cache / router state are preserved. Brand color comes from the
 * tenant theme token (`brand`), never a hardcoded hex.
 */

const ROLE_LABELS = {
  ADMIN: 'Administración',
  TEACHER: 'Maestro',
  PARENT: 'Familia',
};

/** Two-letter initials from a name/email, for the identity avatar. */
function initialsOf(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function SideNav() {
  const { pathname } = useLocation();
  const { role, user, openPalette } = useNav();

  // No role yet (loading, logged out, onboarding) → don't show the rail, so it
  // stays off the login/onboarding screens just like the bottom bar.
  if (!role) return null;

  const groups = getGroupedDestinations(role);
  const homeActive = isActivePath(pathname, 'Home');
  const displayName = user?.full_name || user?.email || 'Tu cuenta';

  const itemClass = (active) =>
    `group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-150 ${
      active
        ? 'bg-brand/10 font-semibold text-brand'
        : 'font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
    }`;

  // The accent left bar that marks the active item (sits in the rail gutter).
  const ActiveBar = ({ active }) =>
    active ? (
      <span className="absolute -left-3 top-1/2 h-5 -translate-y-1/2 rounded-r-full border-l-2 border-brand bg-brand" aria-hidden="true" />
    ) : null;

  return (
    <nav
      className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-border bg-card/80 shadow-[1px_0_0_0_hsl(var(--border)),8px_0_24px_-20px_rgba(0,0,0,0.35)] backdrop-blur-xl md:flex"
      aria-label="Navegación principal"
    >
      {/* Brand lockup */}
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-base font-bold text-white shadow-sm shadow-brand/30"
          aria-hidden="true"
        >
          L
        </span>
        <div className="leading-tight">
          <p className="text-[15px] font-semibold tracking-tight text-foreground">
            LIU<span className="text-brand">MA</span>
          </p>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
            {ROLE_LABELS[role] || 'Familia'}
          </p>
        </div>
      </div>

      {/* Search / command palette trigger */}
      <div className="px-3">
        <button
          type="button"
          onClick={openPalette}
          className="flex w-full items-center gap-2 rounded-xl border border-border bg-background/60 px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-brand/40 hover:bg-accent hover:text-foreground"
        >
          <Search className="h-4 w-4" />
          <span>Buscar…</span>
          <kbd className="ml-auto rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Scrollable destination list */}
      <div className="ui-thin-scroll mt-4 flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        {/* Inicio is not part of any destination group, so it gets its own
            top-level entry mirroring the bottom bar's first tab. */}
        <Link to={pageUrl('Home')} className={itemClass(homeActive)} aria-current={homeActive ? 'page' : undefined}>
          <ActiveBar active={homeActive} />
          <NavIcon name="Home" className="h-[18px] w-[18px] shrink-0" />
          <span>Inicio</span>
        </Link>

        {groups.map(({ group, items }) => (
          <div key={group} className="space-y-1">
            <p className="px-3 pb-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60">
              {group}
            </p>
            {items.map((dest) => {
              const active = isActivePath(pathname, dest.page);
              return (
                <Link
                  key={dest.page}
                  to={pageUrl(dest.page)}
                  className={itemClass(active)}
                  aria-current={active ? 'page' : undefined}
                >
                  <ActiveBar active={active} />
                  <NavIcon name={dest.icon} className="h-[18px] w-[18px] shrink-0" />
                  <span className="truncate">{dest.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      {/* Identity footer — who you are + a one-click route to support. */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-1.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-bold text-brand">
            {initialsOf(displayName)}
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
            <p className="truncate text-[11px] text-muted-foreground">{ROLE_LABELS[role] || 'Familia'}</p>
          </div>
          <Link
            to={pageUrl(role === 'PARENT' || role === 'TEACHER' ? 'Soporte' : 'SoporteAdmin')}
            aria-label="Soporte"
            title="Soporte"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <LifeBuoy className="h-[18px] w-[18px]" />
          </Link>
        </div>
      </div>
    </nav>
  );
}
