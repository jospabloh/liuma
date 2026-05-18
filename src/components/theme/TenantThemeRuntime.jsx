import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { buildThemeCssVars, DEFAULT_THEME } from '@/lib/tenantTheme';
import { selectCurrentUserProfile } from '@/lib/tenantSelection';

export default function TenantThemeRuntime() {
  const { data: user } = useQuery({ queryKey: ['currentUser'], queryFn: () => base44.auth.me() });
  const { data: userProfile } = useQuery({
    queryKey: ['themeUserProfile', user?.id],
    queryFn: async () => selectCurrentUserProfile(await base44.entities.UserProfile.filter({ user_id: user.id }, '-created_date')),
    enabled: !!user,
  });
  const { data: school } = useQuery({
    queryKey: ['themeSchool', userProfile?.school_id],
    queryFn: async () => (await base44.entities.School.filter({ id: userProfile.school_id }))[0],
    enabled: !!userProfile?.school_id,
  });

  useEffect(() => {
    const vars = buildThemeCssVars(school?.theme_settings || DEFAULT_THEME);
    Object.entries(vars).forEach(([name, value]) => document.documentElement.style.setProperty(name, value));
  }, [school?.id, school?.theme_settings]);

  return null;
}
