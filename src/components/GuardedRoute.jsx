import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import RouteAccessDenied from '@/components/RouteAccessDenied';
import { canAccessRoute, DEFAULT_DENIED_REDIRECT } from '@/lib/authorization/routeAccess';
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

  const hasAccess = canAccessRoute({ role: profile?.app_role, routeName });
  const ownerAccess = getOwnerScopedAccess({
    currentUser: user,
    ownerEmail: import.meta.env.VITE_OWNER_EMAIL,
    ownerUserId: import.meta.env.VITE_OWNER_USER_ID,
    actorSchoolId: profile?.school_id,
    targetSchoolId: profile?.school_id,
    ownerProfiles: profiles,
  });

  React.useEffect(() => {
    if (!ownerAccess.allowed || !user || !profile) return;
    logAuditEvent({
      user,
      userProfile: profile,
      entity: 'Route',
      entityId: routeName,
      action: AUDIT_ACTIONS.OWNER_OVERRIDE,
      reason: 'owner_override',
      context: { route: routeName, policy_decision: 'allow' },
    });
  }, [ownerAccess.allowed, user, profile, routeName]);

  if (!hasAccess && !ownerAccess.allowed) {
    const ownerProfileMissing = !profile && user?.email?.toLowerCase() === String(import.meta.env.VITE_OWNER_EMAIL || '').toLowerCase();
    return (
      <RouteAccessDenied
        redirectTo={DEFAULT_DENIED_REDIRECT}
        message={ownerProfileMissing ? 'Perfil de owner no provisionado en este tenant.' : 'No tienes permisos para ver esta sección.'}
      />
    );
  }

  return children;
}
