// App shell & mobile fixes from the 2026-09-30 live mobile QA (area "mobile").
//
// Runs under UTC on purpose — the CI default, and the situation the "today"
// bug needs: a device NOT on Mexico time. Under America/Mexico_City the device
// and the school agree and every "today" assertion below would be vacuous.
process.env.TZ = 'UTC';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig.js';
import {
  LOGIN_PATH, PLATFORM_HOSTED_PATHS, loginUrl, authErrorAfterFailedMe, readResetToken,
} from '../../src/lib/authLinks.js';
import {
  schoolToday, schoolTodayDate, schoolDaysFromToday, isSchoolToday, isBeforeToday,
  isOnOrAfterToday, formatLocalDate, parseLocalDate, SCHOOL_TIME_ZONE,
} from '../../src/lib/dates.js';
import { calendarDaysUntilDue, isChargeOverdue } from '../../src/lib/payments/overdue.js';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, ROOT), 'utf8');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}
const SRC_FILES = walk(new URL('src/', ROOT).pathname);

async function compile(classes) {
  const cfg = loadConfig(new URL('tailwind.config.js', ROOT).pathname);
  const result = await postcss([tailwind({ ...cfg, content: [{ raw: `<div class="${classes}"></div>` }] })])
    .process('@tailwind utilities;', { from: undefined });
  return result.css.replace(/\s+/g, ' ');
}

// ------------------------------------------------ anonymous visitor at "/" --

test('the suite really runs off Mexico time (otherwise the "today" tests are vacuous)', () => {
  assert.equal(new Date(2026, 8, 15).getTimezoneOffset(), 0);
});

// HIGH: a fresh phone, a cleared browser, and every logout landed on the
// onboarding role picker ("¿Cuál es tu rol?" + "Cerrar sesión") because the
// no-token branch set isAuthenticated=false with NO authError, so App.jsx
// rendered the signed-in routes.
test('no token → sign in; with a token only 401/403 does', () => {
  assert.deepEqual(authErrorAfterFailedMe({ status: 401 }, { hadToken: false }), { type: 'auth_required', message: 'Authentication required' });
  assert.equal(authErrorAfterFailedMe(new Error('Network Error'), { hadToken: false }).type, 'auth_required',
    'without a token there is nothing to fall back to — never render the app');
  assert.equal(authErrorAfterFailedMe(undefined, { hadToken: false }).type, 'auth_required');
  assert.equal(authErrorAfterFailedMe({ status: 401 }, { hadToken: true }).type, 'auth_required');
  assert.equal(authErrorAfterFailedMe({ status: 403 }, { hadToken: true }).type, 'auth_required');
  assert.equal(authErrorAfterFailedMe(new Error('Network Error'), { hadToken: true }), null,
    'a network blip must not throw a signed-in teacher out to the login form');
});

test('AuthContext asks me() even without a token and routes every failure through authErrorAfterFailedMe', () => {
  const src = read('src/lib/AuthContext.jsx');
  const settled = src.slice(src.indexOf('setAppPublicSettings(publicSettings);'), src.indexOf('} catch (appError)'));
  assert.match(settled, /await checkUserAuth\(\);/);
  assert.doesNotMatch(settled, /if \(appParams\.token\)/, 'the no-token branch that skipped the auth check is back');
  assert.match(src, /authErrorAfterFailedMe\(error, \{ hadToken: Boolean\(appParams\.token\) \}\)/);
});

// ----------------------------------------------------- /login vs /entrar --

// MEDIUM: Base44's hosting answers a full page load of /login (and
// /reset-password) itself, in English. Verified 2026-09-30 on both hosts:
// /login → <html lang="en">, /entrar → our index.html (<html lang="es-MX">).
test('LIUMA\'s login lives on a path the platform does not own', () => {
  assert.equal(LOGIN_PATH, '/entrar');
  assert.ok(!PLATFORM_HOSTED_PATHS.includes(LOGIN_PATH));
  assert.equal(loginUrl('https://liuma.acaciaco.com.mx'), 'https://liuma.acaciaco.com.mx/entrar');
  // A reset link bounced from any path keeps its token (query string travels).
  assert.equal(readResetToken('?token=abc'), 'abc');
});

