/**
 * Navigation registry — the single source of truth for the bottom tab bar and
 * the ⌘K command palette. Both read from here so there is exactly one place to
 * curate "where can this role go".
 *
 * Design goal (simplicity for the user): every screen is reachable from a fixed
 * 4-item bottom bar — Inicio · Hoy · Avisos · Menú — without bouncing back to
 * the home grid. "Menú" opens the palette, which lists/searches everything else
 * for the role. Icons are referenced by string name and resolved to lucide
 * components in the React layer, so this module stays pure and unit-testable.
 */

export const ROLES = { ADMIN: 'ADMIN', TEACHER: 'TEACHER', PARENT: 'PARENT' };

/** Role-appropriate notices page (the "Avisos" tab resolves through here). */
export function getAvisosPage(role) {
  if (role === ROLES.ADMIN) return 'AvisosAdmin';
  if (role === ROLES.TEACHER) return 'AvisosMaestro';
  return 'Avisos';
}

/**
 * The four persistent bottom-bar tabs. The first three navigate; the last opens
 * the command palette (action: 'palette'). Inicio and Hoy are the same page for
 * every role, so only Avisos varies.
 */
export function getPrimaryTabs(role) {
  return [
    { key: 'home', label: 'Inicio', page: 'Home', icon: 'Home' },
    { key: 'today', label: 'Hoy', page: 'OperacionDiaria', icon: 'CalendarCheck' },
    { key: 'avisos', label: 'Avisos', page: getAvisosPage(role), icon: 'Bell' },
    { key: 'menu', label: 'Más', action: 'palette', icon: 'LayoutGrid' },
  ];
}

const ADMIN_DESTINATIONS = [
  { page: 'OperacionDiaria', label: 'Operación diaria', icon: 'CalendarCheck', group: 'Día a día' },
  { page: 'Aprobaciones', label: 'Aprobaciones', icon: 'UserCheck', group: 'Día a día' },
  { page: 'ResumenAsistencia', label: 'Asistencia', icon: 'ClipboardList', group: 'Día a día' },
  { page: 'GestionAusencias', label: 'Ausencias', icon: 'CalendarOff', group: 'Día a día' },
  { page: 'AvisosAdmin', label: 'Avisos', icon: 'Bell', group: 'Comunicación' },
  { page: 'AlertaEmergencia', label: 'Alerta de emergencia', icon: 'Siren', group: 'Comunicación' },
  { page: 'CalendarioEscolar', label: 'Calendario', icon: 'Calendar', group: 'Comunicación' },
  { page: 'GestionEscuela', label: 'Gestión de escuela', icon: 'School', group: 'Administración' },
  { page: 'PagosAdmin', label: 'Pagos', icon: 'CreditCard', group: 'Administración' },
  { page: 'GestionDescuentos', label: 'Descuentos', icon: 'Percent', group: 'Administración' },
  { page: 'GestionDocumentos', label: 'Documentos', icon: 'FileText', group: 'Administración' },
  { page: 'GestionPedidosAdmin', label: 'Pedidos', icon: 'ShoppingBag', group: 'Administración' },
  { page: 'Reportes', label: 'Reportes', icon: 'BarChart3', group: 'Administración' },
  { page: 'PermisosRoles', label: 'Permisos y roles', icon: 'ShieldCheck', group: 'Configuración' },
  { page: 'ConfiguracionInicial', label: 'Configuración', icon: 'Settings', group: 'Configuración' },
  { page: 'LicenseAdmin', label: 'Licencias', icon: 'KeyRound', group: 'Configuración' },
  { page: 'AuditoriaAdmin', label: 'Auditoría', icon: 'ScrollText', group: 'Configuración' },
  { page: 'SoporteAdmin', label: 'Consola de soporte', icon: 'Headset', group: 'Soporte' },
  { page: 'PanelSoporte', label: 'Panel de soporte', icon: 'LifeBuoy', group: 'Soporte' },
];

const TEACHER_DESTINATIONS = [
  { page: 'OperacionDiaria', label: 'Operación diaria', icon: 'CalendarCheck', group: 'Día a día' },
  { page: 'Asistencia', label: 'Asistencia', icon: 'ClipboardCheck', group: 'Día a día' },
  { page: 'TareaMaestro', label: 'Tareas', icon: 'BookOpen', group: 'Día a día' },
  { page: 'BitacorasMaestro', label: 'Bitácoras', icon: 'NotebookPen', group: 'Día a día' },
  { page: 'AvisosMaestro', label: 'Avisos', icon: 'Bell', group: 'Comunicación' },
  { page: 'CalendarioEscolar', label: 'Calendario', icon: 'Calendar', group: 'Comunicación' },
  { page: 'Soporte', label: 'Soporte', icon: 'Headset', group: 'Soporte' },
];

const PARENT_DESTINATIONS = [
  { page: 'OperacionDiaria', label: 'Hoy', icon: 'CalendarCheck', group: 'Día a día' },
  { page: 'MisHijos', label: 'Mis hijos', icon: 'Users', group: 'Día a día' },
  { page: 'Tarea', label: 'Tareas', icon: 'BookOpen', group: 'Día a día' },
  { page: 'Bitacora', label: 'Bitácora', icon: 'NotebookPen', group: 'Día a día' },
  { page: 'Avisos', label: 'Avisos', icon: 'Bell', group: 'Comunicación' },
  { page: 'EventosParaPadres', label: 'Eventos', icon: 'PartyPopper', group: 'Comunicación' },
  { page: 'CalendarioEscolar', label: 'Calendario', icon: 'Calendar', group: 'Comunicación' },
  { page: 'Pagos', label: 'Pagos', icon: 'CreditCard', group: 'Trámites' },
  { page: 'PedidosUniformes', label: 'Uniformes', icon: 'Shirt', group: 'Trámites' },
  { page: 'SolicitarAusencia', label: 'Solicitar ausencia', icon: 'CalendarOff', group: 'Trámites' },
  { page: 'Soporte', label: 'Soporte', icon: 'Headset', group: 'Soporte' },
];

const DESTINATIONS_BY_ROLE = {
  [ROLES.ADMIN]: ADMIN_DESTINATIONS,
  [ROLES.TEACHER]: TEACHER_DESTINATIONS,
  [ROLES.PARENT]: PARENT_DESTINATIONS,
};

/** Full ordered destination list for a role (parents are the default). */
export function getDestinations(role) {
  return DESTINATIONS_BY_ROLE[role] || PARENT_DESTINATIONS;
}

/** Destinations grouped by their `group`, preserving insertion order. */
export function getGroupedDestinations(role) {
  const byGroup = new Map(); // Map preserves first-seen (insertion) order.
  for (const dest of getDestinations(role)) {
    if (!byGroup.has(dest.group)) byGroup.set(dest.group, []);
    byGroup.get(dest.group).push(dest);
  }
  return [...byGroup].map(([group, items]) => ({ group, items }));
}

/** URL for a page name — mirrors src/utils createPageUrl. */
export function pageUrl(page) {
  return '/' + page.replace(/ /g, '-');
}

/** Is `pathname` the page for this nav target? Used to highlight the active tab. */
export function isActivePath(pathname, page) {
  if (!pathname || !page) return false;
  const url = pageUrl(page);
  return pathname === url || pathname === url + '/';
}
