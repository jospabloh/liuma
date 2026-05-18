import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTE_ACCESS, canAccessRoute } from '../../src/lib/authorization/routeAccess.js';

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
