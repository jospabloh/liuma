/**
 * In-app help (the "Ayuda" page) — the user manual a school actually reads.
 *
 * ACACIA standard, module 21: a searchable, in-app manual sectioned by task,
 * plain-language "how do I…" content. USER_MANUAL.md at the repo root is the
 * long-form reference for the team; this is the short version for directors,
 * teachers and families, and both have to describe the same app.
 *
 * Pure data so `node --test` can check it against the route matrix: every
 * `pages` entry must be a route the section's roles can actually open
 * (tests/unit/help-and-legal.test.js). A guide that sends a teacher to a page
 * that answers "Acceso denegado" is worse than no guide — that is exactly what
 * the old manual did with the removed school switcher.
 */

export const HELP_ROLES = {
  ADMIN: 'ADMIN',
  TEACHER: 'TEACHER',
  PARENT: 'PARENT',
};

export const HELP_ROLE_LABELS = {
  ADMIN: 'Dirección',
  TEACHER: 'Maestros',
  PARENT: 'Familias',
};

const { ADMIN, TEACHER, PARENT } = HELP_ROLES;
const ALL = [ADMIN, TEACHER, PARENT];

/**
 * Each section: { id, title, roles, pages, steps?, paragraphs? }.
 * `pages` = route names (as in routeAccess.js) the text tells the reader to open.
 */
