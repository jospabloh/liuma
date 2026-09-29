import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ROUTE_ACCESS, ROUTE_DRILLDOWNS, PLATFORM_OWNER_ROUTES, INACTIVE_PROFILE_ROUTES,
  canAccessRoute, getRouteAccessDecision,
} from '../../src/lib/authorization/routeAccess.js';
import { getDestinations, getPrimaryTabs } from '../../src/components/nav/navRegistry.js';
import { routeDenialCopy } from '../../src/lib/authorization/routeDenialCopy.js';

const ROLE_LIST = ['ADMIN', 'TEACHER', 'PARENT'];
const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

function reachableFor(role) {
  return new Set([
    ...getDestinations(role).map((d) => d.page),
    ...getPrimaryTabs(role).filter((t) => t.page).map((t) => t.page),
    ...(ROUTE_DRILLDOWNS[role] || []),
  ]);
}

test('route matrix has access rules for all pages', () => {
  const requiredRoutes = [
    'Home','OperacionDiaria','ContactosEmergencia','SolicitarAusencia','MisHijos','EventosParaPadres','Pagos','Avisos','Asistencia','Tarea','Bitacora',
    'GestionSalon','GestionAlumno','BitacorasMaestro','CrearBitacora','TareaMaestro','AvisosMaestro','GestionAusencias','ResumenAsistencia',
    'GestionEscuela','ConfiguracionInicial','CalendarioEscolar','GestionDocumentos','GestionDescuentos','PedidosUniformes','GestionPedidosAdmin','PagosAdmin','Aprobaciones','PermisosRoles','AuditoriaAdmin','AvisosAdmin','AlertaEmergencia','Reportes'
  ];
  for (const route of requiredRoutes) assert.ok(ROUTE_ACCESS[route], `missing ${route}`);
});

test('denies direct URL access for wrong role', () => {
  assert.equal(canAccessRoute({ role: 'PARENT', routeName: 'PermisosRoles' }), false);
  assert.equal(canAccessRoute({ role: 'TEACHER', routeName: 'MisHijos' }), false);
  assert.equal(canAccessRoute({ role: 'ADMIN', routeName: 'TareaMaestro' }), false);
});

test('route denials include structured reason codes for direct URL blocks', () => {
  const decision = getRouteAccessDecision({ role: 'PARENT', routeName: 'PermisosRoles' });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason_code, 'forbidden_action');
});

test('route owner override is explicit and keeps non-owner users denied by default', () => {
  const ownerDecision = getRouteAccessDecision({
    role: 'PARENT',
    routeName: 'PermisosRoles',
    ownerAccess: { allowed: true, reason: 'owner_override', identity_source: 'email' },
  });
  const nonOwnerDecision = getRouteAccessDecision({
    role: 'PARENT',
    routeName: 'PermisosRoles',
    ownerAccess: { allowed: false, reason_code: 'owner_not_configured' },
  });

  assert.equal(ownerDecision.allowed, true);
  assert.equal(ownerDecision.precedence, 'owner_override');
  assert.equal(nonOwnerDecision.allowed, false);
  assert.equal(nonOwnerDecision.reason_code, 'forbidden_action');
  assert.equal(nonOwnerDecision.owner_denied, false);
});

// Every place the UI sends a role (menu, bottom tabs, drill-downs) must be a
// route the guard lets that role into — otherwise the tap lands on
// "Acceso denegado". Derived from navRegistry, not a hand-kept list.
test('every nav destination, tab and drill-down of a role is allowed for that role', () => {
  for (const role of ROLE_LIST) {
    for (const routeName of reachableFor(role)) {
      assert.equal(canAccessRoute({ role, routeName }), true, `${role} can reach ${routeName} from the UI but the guard denies it`);
    }
  }
});

// The reverse: a grant with no way in is a URL-only door into a page that
// wasn't built for that role (ADMIN on the parent Pagos page rendered empty;
// ADMIN on SeedTestData could write fake records into a live school). A new
// grant must come with a nav entry or a ROUTE_DRILLDOWNS line.
test('every role grant in ROUTE_ACCESS is reachable from that role\'s nav or a declared drill-down', () => {
  for (const [routeName, roles] of Object.entries(ROUTE_ACCESS)) {
    for (const role of roles) {
      assert.ok(reachableFor(role).has(routeName), `${role} is granted ${routeName} but nothing in the UI leads there`);
    }
  }
});

// F11: the director taps a classroom or a student in Gestión de escuela. Those
// pages were TEACHER-only, so the main setup screen dead-ended.
test('the director can open the classroom and student pages Gestión de escuela links to', () => {
  const escuela = read('src/pages/GestionEscuela.jsx');
  for (const routeName of ['GestionSalon', 'GestionAlumno']) {
    assert.match(escuela, new RegExp(`createPageUrl\\(\`${routeName}`), `GestionEscuela no longer links ${routeName}; revisit ROUTE_DRILLDOWNS`);
    assert.equal(canAccessRoute({ role: 'ADMIN', routeName }), true);
  }
});