test('signed-out routes serve Login on LOGIN_PATH and send everything else there', () => {
  const app = read('src/App.jsx');
  const signedOut = app.slice(app.indexOf("authError.type === 'auth_required'"), app.indexOf('// Render the main app'));
  assert.match(signedOut, /<Route path=\{LOGIN_PATH\} element=\{<Login \/>\} \/>/);
  assert.match(signedOut, /<Route path="\*" element=\{<RedirectToLogin \/>\} \/>/);
  assert.doesNotMatch(signedOut, /path="\/login"/);
  assert.match(app, /<Navigate to=\{\{ pathname: LOGIN_PATH, search \}\} replace \/>/);
});

test('nothing in the app navigates to a platform-hosted path, and logout comes back to LIUMA\'s login', () => {
  const offenders = [];
  for (const file of SRC_FILES) {
    if (file.endsWith(`${path.sep}OAuthConsent.jsx`)) continue; // unrouted Base44 boilerplate
    const src = fs.readFileSync(file, 'utf8');
    for (const hosted of PLATFORM_HOSTED_PATHS) {
      const re = new RegExp(`(navigate\\(|to=|href=|pathname:|location\\.href\\s*=)\\s*[{(]?\\s*["'\`]${hosted}\\b`);
      if (re.test(src)) offenders.push(`${path.relative(ROOT.pathname, file)} → ${hosted}`);
    }
  }
  assert.deepEqual(offenders, []);
  assert.match(read('src/lib/AuthContext.jsx'), /base44\.auth\.logout\(loginUrl\(\)\)/);
  assert.match(read('src/components/auth/ContinueAs.jsx'), /base44\.auth\.logout\(loginUrl\(\)\)/);
});

// -------------------------------------------------------------- PageHeader --

