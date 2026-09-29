import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { invokeFunction } from '@/lib/functionResponse';
import { indexMembers, memberEmail, memberName } from './memberDirectory';

/**
 * Names and emails of the people in ONE school, for the screens that show
 * them (Aprobaciones, GestionSalon, GestionAlumno, PermisosRoles).
 *
 * UserProfile carries no name or email, and a client-side `User.list()` only
 * returns the caller's own row under Base44's default User visibility — which
 * is why every one of those screens used to read "Sin nombre". The
 * listSchoolMembers function resolves them server-side, only for the
 * caller's own school, and only for an ACTIVE ADMIN or TEACHER (a TEACHER
 * sees ACTIVE members only). Never call `base44.entities.User.list()` from
 * the client again; use this.
 *
 * @param {string | undefined} schoolId the school the caller is viewing
 * @param {{ enabled?: boolean }} [options]
 */
export function useSchoolMembers(schoolId, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: ['schoolMembers', schoolId],
    queryFn: async () => {
      const result = await invokeFunction(base44, 'listSchoolMembers', { schoolId });
      return Array.isArray(result?.users) ? result.users : [];
    },
    enabled: Boolean(schoolId) && enabled,
    staleTime: 60 * 1000,
  });

  const index = useMemo(() => indexMembers(query.data), [query.data]);

  return {
    members: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    getName: (userId) => memberName(index, userId),
    getEmail: (userId) => memberEmail(index, userId),
  };
}
