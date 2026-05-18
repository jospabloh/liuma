import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import RouteAccessDenied from '@/components/RouteAccessDenied';
import { canAccessRoute, DEFAULT_DENIED_REDIRECT } from '@/lib/authorization/routeAccess';

export default function GuardedRoute({ routeName, children }) {
  const { data: user } = useQuery({ queryKey: ['currentUser'], queryFn: () => base44.auth.me() });
  const { data: profile } = useQuery({
    queryKey: ['profileRouteGuard', user?.id],
    queryFn: () => base44.entities.UserProfile.filter({ user_id: user.id }, '-created_date', 1).then((rows) => rows[0] || null),
    enabled: !!user?.id,
  });

  const hasAccess = canAccessRoute({ role: profile?.app_role, routeName });
  if (!hasAccess) return <RouteAccessDenied redirectTo={DEFAULT_DENIED_REDIRECT} />;

  return children;
}
