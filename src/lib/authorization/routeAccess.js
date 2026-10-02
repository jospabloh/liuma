import { DENIAL_REASON_CODES, ROLES } from './policy.js';

export const DEFAULT_DENIED_REDIRECT = '/Home';

// Each grant here must be reachable: either the role's nav (navRegistry.js)
// lists the route, or it is a drill-down in ROUTE_DRILLDOWNS below. A grant
// nobody can reach is a URL-only door into a page that was never designed for
// that role (ADMIN on the parent-only Pagos rendered empty, because it scopes
// by ParentStudent links an admin doesn't have). tests/unit/route-access.test.js
// fails on any grant that is in neither list.
export const ROUTE_ACCESS = {
  Home: [ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT],
  OperacionDiaria: [ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT],
  ContactosEmergencia: [ROLES.PARENT],
  SolicitarAusencia: [ROLES.PARENT],
  MisHijos: [ROLES.PARENT],
  EventosParaPadres: [ROLES.PARENT],
  Pagos: [ROLES.PARENT],
  Avisos: [ROLES.PARENT],
  Asistencia: [ROLES.TEACHER, ROLES.PARENT],
  Tarea: [ROLES.PARENT],
  Bitacora: [ROLES.PARENT],

  // The director reaches these from Gestión de escuela (tap a classroom or a
  // student). They used to be TEACHER-only, so that obvious next tap landed on
  // "Acceso denegado" — on the main setup screen.
  GestionSalon: [ROLES.ADMIN, ROLES.TEACHER],
  GestionAlumno: [ROLES.ADMIN, ROLES.TEACHER],
  BitacorasMaestro: [ROLES.TEACHER],
  CrearBitacora: [ROLES.TEACHER],
  TareaMaestro: [ROLES.TEACHER],
  AvisosMaestro: [ROLES.TEACHER],
  // School-wide views (every absence, every classroom's attendance): ADMIN
  // only. TEACHER had a grant but no way in, and neither page scopes to the
  // teacher's own classrooms.
  GestionAusencias: [ROLES.ADMIN],
  ResumenAsistencia: [ROLES.ADMIN],

  GestionEscuela: [ROLES.ADMIN],
  ConfiguracionInicial: [ROLES.ADMIN],
  CalendarioEscolar: [ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT],
  // ADMIN keeps Soporte: it is how a director opens a ticket to ACACIA
  // (resolveSupportRouting sends an ADMIN's own tickets to the platform).
  // SoporteAdmin is the inbox of the school's tickets, a different job.
  Soporte: [ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT],
  SoporteAdmin: [ROLES.ADMIN],
  PanelSoporte: [ROLES.ADMIN],
  HistorialCambios: [ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT],
  // In-app user manual (standard module 21). No tenant data: static content.
  Ayuda: [ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT],
  // Account deletion (v1.9.0): every role, and the consent screen links here
  // before any consent is given (ConsentGate renders it without the Layout).
  EliminarCuenta: [ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT],
  // School admins see their own read-only "Mi Licencia"; the ACACIA platform
  // owner gets the full cross-tenant panel via the owner override in GuardedRoute.
  LicenseAdmin: [ROLES.ADMIN],
  GestionDocumentos: [ROLES.ADMIN],
  GestionDescuentos: [ROLES.ADMIN],
  PedidosUniformes: [ROLES.PARENT],
  GestionPedidosAdmin: [ROLES.ADMIN],
  PagosAdmin: [ROLES.ADMIN],
  Aprobaciones: [ROLES.ADMIN],
  PermisosRoles: [ROLES.ADMIN],
  AuditoriaAdmin: [ROLES.ADMIN],
  AvisosAdmin: [ROLES.ADMIN],
  AlertaEmergencia: [ROLES.ADMIN],
  Reportes: [ROLES.ADMIN],
  // No school role: see PLATFORM_OWNER_ROUTES.
  SeedTestData: [],
};

