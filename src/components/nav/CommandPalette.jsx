import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandSeparator,
} from '@/components/ui/command';
import { useAuth } from '@/lib/AuthContext';
import { NavIcon } from './navIcons.jsx';
import { getGroupedDestinations, pageUrl } from './navRegistry';

/**
 * ⌘K command palette — type to jump anywhere, or browse the role's full menu.
 * Shared destination list with the bottom bar (navRegistry), so there's one
 * place to curate navigation. Opened from the "Más" tab or the keyboard.
 *
 * "Cerrar sesión" closes the list: on a phone the "Más" tab is the only
 * persistent chrome, so this is the one place a parent on a shared phone can
 * sign out (the SideNav footer carries it on desktop).
 */
export default function CommandPalette({ open, onOpenChange, role }) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const groups = getGroupedDestinations(role);

  const go = (page) => {
    onOpenChange(false);
    navigate(pageUrl(page));
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="¿Qué necesitas? Busca o navega…" />
      <CommandList>
        <CommandEmpty>Nada con ese nombre. Prueba con otra palabra.</CommandEmpty>
        {groups.map(({ group, items }) => (
          <CommandGroup key={group} heading={group}>
            {items.map((dest) => (
              <CommandItem
                key={dest.page}
                value={`${dest.label} ${dest.group}`}
                onSelect={() => go(dest.page)}
              >
                <NavIcon name={dest.icon} className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>{dest.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading="Cuenta">
          <CommandItem value="Cerrar sesión salir logout" onSelect={() => { onOpenChange(false); logout(); }}>
            <LogOut className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span>Cerrar sesión</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