export const HELP_SECTIONS = [
  // ── Primeros pasos ────────────────────────────────────────────────────────
  {
    id: 'primeros-pasos-direccion',
    title: 'Primeros pasos: abrir tu escuela en LIUMA',
    roles: [ADMIN],
    pages: ['ConfiguracionInicial', 'GestionEscuela', 'Home', 'Aprobaciones'],
    steps: [
      'Entra con tu correo y elige «Soy Directivo». Escribe el nombre de tu escuela, acepta el Aviso de Privacidad y listo: tu escuela queda creada y empieza tu prueba gratuita de 30 días.',
      'Abre Configuración y sigue la lista de pasos (datos de la escuela, documentos, calendario). Puedes marcarlos conforme avanzas.',
      'En Gestión de escuela crea tus salones y da de alta a tus alumnos (nombre, salón y fecha de nacimiento).',
      'En tu Inicio verás el código de tu escuela. Compártelo con tus maestros y con las familias: lo necesitan para registrarse.',
      'Cada persona que se registra con tu código queda pendiente. Apruébala en Aprobaciones; hasta entonces no ve nada de la escuela.',
      // ADMIN reaches GestionAlumno from GestionEscuela since the 2026-09-29
      // pass (routeAccess.js); the classroom teacher can still do it too.
      'Cuando un padre o madre ya está aprobado, vincúlalo con su hijo desde la ficha del alumno (Gestión de escuela → salón → alumno → Vincular). Sólo la dirección puede hacerlo. Sin ese vínculo no verá la información del niño.',
    ],
  },
  {
    id: 'primeros-pasos-maestro',
    title: 'Primeros pasos para maestros',
    roles: [TEACHER],
    pages: ['GestionSalon', 'GestionAlumno', 'Asistencia'],
    steps: [
      'Pide a la dirección el código de la escuela. Entra con tu correo, elige «Soy Maestro/a» y escribe el código.',
      'Tu cuenta queda pendiente hasta que la dirección la aprueba.',
      'Una vez aprobada, la dirección te asigna tus salones. Sólo verás a los alumnos de esos salones.',
      'Desde la ficha de cada alumno puedes vincular a su madre, padre o tutor (Vincular), para que reciban avisos, tareas y bitácoras.',
    ],
  },
  {
    id: 'primeros-pasos-familia',
    title: 'Primeros pasos para familias',
    roles: [PARENT],
    pages: ['MisHijos'],
    steps: [
      'Pide a la escuela su código. Entra con tu correo, elige «Soy Padre/Madre» y escribe el código.',
      'Acepta el Aviso de Privacidad y da tu consentimiento expreso para que la escuela trate los datos de salud de tus hijos (tipo de sangre, alergias y notas médicas) para su cuidado.',
      'La escuela aprueba tu cuenta y te vincula con tus hijos. Cuando eso pase, los verás en Mis hijos.',
      'Si ya pasó un día y no ves a tus hijos, pregunta en la escuela si tu cuenta ya está aprobada y vinculada.',
    ],
  },
  {
    id: 'una-cuenta-una-escuela',
    title: 'Una cuenta, una escuela',
    roles: ALL,
    pages: [],
    paragraphs: [
      'Cada cuenta de LIUMA pertenece a una sola escuela. Si necesitas usar LIUMA en otra escuela, regístrate ahí con otro correo.',
    ],
  },

  // ── Guías rápidas por rol ─────────────────────────────────────────────────
  {
    id: 'guia-direccion',
    title: 'Guía rápida: dirección',
    roles: [ADMIN],
    pages: ['OperacionDiaria', 'AvisosAdmin', 'AlertaEmergencia', 'PagosAdmin', 'GestionAusencias', 'Reportes', 'LicenseAdmin', 'PermisosRoles'],
    steps: [
      'Operación diaria: el resumen del día (asistencia, bitácoras, avisos y eventos).',
      'Avisos: manda un aviso a toda la escuela, a un salón o a un alumno. Alerta de emergencia avisa de inmediato a familias y maestros.',
      'Pagos: crea conceptos de pago, genera cargos y registra lo que cada familia paga.',
      'Ausencias: aprueba o rechaza las solicitudes de las familias.',
      'Reportes: indicadores de asistencia, bitácoras, pagos y avisos, con exportación.',
      'Licencias: el estado de tu suscripción y cuántos días quedan de prueba.',
      'Permisos y roles: cambios de rol, permisos por persona y «Descargar datos de la escuela».',
    ],
  },
  {
    id: 'guia-maestro',
    title: 'Guía rápida: maestros',
    roles: [TEACHER],
    pages: ['Asistencia', 'CrearBitacora', 'BitacorasMaestro', 'TareaMaestro', 'AvisosMaestro'],
    steps: [
      'Asistencia: elige salón y fecha y marca a cada alumno (presente, ausente, retardo o justificado).',
      'Bitácora: en Bitácoras ves quién ya tiene la del día; crea la de cada alumno en cuatro pasos y decide si se envía a los padres. Lumi puede ayudarte a redactarla.',
      'Tareas: crea la tarea con salón, materia, descripción y fecha de entrega.',
      'Avisos: manda un aviso a las familias de tu salón.',
    ],
  },
  {
    id: 'guia-familia',
    title: 'Guía rápida: familias',
    roles: [PARENT],
    pages: ['OperacionDiaria', 'Avisos', 'Tarea', 'Bitacora', 'Pagos', 'SolicitarAusencia', 'ContactosEmergencia'],
    steps: [
      'Hoy: todo lo del día de tus hijos en un solo lugar.',
      'Avisos, Tareas y Bitácora: lo que la escuela publica sobre tus hijos. Los avisos urgentes piden que confirmes que los leíste.',
      'Pagos: tus cargos pendientes y pagados.',
      'Solicitar ausencia: avisa a la escuela que tu hijo faltará y por qué.',
      'Contactos de emergencia: quién puede recoger a tu hijo y a quién llamar.',
    ],
  },

  // ── Temas comunes ─────────────────────────────────────────────────────────
  {
    id: 'solo-lectura',
    title: 'Prueba gratuita, pago y modo de solo lectura',
    roles: ALL,
    pages: [],
    paragraphs: [
      'Cada escuela nueva tiene 30 días de prueba. Antes de que termine, la dirección verá un aviso con cómo pagar.',
      'Si la licencia no está pagada, la escuela queda en solo lectura: todos pueden consultar la información y la dirección puede descargarla, pero nadie puede registrar nada nuevo. Al pagar se restablece todo, sin perder datos.',
    ],
  },
  {
    id: 'notificaciones',
    title: 'Notificaciones',
    roles: ALL,
    pages: [],
    paragraphs: [
      'Los avisos, las bitácoras enviadas y las ausencias llegan dentro de la app y por correo. Por ahora no se puede elegir el canal desde la app; si no quieres recibir correos, escríbenos desde Soporte.',
    ],
  },
  {
    id: 'lumi',
    title: 'Lumi, el asistente',
    roles: ALL,
    pages: [],
    paragraphs: [
      'Lumi responde preguntas sobre la información de tu escuela según tu rol (tareas, avisos, asistencia, pagos). Sus respuestas son de apoyo: no sustituyen el criterio médico, y la información oficial es la que publica la escuela.',
    ],
  },
  {
    id: 'soporte',
    title: '¿No encuentras algo?',
    roles: ALL,
    pages: ['Soporte'],
    paragraphs: [
      'Crea un ticket en Soporte: recibe un número y le damos seguimiento ahí mismo. La app adjunta un diagnóstico técnico para que no tengas que describir tu navegador ni la versión.',
    ],
  },
  {
    id: 'privacidad',
    title: 'Tus datos y tu privacidad',
    roles: ALL,
    pages: [],
    paragraphs: [
      'Cada escuela sólo ve sus propios datos; los maestros ven a los alumnos de sus salones y cada familia sólo a sus hijos. Consulta el Aviso de Privacidad y los Términos del servicio al pie de esta página.',
    ],
  },
];

/** Lower-case, accent-free text for forgiving search ("bitacora" finds "Bitácora"). */
export function normalizeForSearch(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function sectionText(section) {
  return [section.title, ...(section.steps || []), ...(section.paragraphs || [])].join(' ');
}

/**
 * Sections visible for a role (all of them when role is unknown, e.g. the
 * platform owner), filtered by a free-text query. Every query word must appear.
 */
export function filterHelpSections({ role = null, query = '', sections = HELP_SECTIONS } = {}) {
  const words = normalizeForSearch(query).split(/\s+/).filter(Boolean);
  return sections.filter((section) => {
    if (role && !section.roles.includes(role)) return false;
    if (words.length === 0) return true;
    const haystack = normalizeForSearch(sectionText(section));
    return words.every((w) => haystack.includes(w));
  });
}
