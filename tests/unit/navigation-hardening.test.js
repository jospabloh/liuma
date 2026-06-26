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

// Redirecting to login during render is a React anti-pattern; it now runs as
// an effect.
test('auth_required redirect runs in an effect, not during render', () => {
  const app = read('src/App.jsx');
  // Assert the auth_required guard lives inside a useEffect. Tolerant of
  // comments between the effect opener and the guard, of whitespace, and of
  // extra conditions appended to the check (e.g. `&& !getRememberedIdentity()`),
  // while still keying on the effect-only `authError?.type` optional chaining
  // (the render branch uses the already-narrowed `authError.type`).
  assert.match(app, /useEffect\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?if\s*\(\s*authError\?\.type\s*===\s*'auth_required'/);
  // The render branch no longer calls navigateToLogin() directly.
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
