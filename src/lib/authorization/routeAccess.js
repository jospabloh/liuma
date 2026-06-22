import { DENIAL_REASON_CODES, ROLES } from './policy.js';

export const DEFAULT_DENIED_REDIRECT = '/Home';

export const ROUTE_ACCESS = {
  Home: [ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT],
  OperacionDiaria: [ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT],
  ContactosEmergencia: [ROLES.ADMIN, ROLES.PARENT],
  SolicitarAusencia: [ROLES.ADMIN, ROLES.PARENT],
  MisHijos: [ROLES.PARENT],
  EventosParaPadres: [ROLES.PARENT],
  Pagos: [ROLES.PARENT, ROLES.ADMIN],
  Avisos: [ROLES.PARENT],
  Asistencia: [ROLES.TEACHER, ROLES.PARENT],
  Tarea: [ROLES.PARENT],
  Bitacora: [ROLES.PARENT],

  GestionSalon: [ROLES.TEACHER],
  GestionAlumno: [ROLES.TEACHER],
  BitacorasMaestro: [ROLES.TEACHER],
  CrearBitacora: [ROLES.TEACHER],
  TareaMaestro: [ROLES.TEACHER],
  AvisosMaestro: [ROLES.TEACHER],
  GestionAusencias: [ROLES.ADMIN, ROLES.TEACHER],
  ResumenAsistencia: [ROLES.ADMIN, ROLES.TEACHER],

  GestionEscuela: [ROLES.ADMIN],
  ConfiguracionInicial: [ROLES.ADMIN],
  CalendarioEscolar: [ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT],
  Soporte: [ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT],
  SoporteAdmin: [ROLES.ADMIN],
  PanelSoporte: [ROLES.ADMIN],
  // School admins see their own read-only "Mi Licencia"; the ACACIA platform
  // owner gets the full cross-tenant panel via the owner override in GuardedRoute.
  LicenseAdmin: [ROLES.ADMIN],
  GestionDocumentos: [ROLES.ADMIN],
  GestionDescuentos: [ROLES.ADMIN],
  PedidosUniformes: [ROLES.ADMIN, ROLES.PARENT],
  GestionPedidosAdmin: [ROLES.ADMIN],
  PagosAdmin: [ROLES.ADMIN],
  Aprobaciones: [ROLES.ADMIN],
  PermisosRoles: [ROLES.ADMIN],
  AuditoriaAdmin: [ROLES.ADMIN],
  AvisosAdmin: [ROLES.ADMIN],
  AlertaEmergencia: [ROLES.ADMIN],
  Reportes: [ROLES.ADMIN],
  SeedTestData: [ROLES.ADMIN],
};

export function getRouteAccessMatrix() {
  return ROUTE_ACCESS;
}

export function getRouteAccessDecision({ role, routeName, ownerAccess }) {
  const allowedRoles = ROUTE_ACCESS[routeName];

  if (!routeName || !allowedRoles) {
    return { allowed: false, reason: DENIAL_REASON_CODES.DEFAULT_DENY, reason_code: DENIAL_REASON_CODES.DEFAULT_DENY, precedence: 'route_default_deny' };
  }

  if (role && allowedRoles.includes(role)) {
    return { allowed: true, reason: 'route_role_allow', precedence: 'route_role_allow' };
  }

  if (ownerAccess?.allowed) {
    return {
      allowed: true,
      reason: 'owner_override',
      precedence: 'owner_override',
      owner_reason: ownerAccess.reason,
      identity_source: ownerAccess.identity_source,
    };
  }

  return {
    allowed: false,
    reason: DENIAL_REASON_CODES.FORBIDDEN_ACTION,
    reason_code: DENIAL_REASON_CODES.FORBIDDEN_ACTION,
    precedence: 'route_default_deny',
    owner_denied: Boolean(ownerAccess && !ownerAccess.allowed && (ownerAccess.reason_code || ownerAccess.reason) !== DENIAL_REASON_CODES.OWNER_NOT_CONFIGURED),
    owner_reason: ownerAccess?.reason_code || ownerAccess?.reason || null,
  };
}

export function canAccessRoute({ role, routeName }) {
  return getRouteAccessDecision({ role, routeName }).allowed;
}
