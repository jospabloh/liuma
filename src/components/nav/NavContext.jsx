import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import CommandPalette from './CommandPalette.jsx';
import DisplayNameDialog from '@/components/account/DisplayNameDialog';
import { selectCurrentUserProfile } from '@/lib/tenantSelection';
import { shouldPromptForName } from '@/lib/userDisplayName';

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
  // Un perfil PENDING o SUSPENDED no tiene menú: Home le pinta la pantalla de
  // espera / suspensión, y un rail de «Familia» al lado prometía secciones a las
  // que ese perfil no entra (schoolRead lo rechaza con INACTIVE_PROFILE).
  const inactive = profile?.status === 'PENDING' || profile?.status === 'SUSPENDED';
  const role = inactive ? null : profile?.app_role || null;

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  // "¿Cómo te llamas?": asked once, by itself, to an ACTIVE member whose
  // account has no real name (full_name empty or an email handle — live QA
  // of v1.8.5 greeted "Hola, h.josepablo+qa-padre"), then reachable from the
  // account menu as an edit. Not on the login, onboarding or pending screens:
  // `role` is null there.
  const [nameDialog, setNameDialog] = useState(null); // null | 'prompt' | 'edit'
  const openNameDialog = useCallback(() => setNameDialog('edit'), []);
  // At most once per page load; "Ahora no" is also stored per user.
  const askedForName = useRef(false);
  useEffect(() => {
    if (askedForName.current || !role || nameDialog !== null) return;
    if (shouldPromptForName(user)) {
      askedForName.current = true;
      setNameDialog('prompt');
    }
  }, [role, user, nameDialog]);

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
    <NavContext.Provider value={{ role, user, profile, paletteOpen, openPalette, closePalette, openNameDialog }}>
      {children}
      {role && <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} role={role} onEditName={openNameDialog} />}
      {role && user && (
        <DisplayNameDialog
          open={nameDialog !== null}
          onOpenChange={(next) => { if (!next) setNameDialog(null); }}
          user={user}
          mode={nameDialog === 'prompt' ? 'prompt' : 'edit'}
        />
      )}
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
      openNameDialog: () => {},
    }
  );
}
