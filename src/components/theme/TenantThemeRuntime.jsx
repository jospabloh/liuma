import { useEffect } from 'react';
import { buildThemeCssVars, DEFAULT_THEME } from '@/lib/tenantTheme';
import { useSubscription } from '@/hooks/useSubscription';

// The school's palette comes from getMySubscription (via useSubscription),
// which returns name / logo / theme_settings to every ACTIVE member. It used to
// be read with base44.entities.School.filter — but School.read is
// platform-only under RLS, so every school user got nothing and the palette a
// founder picked at onboarding never rendered for anyone (audit F37).
export default function TenantThemeRuntime() {
  const { school } = useSubscription();

  useEffect(() => {
    const vars = buildThemeCssVars(school?.theme_settings || DEFAULT_THEME);
    Object.entries(vars).forEach(([name, value]) => document.documentElement.style.setProperty(name, value));
  }, [school?.id, school?.theme_settings]);

  return null;
}
