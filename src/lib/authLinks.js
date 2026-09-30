// Reads a password-reset token from the URL the reset e-mail opened.
//
// NOT VERIFIED against a real Base44 reset e-mail: the SDK documents
// resetPassword({ resetToken }) but not the link's shape, so we accept the
// plausible parameter names. If the e-mail links to Base44's own hosted page
// instead, that page completes the reset and this simply never fires.
// Observed 2026-09-30 (live QA): the Base44 e-mail links to
// <custom domain>/reset-password?token=…, which the platform serves itself
// (see PLATFORM_HOSTED_PATHS below) — so today that hosted page is what
// completes the reset, and this in-app reader is the fallback.
// App.jsx keeps the query string when it bounces an unauthenticated visitor
// from any path to LOGIN_PATH (/entrar), so the token survives that redirect.
const TOKEN_PARAMS = ['reset_token', 'resetToken', 'token'];

export function readResetToken(search = '') {
  let params;
  try { params = new URLSearchParams(search); } catch { return null; }
  for (const name of TOKEN_PARAMS) {
    const value = params.get(name);
    if (value && value.trim()) return value.trim();
  }
  return null;
}

export const MIN_PASSWORD_LENGTH = 8;

// LIUMA's own (Spanish) sign-in screen lives at /entrar, NOT /login.
//
// Base44's hosting answers a hard load of /login (and /reset-password) itself,
// ahead of the SPA, with its English hosted page ("Welcome to LIUMA · Sign in
// to continue"). Checked 2026-09-30 against both liuma-2232ffd8.base44.app and
// liuma.acaciaco.com.mx: /login and /reset-password return <html lang="en">,
// /entrar returns our index.html (<html lang="es-MX">). So an in-app /login
// route only ever won on client-side navigation — a bookmark, a reload or a
// PWA reopening on /login always got the English page. Nothing in the app
// may link to or land on /login; it stays reserved for the platform flows we
// deliberately use (`redirectToLogin` for the silent "Continuar como").
export const LOGIN_PATH = '/entrar';

// Paths the platform serves itself on a full page load. Kept here so a test
// can assert the app never sends a visitor to one of them by accident.
export const PLATFORM_HOSTED_PATHS = Object.freeze(['/login', '/reset-password']);

// Absolute URL of LIUMA's login screen, for redirects that leave the SPA
// (logout goes through /api/apps/auth/logout and comes back to from_url).
export function loginUrl(origin = typeof window !== 'undefined' ? window.location.origin : '') {
  return `${origin}${LOGIN_PATH}`;
}

const AUTH_REQUIRED = Object.freeze({ type: 'auth_required', message: 'Authentication required' });

// What AuthContext does when `auth.me()` fails.
//
// Before 2026-09-30 a visitor with NO token never reached this decision: the
// no-token branch set isAuthenticated=false without an authError, so App.jsx
// rendered the authenticated routes and Home fell through to the onboarding
// role picker ("¿Cuál es tu rol?" + "Cerrar sesión") for someone who was
// never signed in — the first screen of a fresh phone, of a cleared browser
// and of every logout. Now a missing token still asks `me()` (a cookie-backed
// session can answer it), and ANY failure without a token means "sign in".
// With a token, only 401/403 does: a network blip must not throw a signed-in
// teacher out to the login form.
export function authErrorAfterFailedMe(error, { hadToken }) {
  const status = error && error.status;
  if (!hadToken || status === 401 || status === 403) return { ...AUTH_REQUIRED };
  return null;
}
