import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTE_ACCESS, canAccessRoute, getRouteAccessDecision } from '../../src/lib/authorization/routeAccess.js';

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

test('menu routes shown to each role are allowed by the route guard', () => {
  const menuRoutesByRole = {
    ADMIN: ['PagosAdmin', 'ResumenAsistencia', 'CalendarioEscolar', 'GestionAusencias', 'SolicitarAusencia'],
    TEACHER: ['Asistencia', 'CalendarioEscolar'],
    PARENT: ['CalendarioEscolar', 'SolicitarAusencia'],
  };

  for (const [role, routes] of Object.entries(menuRoutesByRole)) {
    for (const routeName of routes) {
      assert.equal(canAccessRoute({ role, routeName }), true, `${role} menu route ${routeName} should not show access denied`);
    }
  }
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