/**
 * Routes reached by tapping into a record rather than from the menu. Listed so
 * the nav-vs-matrix test can tell a deliberate drill-down from a forgotten grant.
 */
export const ROUTE_DRILLDOWNS = {
  [ROLES.ADMIN]: ['GestionSalon', 'GestionAlumno'],
  [ROLES.TEACHER]: ['GestionSalon', 'GestionAlumno', 'CrearBitacora'],
  [ROLES.PARENT]: ['ContactosEmergencia'],
};

/**
 * Routes only the ACACIA platform owner (Base44 `user.role === 'admin'`) may
 * open — never a school role, and not the school-level super-admin override
 * either. SeedTestData writes sample records into the school it runs in, and
 * with Base44's Test Data mode off those are real, undeletable rows: a customer
 * director who found the URL could pollute their own production data.
 */
export const PLATFORM_OWNER_ROUTES = ['SeedTestData'];

/**
 * Routes a profile that is not ACTIVE (PENDING / SUSPENDED) may still open.
 * Home is where those users are told their status (PendingApproval, "Cuenta
 * suspendida"), with the way to sign out; every other route would show them a
 * school's data on the strength of `app_role` alone.
 */
export const INACTIVE_PROFILE_ROUTES = ['Home'];

/**
 * Routes about the signed-in person's OWN account, open to anyone signed in
 * with a school role whatever their profile status, or with no profile yet. "Eliminar mi cuenta y mis
 * datos" is promised to every user (Aviso § 10, Términos § 6) — including
 * someone waiting for approval, suspended, or halfway through onboarding —
 * and shows no school data (deleteMyAccount derives everything from the
 * caller).
 */
export const OWN_ACCOUNT_ROUTES = ['EliminarCuenta'];

export function getRouteAccessMatrix() {
  return ROUTE_ACCESS;
}

/**
 * @param {object} args
 * @param {string} [args.role]            app_role of the current profile
 * @param {string} args.routeName
 * @param {object} [args.ownerAccess]     getOwnerScopedAccess() result
 * @param {string} [args.profileStatus]   status of the current profile; when a
 *   profile exists anything but ACTIVE is denied outside INACTIVE_PROFILE_ROUTES.
 *   Omit it only when there is no profile (the role check then denies anyway).
 * @param {boolean} [args.isPlatformOwner] Base44 user.role === 'admin'
 */
export function getRouteAccessDecision({ role, routeName, ownerAccess, profileStatus, isPlatformOwner = false }) {
  const allowedRoles = ROUTE_ACCESS[routeName];

  if (!routeName || !allowedRoles) {
    return { allowed: false, reason: DENIAL_REASON_CODES.DEFAULT_DENY, reason_code: DENIAL_REASON_CODES.DEFAULT_DENY, precedence: 'route_default_deny' };
  }

  if (PLATFORM_OWNER_ROUTES.includes(routeName)) {
    return isPlatformOwner === true
      ? { allowed: true, reason: 'platform_owner', precedence: 'platform_owner' }
      : { allowed: false, reason: DENIAL_REASON_CODES.FORBIDDEN_ACTION, reason_code: DENIAL_REASON_CODES.FORBIDDEN_ACTION, precedence: 'platform_owner_only' };
  }

  const ownAccountRoute = OWN_ACCOUNT_ROUTES.includes(routeName);
  // Someone halfway through onboarding has no profile (no role, no status) and
  // still owns an account they may delete.
  if (ownAccountRoute && !role && profileStatus === undefined) {
    return { allowed: true, reason: 'own_account', precedence: 'own_account' };
  }

  if (profileStatus !== undefined && profileStatus !== 'ACTIVE' && !INACTIVE_PROFILE_ROUTES.includes(routeName) && !ownAccountRoute) {
    return {
      allowed: false,
      reason: DENIAL_REASON_CODES.INACTIVE_PROFILE,
      reason_code: DENIAL_REASON_CODES.INACTIVE_PROFILE,
      precedence: 'inactive_profile',
    };
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
