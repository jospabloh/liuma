import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import RouteAccessDenied from '@/components/RouteAccessDenied';
import { DEFAULT_DENIED_REDIRECT, getRouteAccessDecision } from '@/lib/authorization/routeAccess';
import { AUDIT_ACTIONS, logAuditEvent } from '@/lib/audit';
import { getOwnerScopedAccess } from '@/lib/authorization/policy';

export default function GuardedRoute({ routeName, children }) {
  const { data: user } = useQuery({ queryKey: ['currentUser'], queryFn: () => base44.auth.me() });
  const { data: profiles = [] } = useQuery({
    queryKey: ['profileRouteGuard', user?.id],
    queryFn: () => base44.entities.UserProfile.filter({ user_id: user.id }, '-created_date'),
    enabled: !!user?.id,
  });
  const profile = profiles[0] || null;

  const ownerAccess = getOwnerScopedAccess({
    currentUser: user,
    ownerEmail: import.meta.env.VITE_OWNER_EMAIL,
    ownerUserId: import.meta.env.VITE_OWNER_USER_ID,
    actorSchoolId: profile?.school_id,
    targetSchoolId: profile?.school_id,
    ownerProfiles: profiles,
  });

  const routeDecision = getRouteAccessDecision({ role: profile?.app_role, routeName, ownerAccess });

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

  if (!routeDecision.allowed) {
    const ownerProfileMissing = !profile && user?.email?.toLowerCase() === String(import.meta.env.VITE_OWNER_EMAIL || '').toLowerCase();
    return (
      <RouteAccessDenied
        redirectTo={DEFAULT_DENIED_REDIRECT}
        message={ownerProfileMissing ? 'Perfil de owner no provisionado en este tenant.' : 'No tienes permisos para ver esta sección.'}
        reasonCode={routeDecision.reason_code}
      />
    );
  }

  return children;
}
