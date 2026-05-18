import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ROUTE_ACCESS, getRouteAccessDecision } from '../../src/lib/authorization/routeAccess.js';
import { getOwnerScopedAccess } from '../../src/lib/authorization/policy.js';

const OWNER_USER = { id: 'owner-user-1', email: 'owner@example.com' };
const OWNER_PROFILE = {
  id: 'owner-profile-1',
  user_id: OWNER_USER.id,
  school_id: 'school-a',
  app_role: 'ADMIN',
  status: 'ACTIVE',
  is_super_admin: true,
};

const ownerAccess = getOwnerScopedAccess({
  currentUser: OWNER_USER,
  ownerEmail: OWNER_USER.email,
  actorSchoolId: OWNER_PROFILE.school_id,
  targetSchoolId: OWNER_PROFILE.school_id,
  ownerProfiles: [OWNER_PROFILE],
});

const ownerMenus = [
  { source: 'AdminHome', label: 'Enviar alerta de EMERGENCIA', routeName: 'AlertaEmergencia' },
  { source: 'AdminHome', label: 'Aprobaciones', routeName: 'Aprobaciones' },
  { source: 'AdminHome', label: 'Escuela', routeName: 'GestionEscuela' },
  { source: 'AdminHome', label: 'Avisos', routeName: 'AvisosAdmin' },
  { source: 'AdminHome', label: 'Pagos', routeName: 'PagosAdmin' },
  { source: 'AdminHome', label: 'Reportes', routeName: 'Reportes' },
  { source: 'AdminHome', label: 'Asistencia', routeName: 'ResumenAsistencia' },
  { source: 'AdminHome', label: 'Calendario', routeName: 'CalendarioEscolar' },
  { source: 'AdminHome', label: 'Documentos Oficiales', routeName: 'GestionDocumentos' },
  { source: 'AdminHome', label: 'Pedidos de Uniformes', routeName: 'GestionPedidosAdmin' },
  { source: 'AdminHome', label: 'Descuentos', routeName: 'GestionDescuentos' },
  { source: 'AdminHome', label: 'Solicitudes de Ausencias', routeName: 'GestionAusencias' },
  { source: 'AdminHome', label: 'Configuración Inicial', routeName: 'ConfiguracionInicial' },
  { source: 'AdminHome', label: 'Auditoría', routeName: 'AuditoriaAdmin' },
  { source: 'AdminHome', label: 'Permisos y Roles', routeName: 'PermisosRoles' },
  { source: 'AdminHome', label: 'Operación Diaria', routeName: 'OperacionDiaria' },
];

function registeredPageNames() {
  const pageConfig = fs.readFileSync(new URL('../../src/pages.config.js', import.meta.url), 'utf8');
  return [...pageConfig.matchAll(/^\s*"([^"]+)":\s*\1,/gm)].map((match) => match[1]).sort();
}

test('owner walkthrough covers every registered guarded deep-link route', () => {
  const pages = registeredPageNames();

  assert.deepEqual(Object.keys(ROUTE_ACCESS).sort(), pages);

  for (const routeName of pages) {
    const decision = getRouteAccessDecision({
      role: OWNER_PROFILE.app_role,
      routeName,
      ownerAccess,
    });

    assert.equal(decision.allowed, true, `${routeName} should be allowed for owner`);
    assert.match(decision.precedence, /^(route_role_allow|owner_override)$/);
  }
});

test('owner walkthrough covers every owner-visible admin menu route', () => {
  for (const entry of ownerMenus) {
    const decision = getRouteAccessDecision({
      role: OWNER_PROFILE.app_role,
      routeName: entry.routeName,
      ownerAccess,
    });

    assert.equal(decision.allowed, true, `${entry.source} > ${entry.label} should navigate to ${entry.routeName}`);
    assert.match(decision.precedence, /^(route_role_allow|owner_override)$/);
  }
});

test('owner denial walkthrough records route guard and owner policy failure conditions', () => {
  const cases = [
    {
      name: 'unknown route defaults closed',
      ownerAccess,
      routeName: 'NoExiste',
      expectedOwnerAllowed: true,
      expectedRoute: { allowed: false, reason_code: 'default_deny', precedence: 'route_default_deny' },
      failingCondition: 'routeName is not present in ROUTE_ACCESS',
    },
    {
      name: 'non-owner cannot use owner override for wrong-role route',
      ownerAccess: getOwnerScopedAccess({
        currentUser: { id: 'teacher-user-1', email: 'teacher@example.com' },
        ownerEmail: OWNER_USER.email,
        actorSchoolId: 'school-a',
        targetSchoolId: 'school-a',
        ownerProfiles: [OWNER_PROFILE],
      }),
      role: 'TEACHER',
      routeName: 'PermisosRoles',
      expectedOwnerAllowed: false,
      expectedOwnerReason: 'owner_not_configured',
      expectedRoute: { allowed: false, reason_code: 'forbidden_action', precedence: 'route_default_deny' },
      failingCondition: 'current user identity does not match configured owner email',
    },
    {
      name: 'owner override cannot cross tenant boundary',
      ownerAccess: getOwnerScopedAccess({
        currentUser: OWNER_USER,
        ownerEmail: OWNER_USER.email,
        actorSchoolId: 'school-a',
        targetSchoolId: 'school-b',
        ownerProfiles: [OWNER_PROFILE],
      }),
      role: 'TEACHER',
      routeName: 'PermisosRoles',
      expectedOwnerAllowed: false,
      expectedOwnerReason: 'cross_tenant_denied',
      expectedRoute: { allowed: false, reason_code: 'forbidden_action', precedence: 'route_default_deny' },
      failingCondition: 'actorSchoolId differs from targetSchoolId',
    },
    {
      name: 'owner override requires active admin owner profile in tenant',
      ownerAccess: getOwnerScopedAccess({
        currentUser: OWNER_USER,
        ownerEmail: OWNER_USER.email,
        actorSchoolId: 'school-a',
        targetSchoolId: 'school-a',
        ownerProfiles: [{ ...OWNER_PROFILE, status: 'SUSPENDED' }],
      }),
      role: 'TEACHER',
      routeName: 'PermisosRoles',
      expectedOwnerAllowed: false,
      expectedOwnerReason: 'inactive_profile',
      expectedRoute: { allowed: false, reason_code: 'forbidden_action', precedence: 'route_default_deny' },
      failingCondition: 'matching owner UserProfile is not ACTIVE',
    },
  ];

  for (const scenario of cases) {
    assert.equal(scenario.ownerAccess.allowed, scenario.expectedOwnerAllowed, scenario.name);
    if (scenario.expectedOwnerReason) {
      assert.equal(scenario.ownerAccess.reason_code, scenario.expectedOwnerReason, scenario.failingCondition);
    }

    const routeDecision = getRouteAccessDecision({
      role: scenario.role || OWNER_PROFILE.app_role,
      routeName: scenario.routeName,
      ownerAccess: scenario.ownerAccess,
    });

    assert.equal(routeDecision.allowed, scenario.expectedRoute.allowed, scenario.name);
    assert.equal(routeDecision.reason_code, scenario.expectedRoute.reason_code, scenario.name);
    assert.equal(routeDecision.precedence, scenario.expectedRoute.precedence, scenario.name);
  }
});
