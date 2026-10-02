import React from 'react';
import { Link } from 'react-router-dom';
import { ACCOUNT_DELETION_PATH, ACCOUNT_DELETION_TITLE } from '@/lib/account/accountDeletion';

/**
 * "Eliminar mi cuenta y mis datos" for the screens that have no menu: waiting
 * for approval, suspended, and onboarding. The legal texts promise the option
 * to every user (Aviso § 10, Términos § 6), not only to ACTIVE ones, and the
 * route is open to anyone signed in (routeAccess.js#OWN_ACCOUNT_ROUTES).
 */
export default function DeleteAccountLink({ className = '' }) {
  return (
    <Link
      to={ACCOUNT_DELETION_PATH}
      className={`inline-flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground ${className}`}
    >
      {ACCOUNT_DELETION_TITLE}
    </Link>
  );
}
