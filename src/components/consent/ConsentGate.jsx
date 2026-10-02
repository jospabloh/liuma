import React from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { profileConsentIsCurrent } from '@/lib/consent/privacyNotice';
import { CONSENT_STATUS_QUERY_KEY, fetchConsentStatus } from '@/lib/consent/consentApi';
import { ACCOUNT_DELETION_PATH, accountDeletedAt, accountDeletionStartedAt } from '@/lib/account/accountDeletion';
import { decideConsentGate } from '@/lib/consent/consentGate';
import { humanizeError } from '@/lib/errorMessages';
import { Button } from '@/components/ui/button';
import SignOutButton from '@/components/auth/SignOutButton';
import ConsentScreen from './ConsentScreen';
import AccountDeletedScreen from './AccountDeletedScreen';

const EliminarCuenta = React.lazy(() => import('@/pages/EliminarCuenta'));

const Spinner = () => (
  <div className="fixed inset-0 flex items-center justify-center bg-background" role="status" aria-label="Cargando">
    <div className="w-8 h-8 border-4 border-slate-200 dark:border-slate-800 border-t-slate-800 dark:border-t-slate-200 rounded-full animate-spin" />
  </div>
);

/**
 * Mandatory consent (v1.9.0, owner decision 2026-10-02). Wraps every
 * authenticated screen in App.jsx: a person with a school profile whose
 * consent stamp is not the CURRENT Aviso de Privacidad + Términos sees the
 * consent screen and nothing else — not the menu, not Home, not Lumi. The two
 * ways out are "Aceptar" (myConsent records it, the app opens) and "No
 * acepto" (the "Eliminar mi cuenta y mis datos" page, where they can still
 * change their mind with "Volver y aceptar").
 *
 * Still reachable while gated: the public legal pages (App.jsx renders them
 * before this component) and the deletion page (rendered here, without the
 * Layout, whose menu and badges would hit functions that refuse a profile
 * without consent).
 *
 * The server enforces the same rule (CONSENT_REQUIRED in schoolRead, the
 * write paths, Lumi…), so a cached bundle without this screen gets no data
 * either. This screen is what makes the refusal understandable.
 *
 * A person with no profile yet (onboarding) is not gated here: onboarding
 * records its own consent (provisionOnboardingProfile).
 */
export default function ConsentGate({ children }) {
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const { user, userProfile, profileQuery, isLoading } = useCurrentProfile();

  const stampIsCurrent = profileConsentIsCurrent(userProfile);
  const needsStatus = Boolean(user?.id && userProfile?.id && !stampIsCurrent && !accountDeletedAt(user) && !accountDeletionStartedAt(user));
  const statusQuery = useQuery({
    queryKey: [CONSENT_STATUS_QUERY_KEY, user?.id, userProfile?.id],
    queryFn: fetchConsentStatus,
    enabled: needsStatus,
    staleTime: 0,
  });

  const decision = decideConsentGate({
    user,
    profile: userProfile,
    profileLoading: isLoading,
    profileFailed: Boolean(profileQuery?.isError),
    status: statusQuery.data,
    statusLoading: needsStatus && statusQuery.isLoading,
    statusFailed: needsStatus && statusQuery.isError,
    pathname,
  });

  // The server repaired a missing stamp from an existing record: reload the
  // profile so the next render passes on the stamp alone.
  const repaired = statusQuery.data?.repaired === true;
  React.useEffect(() => {
    if (repaired) queryClient.invalidateQueries({ queryKey: ['userProfile'] });
  }, [repaired, queryClient]);

  if (decision === 'loading') return <Spinner />;
  if (decision === 'deleted') return <AccountDeletedScreen />;
  if (decision === 'status_error') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
        <div role="alert" className="w-full max-w-md rounded-2xl border border-border bg-card p-5 space-y-4 text-card-foreground">
          <p className="font-semibold">No pudimos comprobar tu aceptación del Aviso de Privacidad.</p>
          <p className="text-sm text-muted-foreground">{humanizeError(statusQuery.error)}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button className="min-h-11" onClick={() => statusQuery.refetch()}>Reintentar</Button>
            <SignOutButton className="min-h-11" />
          </div>
        </div>
      </div>
    );
  }
  if (decision === 'deletion_in_progress') {
    return (
      <React.Suspense fallback={<Spinner />}>
        <EliminarCuenta gated resume />
      </React.Suspense>
    );
  }
  if (decision === 'deletion_page') {
    return (
      <React.Suspense fallback={<Spinner />}>
        <EliminarCuenta gated />
      </React.Suspense>
    );
  }
  if (decision === 'consent') {
    return (
      <ConsentScreen
        role={statusQuery.data?.role || userProfile?.app_role}
        acceptedVersion={statusQuery.data?.acceptedVersion || null}
        declinePath={ACCOUNT_DELETION_PATH}
      />
    );
  }
  return children;
}
