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
});
