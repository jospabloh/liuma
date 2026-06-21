/**
 * App configuration sourced from build-time environment variables.
 *
 * IMPORTANT: every value read from `import.meta.env.VITE_*` is compiled into the
 * PUBLIC browser bundle — it is NOT secret. Only publishable, non-sensitive
 * values belong here.
 *
 * The ACACIA platform owner is identified server-side by the base44 account
 * role (`role: admin`), so no owner email/identity is shipped in the client
 * (see src/components/GuardedRoute.jsx). Any server-only value (e.g. an owner
 * contact for backend notifications) must be set as a base44 backend secret,
 * never as a VITE_ variable and never committed.
 */

/**
 * Public support contact for the in-app help desk. Overridable per deployment
 * via VITE_SUPPORT_EMAIL; falls back to the ACACIA support address.
 */
export const SUPPORT_EMAIL =
  import.meta.env.VITE_SUPPORT_EMAIL || 'soporte@acaciaco.com.mx';

/** `mailto:` href for the support contact. */
export const SUPPORT_EMAIL_HREF = `mailto:${SUPPORT_EMAIL}`;
