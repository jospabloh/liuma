import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import RouteAccessDenied from '@/components/RouteAccessDenied';
import { DEFAULT_DENIED_REDIRECT, getRouteAccessDecision } from '@/lib/authorization/routeAccess';
import { AUDIT_ACTIONS, logAccessDeniedEvent, logAuditEvent } from '@/lib/audit';
import { getOwnerScopedAccess } from '@/lib/authorization/policy';
import { selectCurrentUserProfile } from '@/lib/tenantSelection';

// Neutral placeholder while we still don't know who the user is. Deciding
// before both queries answer used to flash "Acceso denegado · Perfil no
// provisionado" on every deep link (a notification e-mail, a refresh).
function GuardSkeleton() {
  return (
    <div className="min-h-[30vh] w-full px-4 py-6 sm:py-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando…</span>
      <div className="mx-auto max-w-sm space-y-4 animate-pulse">
        <div className="h-6 w-2/3 rounded-md bg-muted" />
        <div className="h-4 w-full rounded-md bg-muted" />
        <div className="h-4 w-5/6 rounded-md bg-muted" />
      </div>
    </div>
  );
}

export default function GuardedRoute({ routeName, children }) {
  const { data: user, isFetched: userFetched } = useQuery({ queryKey: ['currentUser'], queryFn: () => base44.auth.me() });
  const { data: profiles = [], isFetched: profilesFetched } = useQuery({
    queryKey: ['profileRouteGuard', user?.id],
    queryFn: () => base44.entities.UserProfile.filter({ user_id: user.id }, '-created_date'),
    enabled: !!user?.id,
  });
  // The same rule as Home/NavContext/useSubscription — not the first row of the
  // query, which could pick a different school/role than the rest of the app.
  const profile = selectCurrentUserProfile(profiles);
  const decided = userFetched && (!user?.id || profilesFetched);

  // Owner override is derived from the server-persisted super-admin UserProfile, not from
  // any client-embedded owner identity. Owner email/id are never shipped in the bundle.
  const ownerAccess = getOwnerScopedAccess({
    currentUser: user,
    actorSchoolId: profile?.school_id,
    targetSchoolId: profile?.school_id,
    ownerProfiles: profiles,
  });

  const routeDecision = getRouteAccessDecision({
    role: profile?.app_role,
    routeName,
    ownerAccess,
    // A profile with no status is PENDING by schema default.
    profileStatus: profile ? (profile.status || 'PENDING') : undefined,
    isPlatformOwner: user?.role === 'admin',
  });

  React.useEffect(() => {
    if (!decided || routeDecision.allowed || !routeName) return;
    logAccessDeniedEvent({
      user,
      userProfile: profile,
      route: routeName,
      reason: routeDecision.reason_code || routeDecision.reason,
      tenantId: profile?.school_id || null,
      context: {
        policy_decision: 'deny',
        precedence: routeDecision.precedence,
        role: profile?.app_role || null,
        profile_status: profile?.status || null,
        owner_denied: routeDecision.owner_denied || false,
        owner_reason: routeDecision.owner_reason || null,
      },
    });
  }, [decided, routeDecision.allowed, routeDecision.reason_code, routeDecision.reason, routeDecision.precedence, routeDecision.owner_denied, routeDecision.owner_reason, user, profile, routeName]);

  React.useEffect(() => {
    if (routeDecision.precedence !== 'owner_override' || !user || !profile) return;
    logAuditEvent({
      user,
      userProfile: profile,
      entity: 'Route',
      entityId: routeName,
      action: AUDIT_ACTIONS.OWNER_OVERRIDE,
      reason: 'owner_override',
      context: {
        route: routeName,
        policy_decision: 'allow',
        precedence: routeDecision.precedence,
        owner_identity_source: routeDecision.identity_source,
        actor_school_id: profile.school_id,
        target_school_id: profile.school_id,
      },
    });
  }, [routeDecision.precedence, routeDecision.identity_source, user, profile, routeName]);

  if (!decided) return <GuardSkeleton />;

  if (!routeDecision.allowed) {
    const profileMissing = Boolean(user) && profiles.length === 0;
    return (
      <RouteAccessDenied
        redirectTo={DEFAULT_DENIED_REDIRECT}
        reasonCode={profileMissing ? 'missing_user_profile' : routeDecision.reason_code}
        profileStatus={profile?.status}
      />
    );
  }

  return children;
}
