import React from 'react';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';

/**
 * "Cerrar sesión", the same everywhere: SideNav, the ⌘K palette, onboarding,
 * the suspended/pending screens and the not-registered screen. It goes through
 * AuthContext.logout(), which also forgets the remembered identity — calling
 * base44.auth.logout() directly would leave the "Continuar como …" card
 * offering the account the user just left, which on a shared school computer
 * is exactly the wrong thing.
 *
 *   variant="button" (default) → outline button with icon and label
 *   variant="icon"             → square icon button (SideNav footer)
 */
export default function SignOutButton({ variant = 'button', className = '', label = 'Cerrar sesión' }) {
  const { logout } = useAuth();
  const [pending, setPending] = React.useState(false);

  const handleClick = () => {
    if (pending) return;
    setPending(true);
    logout();
  };

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-label={label}
        title={label}
        className={`flex h-8 w-8 coarse:h-11 coarse:w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 ${className}`}
      >
        <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
    );
  }

  return (
    <Button type="button" variant="outline" onClick={handleClick} disabled={pending} className={`gap-2 ${className}`}>
      <LogOut className="h-4 w-4" aria-hidden="true" />
      {pending ? 'Cerrando sesión…' : label}
    </Button>
  );
}
