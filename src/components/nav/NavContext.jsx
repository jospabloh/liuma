import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import CommandPalette from './CommandPalette.jsx';
import { selectCurrentUserProfile } from '@/lib/tenantSelection';

/**
 * Shared navigation state so the command palette can be opened from anywhere —
 * the bottom bar's "Más" tab, the ⌘K shortcut, and the search button in every
 * page header — while the palette itself is rendered once. Holds the current
 * role (fetched via the shared react-query keys) so consumers don't each refetch
 * the profile.
 */
/**
 * Exported so a non-app harness (the dev-only preview gallery) can render the
 * real SideNav against a mocked value without standing up base44/auth. The app
 * itself never imports the raw context — it uses NavProvider / useNav.
 */
export const NavContext = createContext(null);

export function NavProvider({ children }) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  const { data: user } = useQuery({ queryKey: ['currentUser'], queryFn: () => base44.auth.me() });
  // Módulo 18: misma regla que Home.jsx (`selectCurrentUserProfile` +
  // la preferencia guardada), no un `[0]` sin ordenar — antes de esto podía
  // discrepar en cuanto el usuario tuviera perfil en más de una escuela.
  const { data: profile } = useQuery({
    queryKey: ['userProfiles', user?.id],
    queryFn: async () => {
      const profiles = await base44.entities.UserProfile.filter({ user_id: user.id }, '-created_date');
      return selectCurrentUserProfile(profiles);
    },
    enabled: !!user,
  });
  const role = profile?.app_role || null;

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  // ⌘K / Ctrl+K toggles the palette from anywhere.
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

  return (
    <NavContext.Provider value={{ role, user, profile, paletteOpen, openPalette, closePalette }}>
      {children}
      {role && <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} role={role} />}
    </NavContext.Provider>
  );
}

/**
 * Safe to call outside a provider (returns inert defaults), so shared components
 * like PageHeader can offer a search button without assuming the provider is
 * mounted (e.g. on auth/error screens).
 */
export function useNav() {
  return (
    useContext(NavContext) || {
      role: null,
      user: null,
      profile: null,
      paletteOpen: false,
      openPalette: () => {},
      closePalette: () => {},
    }
  );
}
