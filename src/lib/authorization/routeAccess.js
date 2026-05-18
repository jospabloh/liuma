import { ROLES } from './policy.js';

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
  Asistencia: [ROLES.PARENT],
  Tarea: [ROLES.PARENT],
  Bitacora: [ROLES.PARENT],

  GestionSalon: [ROLES.TEACHER],
  GestionAlumno: [ROLES.TEACHER],
  BitacorasMaestro: [ROLES.TEACHER],
  CrearBitacora: [ROLES.TEACHER],
  TareaMaestro: [ROLES.TEACHER],
  AvisosMaestro: [ROLES.TEACHER],
  GestionAusencias: [ROLES.TEACHER],
  ResumenAsistencia: [ROLES.TEACHER],

  GestionEscuela: [ROLES.ADMIN],
  ConfiguracionInicial: [ROLES.ADMIN],
  CalendarioEscolar: [ROLES.ADMIN],
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
};

export function getRouteAccessMatrix() {
  return ROUTE_ACCESS;
}

export function canAccessRoute({ role, routeName }) {
  const allowedRoles = ROUTE_ACCESS[routeName];
  if (!allowedRoles || !role) return false;
  return allowedRoles.includes(role);
}