test('SeedTestData is closed to every school role and open only to the platform owner', () => {
  assert.deepEqual(PLATFORM_OWNER_ROUTES, ['SeedTestData']);
  for (const role of ROLE_LIST) {
    assert.equal(canAccessRoute({ role, routeName: 'SeedTestData' }), false, `${role} must not reach SeedTestData`);
    // Not even a school super-admin override: that is a school-level identity.
    const viaOverride = getRouteAccessDecision({
      role, routeName: 'SeedTestData', profileStatus: 'ACTIVE',
      ownerAccess: { allowed: true, reason: 'owner_override', identity_source: 'profile' },
    });
    assert.equal(viaOverride.allowed, false);
  }
  const owner = getRouteAccessDecision({ role: 'ADMIN', routeName: 'SeedTestData', profileStatus: 'ACTIVE', isPlatformOwner: true });
  assert.equal(owner.allowed, true);
  assert.equal(owner.precedence, 'platform_owner');
  // The page double-checks it, so a stale route table can't reopen it.
  assert.match(read('src/pages/SeedTestData.jsx'), /user\?\.role !== 'admin'/);
});

// A PENDING or SUSPENDED profile still carries app_role; without a status
// check a suspended teacher could open teacher pages by URL.
test('a profile that is not ACTIVE is denied everywhere except Home', () => {
  for (const status of ['PENDING', 'SUSPENDED']) {
    const denied = getRouteAccessDecision({ role: 'TEACHER', routeName: 'Asistencia', profileStatus: status });
    assert.equal(denied.allowed, false);
    assert.equal(denied.reason_code, 'inactive_profile');
    for (const routeName of INACTIVE_PROFILE_ROUTES) {
      assert.equal(getRouteAccessDecision({ role: 'TEACHER', routeName, profileStatus: status }).allowed, true, `${status} must still reach ${routeName} to see their status`);
    }
  }
  assert.equal(getRouteAccessDecision({ role: 'TEACHER', routeName: 'Asistencia', profileStatus: 'ACTIVE' }).allowed, true);
});

test('GuardedRoute waits for the profile, uses the shared profile rule and passes status', () => {
  const guard = read('src/components/GuardedRoute.jsx');
  assert.match(guard, /selectCurrentUserProfile\(profiles\)/);
  assert.doesNotMatch(guard, /profiles\[0\]/);
  assert.match(guard, /if \(!decided\) return <GuardSkeleton \/>/);
  assert.match(guard, /profileStatus:/);
  assert.match(guard, /isPlatformOwner: user\?\.role === 'admin'/);
});

// The denial screen is read by directors, teachers and parents: no internal
// codes, and never "ask your administrator" as the only advice.
test('route denial copy is plain Spanish with no internal reason codes', () => {
  const cases = [
    {}, { reasonCode: 'forbidden_action' }, { reasonCode: 'missing_user_profile' },
    { reasonCode: 'inactive_profile', profileStatus: 'PENDING' }, { reasonCode: 'inactive_profile', profileStatus: 'SUSPENDED' },
    { reasonCode: 'profile_load_failed' },
  ];
  for (const c of cases) {
    const { title, body } = routeDenialCopy(c);
    assert.ok(title && body);
    assert.doesNotMatch(`${title} ${body}`, /_|forbidden|tenant|ruta permitida/i);
  }
  assert.match(routeDenialCopy({ reasonCode: 'inactive_profile', profileStatus: 'SUSPENDED' }).title, /suspendida/);
  // A failed profile load must not tell a real user to go create a school.
  const loadFailed = routeDenialCopy({ reasonCode: 'profile_load_failed' });
  assert.doesNotMatch(`${loadFailed.title} ${loadFailed.body}`, /crear tu escuela|código/i);
  assert.equal(loadFailed.action, 'reload');
  assert.match(read('src/components/GuardedRoute.jsx'), /profilesFailed\s*\n?\s*\? 'profile_load_failed'/);
  const denied = read('src/components/RouteAccessDenied.jsx');
  assert.doesNotMatch(denied, /Código de referencia|\{reasonCode\}/);
});

test('owner override allows every admin route while non-owners stay denied on owner-only fallback', () => {
  const adminRoutes = Object.entries(ROUTE_ACCESS)
    .filter(([, roles]) => roles.includes('ADMIN'))
    .map(([routeName]) => routeName);

  assert.ok(adminRoutes.length > 0, 'admin route coverage should not be empty');

  for (const routeName of adminRoutes) {
    const ownerDecision = getRouteAccessDecision({
      role: 'OWNER_OVERRIDE_ONLY',
      routeName,
      ownerAccess: { allowed: true, reason: 'owner_override', identity_source: 'email' },
    });
    const nonOwnerDecision = getRouteAccessDecision({
      role: 'OWNER_OVERRIDE_ONLY',
      routeName,
      ownerAccess: { allowed: false, reason_code: 'owner_not_configured' },
    });

    assert.equal(ownerDecision.allowed, true, `${routeName} should allow the configured owner through the override path`);
    assert.equal(ownerDecision.precedence, 'owner_override', `${routeName} should prove owner access is not just role-based`);
    assert.equal(nonOwnerDecision.allowed, false, `${routeName} should deny non-owner users when their role is not allowed`);
    assert.equal(nonOwnerDecision.reason_code, 'forbidden_action');
  }
});

test('route denials preserve owner denial reason for repeated owner-denied alerting', () => {
  const decision = getRouteAccessDecision({
    role: 'OWNER_OVERRIDE_ONLY',
    routeName: 'PermisosRoles',
    ownerAccess: { allowed: false, reason_code: 'owner_profile_missing' },
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.owner_denied, true);
  assert.equal(decision.owner_reason, 'owner_profile_missing');
});
