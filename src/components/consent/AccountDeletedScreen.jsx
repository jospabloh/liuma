import React from 'react';
import { UserX } from 'lucide-react';
import SignOutButton from '@/components/auth/SignOutButton';
import { ACACIA_SUPPORT_EMAIL } from '@/lib/legal/legalDocs';

/**
 * Shown to an account that deleteMyAccount marked as deleted but Base44 has
 * not removed yet (the removal is retried by ACACIA from the panel). Without
 * this, the person would land in onboarding — which refuses them anyway
 * (provisionOnboardingProfile → ACCOUNT_DELETED) — with no explanation.
 */
export default function AccountDeletedScreen() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <main className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-5 text-card-foreground" aria-labelledby="deleted-title">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
          <UserX className="h-6 w-6" />
        </span>
        <h1 id="deleted-title" className="text-xl font-semibold">Esta cuenta se eliminó</h1>
        <p className="text-sm text-muted-foreground">
          Tu cuenta de LIUMA y tus datos se están suprimiendo. Ya no puedes usar LIUMA con ella.
          Si quieres volver, o crees que es un error, escribe a{' '}
          <a href={`mailto:${ACACIA_SUPPORT_EMAIL}`} className="text-brand underline coarse:inline-flex coarse:min-h-11 coarse:items-center">{ACACIA_SUPPORT_EMAIL}</a>.
        </p>
        <SignOutButton className="min-h-11 w-full sm:w-auto" />
      </main>
    </div>
  );
}
