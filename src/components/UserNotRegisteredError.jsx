import React from 'react';
import { UserX, Mail } from 'lucide-react';
import SignOutButton from '@/components/auth/SignOutButton';
import { useAuth } from '@/lib/AuthContext';
import { SUPPORT_EMAIL } from '@/lib/support/constants';

// Base44 answered `user_not_registered`: this account is signed in but is not
// a user of LIUMA. Usually it's the wrong account (a personal Gmail instead of
// the one the school invited), so the way out — sign out and use the other
// one — is the primary action, not a bullet point. Before this the screen was
// in English and had no exit at all.
const UserNotRegisteredError = () => {
  const { user } = useAuth();
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Acceso a LIUMA')}`;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-background to-muted p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-card-foreground shadow-lg">
        <div className="text-center">
          <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
            <UserX className="h-8 w-8 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          </div>
          <h1 className="mb-3 text-2xl font-bold text-foreground">Esta cuenta no tiene acceso a LIUMA</h1>
          <p className="mb-6 text-muted-foreground">
            {user?.email ? (
              <>Entraste como <strong className="text-foreground">{user.email}</strong>, que no está registrada en LIUMA.</>
            ) : (
              'La cuenta con la que entraste no está registrada en LIUMA.'
            )}
          </p>
          <div className="mb-6 rounded-xl bg-muted p-4 text-left text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Qué puedes hacer:</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>Cierra sesión y entra con el correo que registró tu escuela.</li>
              <li>Pide a la dirección de tu escuela que te dé acceso.</li>
            </ul>
          </div>
          <div className="flex flex-col items-center gap-3">
            <SignOutButton label="Cerrar sesión y usar otra cuenta" className="w-full" />
            <a
              href={mailto}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              Escríbenos a {SUPPORT_EMAIL}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserNotRegisteredError;
