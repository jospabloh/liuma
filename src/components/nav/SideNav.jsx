import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Search } from 'lucide-react';
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
 * The active item is marked with an accent left border + tinted background
 * (brand color, opacity-driven) and aria-current, matching the bottom bar's
 * brand indicator. Navigation is client-side (<Link>), so there is no reload
 * and React Query cache / router state are preserved.
 */

const ROLE_LABELS = {
  ADMIN: 'Administración',
  TEACHER: 'Maestro',
  PARENT: 'Familia',
};

export default function SideNav() {
  const { pathname } = useLocation();
  const { role, openPalette } = useNav();

  // No role yet (loading, logged out, onboarding) → don't show the rail, so it
  // stays off the login/onboarding screens just like the bottom bar.
  if (!role) return null;

  const groups = getGroupedDestinations(role);
  const homeActive = isActivePath(pathname, 'Home');

  const itemClass = (active) =>
    `group flex items-center gap-3 rounded-lg border-l-2 px-3 py-2 text-sm transition-colors ${
      active
        ? 'border-brand bg-brand/10 font-medium text-brand'
        : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
    }`;

  return (
    <nav
      className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-background/95 backdrop-blur md:flex"
      aria-label="Navegación principal"
    >
      {/* Brand header */}
      <div className="flex items-center justify-between px-5 py-5">
        <Link to={pageUrl('Home')} className="text-xl font-semibold tracking-tight text-foreground">
          LIU<span className="text-brand">MA</span>
        </Link>
        <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {ROLE_LABELS[role] || 'Familia'}
        </span>
      </div>

      {/* Search / command palette trigger */}
      <div className="px-3">
        <button
          type="button"
          onClick={openPalette}
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Search className="h-4 w-4" />
          <span>Buscar…</span>
          <kbd className="ml-auto rounded border border-border bg-background px-1.5 text-[10px] font-medium text-muted-foreground">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Scrollable destination list */}
      <div className="mt-3 flex-1 space-y-5 overflow-y-auto px-3 pb-6">
        {/* Inicio is not part of any destination group, so it gets its own
            top-level entry mirroring the bottom bar's first tab. */}
        <Link to={pageUrl('Home')} className={itemClass(homeActive)} aria-current={homeActive ? 'page' : undefined}>
          <NavIcon name="Home" className="h-[18px] w-[18px]" />
          <span>Inicio</span>
        </Link>

        {groups.map(({ group, items }) => (
          <div key={group} className="space-y-1">
            <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
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
                  <NavIcon name={dest.icon} className="h-[18px] w-[18px]" />
                  <span className="truncate">{dest.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