// MEDIUM: at 320px "Nuevo Descuento" left the H1 16px wide ("G…") because the
// actions were shrink-0 beside a min-w-0 title.
test('PageHeader wraps its actions under the title instead of crushing it', () => {
  const src = read('src/components/ui/PageHeader.jsx');
  assert.match(src, /className="mb-6 flex flex-wrap items-center justify-between/);
  assert.match(src, /className="flex min-w-0 flex-auto items-center gap-3"/, 'the title group must keep its natural width, so the actions wrap before it shrinks');
  assert.match(src, /aria-label="Volver"[\s\S]*?className="mobile-touch-target shrink-0/, 'the back arrow must not be squeezed below 44px');
  assert.match(src, /<h1 className="[^"]*line-clamp-2 sm:line-clamp-none sm:truncate/);
});

// ------------------------------------------------ touch targets & iOS zoom --

test('coarse: and fine: are pointer media queries, and md:fine: nests both', async () => {
  const css = await compile('coarse:min-h-11 md:fine:text-sm');
  assert.match(css, /@media \(pointer: coarse\) \{ \.coarse\\:min-h-11 \{ min-height: 2\.75rem \} \}/);
  assert.match(css, /@media \(min-width: 768px\) \{ @media \(pointer: fine\) \{ \.md\\:fine\\:text-sm \{ font-size: 0\.875rem/);
});

// LOW: fields dropped to 14px from 768px, and a large iPhone in landscape is
// wider than that — iOS Safari zooms the page on focus of a <16px field.
test('text fields keep 16px on touch screens at every width', () => {
  for (const file of ['src/components/ui/input.jsx', 'src/components/ui/textarea.jsx']) {
    const src = read(file);
    assert.match(src, /\btext-base\b/, file);
    assert.match(src, /md:fine:text-sm/, file);
    assert.doesNotMatch(src, /(?<!:)md:text-sm/, `${file}: a bare md:text-sm zooms landscape iPhones`);
  }
  assert.match(read('src/index.css'), /@media \(pointer: coarse\) \{\s*\.ui-field \{\s*font-size: 1rem;/);
  assert.match(read('src/Layout.jsx'), /@media \(max-width: 767px\), \(pointer: coarse\)/);
});

// LOW: primary actions were 28–36px tall on phones.
test('primitives give a finger 44px', () => {
  assert.match(read('src/components/ui/button.jsx'), /sm: "h-8 coarse:min-h-11/);
  assert.match(read('src/components/ui/input.jsx'), /h-9 coarse:min-h-11/);
  assert.match(read('src/components/ui/select.jsx'), /h-9 coarse:min-h-11/);
  const tabs = read('src/components/ui/tabs.jsx');
  assert.match(tabs, /h-9 coarse:h-auto/, 'the list must grow with its triggers');
  assert.match(tabs, /inline-flex coarse:min-h-11 items-center justify-center whitespace-nowrap/);
  const dialog = read('src/components/ui/dialog.jsx');
  assert.match(dialog, /coarse:h-11 coarse:w-11/);
  assert.match(dialog, /<span className="sr-only">Cerrar<\/span>/);
  assert.match(read('src/components/ui/switch.jsx'), /after:absolute after:-inset-x-1 after:-inset-y-3/, 'a 36x20 switch needs an invisible 44x44 hit area');
  assert.match(read('src/components/auth/SignOutButton.jsx'), /h-8 w-8 coarse:h-11 coarse:w-11/);
});

// ------------------------------------------------------------- safe areas --

// LOW: without viewport-fit=cover every env(safe-area-inset-*) is 0; with it,
// BottomNav grows by the inset, so its spacer has to grow too.
test('safe-area insets are real, and every fixed control accounts for them', () => {
  assert.match(read('index.html'), /<meta name="viewport" content="width=device-width, initial-scale=1\.0, viewport-fit=cover" \/>/);
  const nav = read('src/components/nav/BottomNav.jsx');
  assert.match(nav, /paddingBottom: 'env\(safe-area-inset-bottom, 0px\)'/);
  assert.match(nav, /height: 'calc\(4rem \+ env\(safe-area-inset-bottom, 0px\)\)'/, 'spacer must match the bar, or the last 34px of every page hides under it');
  const lumi = read('src/components/ui/LumiButton.jsx');
  assert.match(lumi, /marginBottom: 'env\(safe-area-inset-bottom, 0px\)'/);
  assert.match(lumi, /marginRight: 'env\(safe-area-inset-right, 0px\)'/);
  // The switcher (canonical, not edited here) already adds the same inset to
  // its offset, so it stays stacked above the lifted bubble.
  assert.match(read('src/components/ThemeSwitcher.jsx'), /calc\(var\(--theme-switcher-bottom, 1rem\) \+ env\(safe-area-inset-bottom, 0px\)\)/);
  const css = read('src/index.css');
  assert.match(css, /padding-left: env\(safe-area-inset-left, 0px\);/);
  assert.match(read('src/components/nav/SideNav.jsx'), /paddingLeft: 'env\(safe-area-inset-left, 0px\)'/);
});

// ---------------------------------------------------------- month grid --

// LOW: a phone's day cell is ~40px; the "Festival" chip showed 12px of 123px.
test('the month grid shows dots on phones and titled chips from sm up', () => {
  const src = read('src/pages/CalendarioEscolar.jsx');
  assert.match(src, /flex justify-center gap-0\.5 sm:hidden" aria-hidden="true" data-event-dots/);
  assert.match(src, /<div className="hidden sm:block space-y-1">/);
  assert.match(src, /min-h-12 sm:min-h-20 p-1 sm:p-2/);
  assert.match(src, /dayEvents\.length === 1 \? '1 evento'/, 'the dots are aria-hidden, so the count must be in the label');
  assert.equal((src.match(/size="icon"\s*\n\s*aria-label="Mes (anterior|siguiente)"/g) || []).length, 2);
});

// ------------------------------------------------------- "today" = Mexico --

test('schoolToday is Mexico\'s calendar day, whatever the device says', () => {
  assert.equal(SCHOOL_TIME_ZONE, 'America/Mexico_City');
  // 2026-09-30 03:00 UTC is still Sept 29, 21:00 in Mexico. The device (UTC)
  // says the 30th; the school and every server function say the 29th.
  const lateEvening = new Date('2026-09-30T03:00:00Z');
  assert.equal(formatLocalDate(lateEvening), '2026-09-30', 'device day (UTC)');
  assert.equal(schoolToday(lateEvening), '2026-09-29');
  assert.equal(formatLocalDate(schoolTodayDate(lateEvening)), '2026-09-29');
  assert.equal(schoolToday(new Date('2026-09-30T06:00:00Z')), '2026-09-30', 'midnight in Mexico');
  assert.equal(schoolToday(new Date('nope')), '');
  // "today" comparisons follow the school's day.
  assert.equal(isSchoolToday('2026-09-29', lateEvening), true);
  assert.equal(isSchoolToday('2026-09-30', lateEvening), false);
  assert.equal(isBeforeToday('2026-09-29', lateEvening), false, 'due today is not overdue yet');
  assert.equal(isOnOrAfterToday('2026-09-29', lateEvening), true, 'an event today is still upcoming');
  assert.equal(schoolDaysFromToday('2026-09-30', lateEvening), 1, 'tomorrow, for the school');
});

// Review follow-up: isBeforeToday moved to the school's day but
// calendarDaysUntilDue (reminder window, "vence en N días") kept the device's,
// so the same charge was "due today" and "1 day late" at once off Mexico time.
test('charge day counts and the overdue rule agree on what today is', () => {
  const lateEvening = new Date('2026-09-30T03:00:00Z'); // Sept 29, 21:00 in Mexico
  assert.equal(calendarDaysUntilDue('2026-09-29', lateEvening), 0);
  assert.equal(isChargeOverdue({ status: 'PENDING', due_date: '2026-09-29' }, lateEvening), false);
  assert.equal(calendarDaysUntilDue('2026-09-28', lateEvening), -1);
  assert.equal(isChargeOverdue({ status: 'PENDING', due_date: '2026-09-28' }, lateEvening), true);
});

test('no page computes "today" from the device clock any more', () => {
  const offenders = [];
  for (const file of SRC_FILES) {
    if (file.endsWith(`lib${path.sep}dates.js`)) continue; // its comments name the anti-patterns
    const src = fs.readFileSync(file, 'utf8');
    if (/format\(new Date\(\), ['"]yyyy-MM-dd['"]\)/.test(src)
      || /formatLocalDate\(new Date\(\)\)/.test(src)
      || /format\(new Date\(\), "EEEE d 'de' MMMM"/.test(src)
      || /\bisToday\(/.test(src)) {
      offenders.push(path.relative(ROOT.pathname, file));
    }
  }
  // PagosAdmin's payment_date is left for the payments package (open item).
  assert.deepEqual(offenders.filter((f) => !f.endsWith('PagosAdmin.jsx')), []);
});

// LOW: new Date('2026-10-29') is Oct 28 18:00 in Mexico — "Vence: 28 de
// octubre" and one day short.
test('a date-only trial end renders on its own day and counts calendar days', () => {
  const now = new Date('2026-09-30T18:00:00Z'); // Sept 30, noon in Mexico
  assert.equal(parseLocalDate('2026-10-29').getDate(), 29);
  assert.equal(schoolDaysFromToday('2026-10-29', now), 29);
  // The instant provisionOnboardingProfile writes counts the same way.
  assert.equal(schoolDaysFromToday(parseLocalDate('2026-10-29T12:00:00.000Z'), now), 29);
  const modal = read('src/components/subscription/WelcomeTrialModal.jsx');
  assert.doesNotMatch(modal, /new Date\(subscription\.trial_end_date\)/);
  assert.match(modal, /const trialEnd = parseLocalDate\(subscription\.trial_end_date\);/);
  assert.match(modal, /format\(trialEnd, "d 'de' MMMM, yyyy"/);
  assert.doesNotMatch(read('src/pages/LicenseAdmin.jsx'), /new Date\(sub\.trial_end_date\)/);
});
