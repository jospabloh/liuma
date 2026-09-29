import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { claimChunkReload, isChunkLoadError, CHUNK_RELOAD_KEY } from '../../src/lib/chunkReload.js';
import {
  humanizeError, isNetworkError, describeLoginError, describeSignupError, describeOtpError,
  describeResetRequestError, NETWORK_ERROR_MESSAGE, GENERIC_ERROR_MESSAGE,
} from '../../src/lib/errorMessages.js';
import { queryErrorToast, mutationErrorToast } from '../../src/lib/queryErrorPolicy.js';
import { readResetToken } from '../../src/lib/authLinks.js';

const root = new URL('../../', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');
const exists = (path) => fs.existsSync(new URL(path, root));

// Shapes the Base44 SDK actually throws (Base44Error: status/code/data).
const httpError = (status, data = {}) => Object.assign(new Error(data.message || `HTTP ${status}`), { name: 'Base44Error', status, data });
const networkError = () => Object.assign(new Error('Network Error'), { name: 'Base44Error', status: undefined, code: 'ERR_NETWORK' });

// ---------------------------------------------------------------- shell ----

// F19: Chrome offered "Translate from English?" on every page and the tab /
// home-screen shortcut showed the Base44 logo and "liuma".
test('index.html declares Spanish, the LIUMA title and LIUMA icons — never the Base44 logo', () => {
  const html = read('index.html');
  assert.match(html, /<html lang="es-MX">/);
  assert.match(html, /<title>LIUMA · Gestión escolar<\/title>/);
  assert.doesNotMatch(html, /base44\.com\/logo/);
  assert.match(html, /rel="icon"[^>]*href="\/favicon\.svg"/);
  assert.match(html, /rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
  assert.match(html, /name="theme-color"/);
  assert.match(html, /name="description"/);
  assert.match(html, /rel="manifest" href="\/manifest\.json"/);
});

// The manifest was referenced but missing, so /manifest.json returned the SPA
// HTML and "Agregar a pantalla de inicio" made an unbranded shortcut.
test('public/manifest.json exists, is installable, and every icon it lists ships', () => {
  const manifest = JSON.parse(read('public/manifest.json'));
  assert.equal(manifest.short_name, 'LIUMA');
  assert.equal(manifest.lang, 'es-MX');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'), 'installability needs 192 and 512 icons');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    assert.ok(exists(`public${icon.src}`), `manifest icon ${icon.src} is missing from public/`);
  }
  for (const path of ['public/favicon.svg', 'public/apple-touch-icon.png']) assert.ok(exists(path), path);
});

// ------------------------------------------------------ stale chunks ----

test('isChunkLoadError recognises the lazy-chunk failure in each browser, and nothing else', () => {
  assert.equal(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/Home-abc.js')), true); // Chromium
  assert.equal(isChunkLoadError(new TypeError('error loading dynamically imported module')), true); // Firefox
  assert.equal(isChunkLoadError(new TypeError('Importing a module script failed.')), true); // Safari
  assert.equal(isChunkLoadError(new Error('Unable to preload CSS for /assets/x.css')), true);
  assert.equal(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')")), false);
  assert.equal(isChunkLoadError(null), false);
});

// One automatic reload picks up the new build; a second inside the window
// would mean the new build is broken too, and reloading again would loop.
test('claimChunkReload allows one reload per window and never loops', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(claimChunkReload(storage, 1_000_000), true);
  assert.equal(store.get(CHUNK_RELOAD_KEY), '1000000');
  assert.equal(claimChunkReload(storage, 1_010_000), false, 'second failure within a minute must fall through to the error screen');
  assert.equal(claimChunkReload(storage, 1_000_000 + 61_000), true, 'a later deploy gets its own reload');
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => {} };
  assert.equal(claimChunkReload(blocked, 1), false, 'no storage → no blind reload');
});

// F22: no boundary meant any render error or post-deploy chunk 404 blanked the app.
test('every routed page renders inside RouteErrorBoundary, and main.jsx handles vite:preloadError', () => {
  const app = read('src/App.jsx');
  assert.match(app, /import RouteErrorBoundary from '@\/components\/RouteErrorBoundary'/);
  const wrapped = app.match(/<RouteErrorBoundary>\s*<Suspense/g) || [];
  assert.equal(wrapped.length, 2, 'both the main page and the guarded routes need the boundary');
  const main = read('src/main.jsx');
  assert.match(main, /addEventListener\('vite:preloadError'/);
  assert.match(main, /claimChunkReload/);
  const boundary = read('src/components/RouteErrorBoundary.jsx');
  assert.match(boundary, /getDerivedStateFromError/);
  assert.match(boundary, /Recargar/);
});

// --------------------------------------------------- error messages ----

test('humanizeError maps backend codes and HTTP statuses to Spanish, never leaking English', () => {
  assert.match(humanizeError(httpError(403, { code: 'WRITE_BLOCKED', error: "This school's subscription is read-only" })), /solo lectura/);
  assert.match(humanizeError(httpError(403, { code: 'FORBIDDEN', error: 'Not permitted to write this resource' })), /permiso/);
  assert.equal(humanizeError(networkError()), NETWORK_ERROR_MESSAGE);
  assert.match(humanizeError(httpError(503)), /servidor/);
  assert.match(humanizeError(httpError(429)), /Espera/);
  assert.equal(humanizeError(new Error('Something English')), GENERIC_ERROR_MESSAGE);
  assert.equal(isNetworkError(httpError(401)), false, 'an HTTP answer is never a network error');
});

// F25: every login failure used to read "contraseña incorrecta", sending
// parents on a flaky connection to reset a password that was fine.
test('login errors separate the network and the server from bad credentials', () => {
  assert.equal(describeLoginError(networkError()).kind, 'network');
  assert.equal(describeLoginError(httpError(500)).kind, 'server');
  assert.equal(describeLoginError(httpError(429)).kind, 'rate_limited');
  assert.equal(describeLoginError(httpError(401)).kind, 'credentials');
  assert.equal(describeLoginError(httpError(400)).kind, 'credentials');
  assert.doesNotMatch(describeLoginError(networkError()).message, /contraseña/);
});

test('sign-up and code errors point somewhere useful', () => {
  assert.equal(describeSignupError(httpError(409)).kind, 'exists');
  assert.equal(describeSignupError(httpError(400, { detail: 'User already exists' })).kind, 'exists');
  assert.equal(describeSignupError(httpError(403)).kind, 'closed');
  assert.equal(describeOtpError(httpError(400)).kind, 'bad_code');
  assert.equal(describeOtpError(networkError()).kind, 'network');
});

// ------------------------------------------------- global toasts ----

// F34/CQ-08: 22 mutations had no onError, so a rejected write looked saved.
test('an unhandled mutation failure toasts; one with its own onError does not double-toast', () => {
  const err = httpError(403, { code: 'WRITE_BLOCKED' });
  assert.match(mutationErrorToast(err, { options: {} }).message, /solo lectura/);
  assert.equal(mutationErrorToast(err, { options: { onError: () => {} } }), null);
  assert.equal(mutationErrorToast(err, { options: {}, meta: { silentError: true } }), null);
});

test('query failures toast once per message and never for a 401 on the login screen', () => {
  const a = queryErrorToast(networkError(), { meta: {} });
  const b = queryErrorToast(networkError(), { meta: {} });
  assert.equal(a.id, b.id, 'going offline fails every query at once — one toast, not ten');
  assert.equal(queryErrorToast(httpError(401), {}), null);
  assert.equal(queryErrorToast(httpError(404), { queryKey: ['currentUser'] }), null, 'identity failures belong to AuthContext');
  assert.ok(queryErrorToast(httpError(404), { queryKey: ['students'] }), 'a real page load failure still toasts');
  // Observed in the browser: a user with no profile yet makes
  // useCurrentProfile's queryFn return undefined, which v5 reports as an error.
  const undefinedData = new Error('Query data cannot be undefined. Please make sure to return a value other than undefined from your query function. Affected query key: ["userProfile","u1"]');
  assert.equal(queryErrorToast(undefinedData, { queryKey: ['userProfile', 'u1'] }), null, 'onboarding must not open with "Algo salió mal"');
  // …and the message query-core actually throws (5.89), seen in the browser:
  const thrown = new Error('["userProfile","u1"] data is undefined');
  assert.equal(queryErrorToast(thrown, { queryKey: ['userProfile', 'u1'] }), null);
  assert.equal(queryErrorToast(httpError(500), { meta: { silentError: true } }), null);
});

test('query-client wires both caches through the policy', () => {
  const src = read('src/lib/query-client.js');
  assert.match(src, /new QueryCache\(/);
  assert.match(src, /new MutationCache\(/);
  assert.match(src, /queryErrorToast/);
  assert.match(src, /mutationErrorToast/);
});

// Two toasters meant sonner toasts stayed white in dark mode and never showed
// outside the Layout.
test('there is exactly one toaster, mounted in App and following the app theme', () => {
  const mounts = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(new URL(dir, root), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.jsx?$/.test(entry.name) && /<Toaster\b/.test(read(path))) mounts.push(path);
    }
  };
  walk('src');
  assert.deepEqual(mounts.filter((p) => !p.startsWith('src/components/ui/') && !p.startsWith('src/preview/')), ['src/App.jsx']);
  assert.match(read('src/App.jsx'), /import \{ Toaster \} from "@\/components\/ui\/sonner"/);
  const sonner = read('src/components/ui/sonner.jsx');
  assert.match(sonner, /useTheme\(\)/);
  assert.match(sonner, /theme=\{resolvedTheme\}/);
  assert.doesNotMatch(sonner, /from "next-themes"/, 'next-themes has no provider in this app, so it always answered "system"');
});

// ------------------------------------------------------------ logout ----

// F14: no way to sign out of the authenticated app — shared school computers
// stayed signed in, and a wrong-account user was stuck in onboarding.
test('Cerrar sesión is reachable from every surface a signed-in user can be stuck on', () => {
  const surfaces = {
    'src/components/nav/SideNav.jsx': /<SignOutButton variant="icon" \/>/,
    'src/components/nav/CommandPalette.jsx': /Cerrar sesión/,
    'src/components/UserNotRegisteredError.jsx': /<SignOutButton/,
    'src/components/ui/PendingApproval.jsx': /<SignOutButton/,
  };
  for (const [path, pattern] of Object.entries(surfaces)) assert.match(read(path), pattern, path);
  const home = read('src/pages/Home.jsx');
  const onboarding = home.slice(home.indexOf('if (!userProfile)'), home.indexOf("status === 'PENDING'"));
  assert.match(onboarding, /<SignOutButton/, 'onboarding needs an exit');
  const suspended = home.slice(home.indexOf("status === 'SUSPENDED'"), home.indexOf('HomeComponent'));
  assert.match(suspended, /<SignOutButton/, 'the suspended screen needs an exit');
  assert.match(suspended, /dark:/, 'the suspended screen must be readable in dark mode');
});

// Going through AuthContext.logout clears the remembered identity; calling the
// SDK directly left "Continuar como <previous user>" on a shared device.
test('sign-out goes through AuthContext.logout, not base44.auth.logout directly', () => {
  const button = read('src/components/auth/SignOutButton.jsx');
  assert.match(button, /const \{ logout \} = useAuth\(\)/);
  assert.doesNotMatch(button, /@\/api\/base44Client/);
  assert.match(read('src/components/nav/CommandPalette.jsx'), /logout\(\)/);
  assert.doesNotMatch(read('src/components/ui/PendingApproval.jsx'), /@\/api\/base44Client/);
});

test('the not-registered screen is Spanish and offers a way out and a contact', () => {
  const src = read('src/components/UserNotRegisteredError.jsx');
  assert.doesNotMatch(src, /Access Restricted|You are not registered|Verify you are logged in/);
  assert.match(src, /no tiene acceso a LIUMA/);
  assert.match(src, /SUPPORT_EMAIL/);
  assert.match(src, /dark:/);
});

// ------------------------------------------------------------- login ----

test('the login screen offers recovery, sign-up and a show-password toggle', () => {
  const login = read('src/pages/Login.jsx');
  assert.match(login, /¿Olvidaste tu contraseña\?/);
  assert.match(login, /base44\.auth\.resetPasswordRequest\(/);
  assert.match(login, /base44\.auth\.resetPassword\(/);
  assert.match(login, /base44\.auth\.register\(/);
  assert.match(login, /base44\.auth\.verifyOtp\(/);
  assert.match(login, /Crea tu cuenta/);
  assert.match(login, /describeLoginError\(err\)/);
  const parts = read('src/components/auth/parts.jsx');
  assert.match(parts, /Mostrar contraseña/);
  assert.match(parts, /type=\{visible \? "text" : "password"\}/);
});

// Recovery must not reveal who has an account at a school.
test('the forgot-password answer is the same whether or not the account exists', () => {
  const login = read('src/pages/Login.jsx');
  const forgot = login.slice(login.indexOf('const handleForgot'), login.indexOf('const handleReset'));
  assert.match(forgot, /Si hay una cuenta con/);
  assert.match(forgot, /describeResetRequestError\(err\)/);
  // Any 4xx ("no such account" included) looks like success…
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(describeResetRequestError({ status }), null, `status ${status} must not reveal the account`);
  }
  // …but a request that never got a verdict is reported, not faked as sent.
  assert.match(describeResetRequestError({ message: 'Network Error', originalError: { code: 'ERR_NETWORK' } }), /conexión/);
  assert.match(describeResetRequestError({ status: 429 }), /Espera/);
  assert.match(describeResetRequestError({ status: 503 }), /servidor/);
});

test('readResetToken finds the token under the names a reset link may use', () => {
  assert.equal(readResetToken('?reset_token=abc'), 'abc');
  assert.equal(readResetToken('?resetToken=abc'), 'abc');
  assert.equal(readResetToken('?token=abc&x=1'), 'abc');
  assert.equal(readResetToken('?token=%20'), null);
  assert.equal(readResetToken(''), null);
});
