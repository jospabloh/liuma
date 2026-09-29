import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { buildThemeCssVars, DEFAULT_THEME } from '@/lib/tenantTheme';
import { selectCurrentUserProfile } from '@/lib/tenantSelection';

export default function TenantThemeRuntime() {
  const { data: user } = useQuery({ queryKey: ['currentUser'], queryFn: () => base44.auth.me() });
  const { data: userProfile } = useQuery({
    queryKey: ['themeUserProfile', user?.id],
    queryFn: async () => selectCurrentUserProfile(
      await base44.entities.UserProfile.filter({ user_id: user.id }, '-created_date'),
    ),
    enabled: !!user,
    // Theming is best-effort: on failure the default palette stays, and a
    // toast about it would be noise (the page's own queries report real errors).
    meta: { silentError: true },
  });
  const { data: school } = useQuery({
    queryKey: ['themeSchool', userProfile?.school_id],
    queryFn: async () => (await base44.entities.School.filter({ id: userProfile.school_id }))[0],
    enabled: !!userProfile?.school_id,
    meta: { silentError: true },
  });

  useEffect(() => {
    const vars = buildThemeCssVars(school?.theme_settings || DEFAULT_THEME);
    Object.entries(vars).forEach(([name, value]) => document.documentElement.style.setProperty(name, value));
  }, [school?.id, school?.theme_settings]);

  return null;
}
