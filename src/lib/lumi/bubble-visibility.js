export const EXCLUDED_ROUTE_MATCHERS = ['licenses', 'trial', 'license-payment', 'automated-emails', 'audit-follow-ups', 'owner'];

export function isLumiBubbleExcluded(pathname = '') {
  const normalizedPath = pathname.toLowerCase();
  return EXCLUDED_ROUTE_MATCHERS.some((segment) => normalizedPath.includes(segment));
}
