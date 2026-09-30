import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// Navigating from a long dashboard into a deep page used to preserve the
// previous scroll offset, landing users mid-page. App now resets scroll on
// every pathname change.
test('App scrolls to top on route change', () => {
  const app = read('src/App.jsx');
  assert.match(app, /ScrollToTopOnNavigate/);
  assert.match(app, /window\.scrollTo\(/);
  // Tolerant of arrow-function/whitespace formatting so a reformat can't break it.
  assert.match(app, /useEffect\(\s*\(\s*\)\s*=>\s*\{[\s\S]*scrollTo[\s\S]*\}\s*,\s*\[\s*pathname\s*\]\s*\)/);
});

// auth_required used to imperatively bounce out to Base44's hosted login via
// navigateToLogin() (window.location.href = ...) — a real side effect, so it
// had to run in a useEffect rather than during render. It now renders our own
// in-app /login route declaratively via react-router's <Navigate>, which is
// safe during render (no imperative side effect to guard against), so the
// hosted-login redirect call must be gone entirely from this branch.
test('auth_required renders the in-app login route instead of bouncing to the Base44 hosted login', () => {
  const app = read('src/App.jsx');
  assert.match(app, /authError\.type === 'auth_required'/);
  // Redirects to LOGIN_PATH (/entrar — the platform owns /login on a full
  // page load) keeping the query string, so a password-reset link
  // (?reset_token=…) opened on any path still reaches the reset form.
  assert.match(app, /<Navigate to=\{\{ pathname: LOGIN_PATH, search \}\}/);
  assert.doesNotMatch(app, /auth_required'\) \{\s*\n\s*\/\/ Redirect to login automatically\s*\n\s*navigateToLogin\(\);/);
});

// The 404 "go home" control must not trigger a full page reload (which drops
// the SPA, router state, and React Query cache).
test('PageNotFound uses client-side navigation, not a hard reload', () => {
  const page = read('src/lib/PageNotFound.jsx');
  assert.doesNotMatch(page, /window\.location\.href\s*=\s*'\/'/);
  assert.match(page, /<Link\s+to="\/"/);
});

// The 404 page is part of a Spanish-language app; copy is Spanish and the
// build-tooling hint is gated to development only.
test('PageNotFound copy is Spanish and the dev hint is gated out of production', () => {
  const page = read('src/lib/PageNotFound.jsx');
  assert.match(page, /Página no encontrada/);
  assert.match(page, /Ir al inicio/);
  assert.doesNotMatch(page, /Page Not Found|Go Home/);
  // The "not implemented" hint must be behind a dev flag.
  assert.match(page, /isDev && isFetched && authData\.isAuthenticated/);
});
