// _lumiCore.ts — pure logic shared by the two Lumi function tools
// (lumiQuery and lumiWrite). IDENTICAL BYTE FOR BYTE in
// base44/functions/lumiQuery/ and base44/functions/lumiWrite/: Deno functions
// cannot import across function directories (same constraint documented on
// guardedEntityWrite/entry.ts), so each function carries its own copy and
// tests/unit/lumi-core.test.js fails if the two drift apart. Edit one, copy it
// over the other.
//
// Import-free on purpose: `node --test` loads this file directly (Node 22
// strips the type annotations), so the rules that decide WHO sees WHAT through
// Lumi are exercised by real tests, not by grepping the source.
//
// Why these rules live server-side at all: Lumi used to get raw entity tools
// (read Student/Homework/…, create DiaryEntry/Attendance). Those ran under the
// entity RLS, so for school users they returned nothing, and the writes
// skipped guardedEntityWrite (overrides, read-only billing gate, parent
// notification). The function tools re-derive the caller's school, role,
// classrooms and children from their own UserProfile on every call — never
// from anything the chat (or the model) says.

export type Profile = {
  id?: string;
  user_id?: string;
  school_id?: string;
  app_role?: string;
  status?: string;
  onboarding_completed?: boolean;
  created_date?: string;
};

export type Scope = {
  userId: string;
  schoolId: string;
  role: 'ADMIN' | 'TEACHER' | 'PARENT';
  classroomIds: string[];
  studentIds: string[];
};

export const ROLES = ['ADMIN', 'TEACHER', 'PARENT'] as const;

// Mirrors src/lib/tenantSelection.js's selectCurrentUserProfile — the ONE rule
// for "which school am I looking at" (module 14 finding: two readers with two
// rules could pick different schools). Newest ACTIVE+onboarded profile; else
// the newest profile at all. Deterministic regardless of filter() order.
export function selectCurrentProfile(profiles: Profile[] = []): Profile | null {
  const sorted = [...profiles].sort((a, b) =>
    String(b.created_date || '').localeCompare(String(a.created_date || '')));
  const eligible = sorted.filter((p) => p.status === 'ACTIVE' && p.onboarding_completed);
  return eligible[0] || sorted[0] || null;
}

// The selected profile must itself be usable. Returns an error code, or null.
// The platform owner is NOT exempt: Lumi answers inside the owner's own school
// profile like anyone else, so a demo never mixes several customers' data.
export function profileProblem(profile: Profile | null): string | null {
  if (!profile) return 'NO_PROFILE';
  if (profile.status !== 'ACTIVE') return 'INACTIVE_PROFILE';
  if (!profile.school_id) return 'NO_SCHOOL';
  if (!ROLES.includes(profile.app_role as typeof ROLES[number])) return 'INVALID_ROLE';
  return null;
}

// --- Intents -----------------------------------------------------------------

export const QUERY_INTENTS: Record<string, Array<Scope['role']>> = {
  my_context: ['ADMIN', 'TEACHER', 'PARENT'],
  my_children_summary: ['PARENT'],
  resolve_student_by_name: ['ADMIN', 'TEACHER', 'PARENT'],
  homework: ['ADMIN', 'TEACHER', 'PARENT'],
  attendance: ['ADMIN', 'TEACHER', 'PARENT'],
  diary_recent: ['ADMIN', 'TEACHER', 'PARENT'],
  pending_charges: ['ADMIN', 'PARENT'],
  notices: ['ADMIN', 'TEACHER', 'PARENT'],
  upcoming_events: ['ADMIN', 'TEACHER', 'PARENT'],
  current_menu: ['ADMIN', 'TEACHER', 'PARENT'],
  official_documents: ['ADMIN', 'TEACHER', 'PARENT'],
  setup_pending: ['ADMIN'],
  uniform_status: ['ADMIN', 'PARENT'],
};

export function canRunIntent(role: string, intent: string): boolean {
  return (QUERY_INTENTS[intent] || []).includes(role as Scope['role']);
}

// Writes Lumi may perform, and who may ask for them. PARENT is never here:
// a parent cannot mark attendance or write a bitácora by asking the chat.
export const WRITE_KINDS: Record<string, Array<Scope['role']>> = {
  attendance: ['ADMIN', 'TEACHER'],
  diary: ['ADMIN', 'TEACHER'],
};

export function canWriteKind(role: string, kind: string): boolean {
  return (WRITE_KINDS[kind] || []).includes(role as Scope['role']);
}

// --- Row scoping -------------------------------------------------------------

type Row = Record<string, unknown>;

// Belt and braces on top of the school-filtered queries in entry.ts: every row
// must belong to the caller's school, and within it to what their role can see.
// ADMIN: whole school. TEACHER: their classrooms (and students in them).
// PARENT: their linked children (and those children's classrooms, for
// classroom-wide rows like homework and class notices).
export function rowVisible(scope: Scope, entity: string, row: Row): boolean {
  if (!row || String(row.school_id || '') !== scope.schoolId) return false;
  if (scope.role === 'ADMIN') return true;

  const classroomId = String(row.classroom_id || '');
  const studentId = String(row.student_id || '');
  const inClassrooms = !!classroomId && scope.classroomIds.includes(classroomId);
  const inStudents = !!studentId && scope.studentIds.includes(studentId);

  switch (entity) {
    case 'Student':
      return scope.studentIds.includes(String(row.id || ''));
    case 'Homework':
      return inClassrooms;
    case 'Attendance':
    case 'DiaryEntry':
    case 'ChargeItem':
    case 'UniformOrder':
      if (entity === 'ChargeItem' && scope.role !== 'PARENT') return false;
      if (entity === 'UniformOrder' && scope.role !== 'PARENT') return false;
      return inStudents;
    case 'Notice': {
      const s = String(row.scope || 'SCHOOL');
      if (s === 'SCHOOL') return true;
      if (s === 'CLASSROOM') return inClassrooms;
      if (s === 'STUDENT') return inStudents;
      return false;
    }
    case 'Event': {
      const s = String(row.scope || 'SCHOOL');
      if (s === 'SCHOOL') return true;
      return inClassrooms;
    }
    case 'OfficialDocument': {
      const audience = String(row.target_audience || 'TODOS');
      if (audience === 'TODOS') return true;
      if (scope.role === 'PARENT') return audience === 'PADRES';
      if (scope.role === 'TEACHER') return audience === 'MAESTROS';
      return false;
    }
    case 'WeeklyMenu':
      return true;
    default:
      return false;
  }
}

export function scopeRows<T extends Row>(scope: Scope, entity: string, rows: T[] = []): T[] {
  return (rows || []).filter((row) => rowVisible(scope, entity, row));
}

// --- Dates (America/Mexico_City) ---------------------------------------------

export const TIME_ZONE = 'America/Mexico_City';
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

// "Today" for the school, not for the server: a parent asking at 21:00 in
// Mexico (03:00 UTC next day) must get today's homework, not tomorrow's.
export function mexicoToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function isDateOnly(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const m = DATE_ONLY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

// Pure calendar arithmetic on 'YYYY-MM-DD' (UTC components, so no host TZ).
export function addDays(dateStr: string, days: number): string {
  const m = DATE_ONLY.exec(dateStr);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MENU_DAY_KEYS = ['', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', ''];

function utcFromDateOnly(dateStr: string): Date | null {
  if (!isDateOnly(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// 'lunes 3 de marzo' — the format the prompt asks Lumi to speak in, produced
// here so the model never has to compute a weekday itself.
export function spanishLongDate(dateStr: string): string {
  const d = utcFromDateOnly(dateStr);
  if (!d) return '';
  return `${WEEKDAYS_ES[d.getUTCDay()]} ${d.getUTCDate()} de ${MONTHS_ES[d.getUTCMonth()]}`;
}

// ISO-8601 week number + ISO year, for WeeklyMenu.week_number/year.
export function isoWeek(dateStr: string): { week: number; year: number } | null {
  const d = utcFromDateOnly(dateStr);
  if (!d) return null;
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { week, year: d.getUTCFullYear() };
}

// WeeklyMenu column for a date ('' on weekends — there is no menu).
export function menuDayKey(dateStr: string): string {
  const d = utcFromDateOnly(dateStr);
  return d ? MENU_DAY_KEYS[d.getUTCDay()] : '';
}

// --- Presentation: no ids, no English enums, money in MXN --------------------

export const ENUM_LABELS: Record<string, Record<string, string>> = {
  attendance_status: { present: 'presente', absent: 'ausente', late: 'retardo', excused: 'falta justificada' },
  charge_status: { PENDING: 'pendiente', PAID: 'pagado', OVERDUE: 'vencido', CANCELLED: 'cancelado' },
  charge_type: {
    INSCRIPCION: 'inscripción', COLEGIATURA: 'colegiatura', HORARIO_EXTENDIDO: 'horario extendido',
    EVENTO: 'evento', OTRO: 'otro',
  },
  uniform_status: {
    PENDING: 'recibido, por procesar', PROCESSING: 'en proceso', READY: 'listo para recoger',
    DELIVERED: 'entregado', CANCELLED: 'cancelado',
  },
  notice_priority: { NORMAL: 'normal', IMPORTANT: 'importante', URGENT: 'urgente' },
  role: { ADMIN: 'dirección', TEACHER: 'docente', PARENT: 'madre, padre o tutor' },
  behavior: { excelente: 'excelente', bueno: 'bueno', regular: 'regular', necesita_apoyo: 'necesita apoyo' },
  learning: { excelente: 'excelente', bueno: 'bueno', regular: 'regular', necesita_apoyo: 'necesita apoyo' },
  mood: { feliz: 'feliz', tranquilo: 'tranquilo', cansado: 'cansado', inquieto: 'inquieto', triste: 'triste' },
  food: { todo: 'comió todo', casi_todo: 'comió casi todo', poco: 'comió poco', nada: 'no comió' },
  food_mood: { feliz: 'bien', neutral: 'regular', triste: 'mal' },
  general_mood: { feliz: 'feliz', neutral: 'tranquilo', triste: 'triste' },
  uniform: { limpio: 'limpio', sucio: 'sucio' },
  setup_category: { GENERAL: 'general', GUARDERIA: 'guardería', ESCUELA: 'escuela', COLEGIO: 'colegio' },
  document_type: {
    MENU: 'menú', COMMUNICATION: 'comunicado', MINUTA: 'minuta', UNIFORM_CATALOG: 'catálogo de uniformes',
  },
};

export function label(group: string, value: unknown): string {
  if (value == null || value === '') return '';
  return ENUM_LABELS[group]?.[String(value)] || String(value);
}

export function formatMXN(amount: unknown): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
}

export function fullName(person: { first_name?: unknown; last_name?: unknown } | null | undefined): string {
  if (!person) return '';
  return [person.first_name, person.last_name].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
}

// --- Student name resolution ---------------------------------------------------

export function normalizeName(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type StudentRow = { id?: string; first_name?: string; last_name?: string; classroom_id?: string };

// A dictated "Sofía" must never land on a guessed child. Every word the
// teacher said has to be the start of some word of the student's name
// (accent- and case-insensitive). One match -> 'unique'. Several -> 'ambiguous'
// and Lumi has to ask which one. An exact full-name hit among several wins,
// because "Ana López" should not be ambiguous with "Ana López Ruiz"… unless
// two students share that exact name, which stays ambiguous.
export function matchStudents(students: StudentRow[] = [], query: unknown): {
  status: 'unique' | 'ambiguous' | 'none';
  candidates: StudentRow[];
} {
  const q = normalizeName(query);
  if (!q) return { status: 'none', candidates: [] };
  const qTokens = q.split(' ');
  const matches = (students || []).filter((s) => {
    const nameTokens = normalizeName(fullName(s)).split(' ').filter(Boolean);
    return qTokens.every((qt) => nameTokens.some((nt) => nt.startsWith(qt)));
  });
  if (matches.length === 0) return { status: 'none', candidates: [] };
  if (matches.length === 1) return { status: 'unique', candidates: matches };
  const exact = matches.filter((s) => normalizeName(fullName(s)) === q);
  if (exact.length === 1) return { status: 'unique', candidates: exact };
  return { status: 'ambiguous', candidates: matches };
}

// --- Write payload validation --------------------------------------------------

const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'];
const DIARY_ENUMS: Record<string, string[]> = {
  behavior: ['excelente', 'bueno', 'regular', 'necesita_apoyo'],
  learning: ['excelente', 'bueno', 'regular', 'necesita_apoyo'],
  mood: ['feliz', 'tranquilo', 'cansado', 'inquieto', 'triste'],
  food: ['todo', 'casi_todo', 'poco', 'nada'],
  food_mood: ['feliz', 'neutral', 'triste'],
  general_mood: ['feliz', 'neutral', 'triste'],
  uniform_status: ['limpio', 'sucio'],
};
const DIARY_TEXT_FIELDS = ['notes_text', 'teacher_message', 'incidents', 'naps', 'bathroom', 'needs_other'];
const DIARY_BOOL_FIELDS = ['bathroom_pipi', 'bathroom_popo', 'needs_diapers', 'needs_ointment', 'needs_clothes'];
export const MAX_TEXT = 4000;
export const MAX_BACKDATE_DAYS = 30;

export function cleanText(value: unknown, max = MAX_TEXT): string {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\p{P}\p{Z}\p{S}\n]/gu, '')
    .trim()
    .slice(0, max);
}

// A record date Lumi may write: a real calendar day, not in the future, at most
// MAX_BACKDATE_DAYS back. Defaults to today in Mexico.
export function resolveWriteDate(value: unknown, today: string): { date?: string; error?: string } {
  if (value == null || value === '') return { date: today };
  if (!isDateOnly(value)) return { error: 'BAD_DATE' };
  const date = String(value);
  if (date > today) return { error: 'FUTURE_DATE' };
  if (date < addDays(today, -MAX_BACKDATE_DAYS)) return { error: 'DATE_TOO_OLD' };
  return { date };
}

export type WriteValidation = { ok: true; data: Record<string, unknown> } | { ok: false; errors: string[] };

// Whitelists what may be written. Nothing identifying (school_id, student_id,
// teacher_id, recorded_by…) is ever taken from the model: entry.ts sets those
// from the resolved student and guardedEntityWrite overrides attribution.
export function validateWrite(kind: string, input: Record<string, unknown> = {}, today: string): WriteValidation {
  const errors: string[] = [];
  const data: Record<string, unknown> = {};
  const when = resolveWriteDate(input.date, today);
  if (when.error) errors.push(when.error);
  else data.date = when.date;

  if (kind === 'attendance') {
    const status = String(input.status || '');
    if (!ATTENDANCE_STATUSES.includes(status)) errors.push('BAD_STATUS');
    else data.status = status;
    const reason = cleanText(input.reason, 500);
    if (reason) data.reason = reason;
  } else if (kind === 'diary') {
    for (const field of DIARY_TEXT_FIELDS) {
      const text = cleanText(input[field]);
      if (text) data[field] = text;
    }
    if (!data.notes_text) errors.push('MISSING_NOTES');
    for (const [field, allowed] of Object.entries(DIARY_ENUMS)) {
      const v = input[field];
      if (v == null || v === '') continue;
      if (!allowed.includes(String(v))) errors.push(`BAD_${field.toUpperCase()}`);
      else data[field] = String(v);
    }
    for (const field of DIARY_BOOL_FIELDS) {
      if (typeof input[field] === 'boolean') data[field] = input[field];
    }
    for (const [field, max] of [['sleep_hours', 12], ['sleep_minutes', 59]] as const) {
      const v = input[field];
      if (v == null || v === '') continue;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > max) errors.push(`BAD_${field.toUpperCase()}`);
      else data[field] = n;
    }
    if (typeof input.send_to_parents !== 'boolean') errors.push('ASK_SEND_TO_PARENTS');
    else data.sent_to_parents = input.send_to_parents;
  } else {
    errors.push('UNKNOWN_KIND');
  }

  return errors.length ? { ok: false, errors } : { ok: true, data };
}

// --- Confirmation --------------------------------------------------------------

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

// A write only commits with the code its own preview returned. The code is a
// digest of exactly what will be written, by whom, today — so the model
// cannot skip the preview (it cannot compute SHA-256), a preview for Juan
// cannot commit a write for Pedro, and yesterday's code is dead. Whether the
// HUMAN said "sí" in between is the prompt's job; this guarantees that what
// they were shown is what gets written.
export async function confirmationCode(parts: {
  userId: string; kind: string; studentId: string; data: Record<string, unknown>; day: string;
}): Promise<string> {
  const bytes = new TextEncoder().encode(`lumi.write.v1|${stableStringify(parts)}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).slice(0, 5)
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Human summary of a pending write, in the words the teacher will confirm.
export function describeWrite(kind: string, studentName: string, data: Record<string, unknown>): string {
  const when = spanishLongDate(String(data.date || ''));
  if (kind === 'attendance') {
    const reason = data.reason ? ` (motivo: ${data.reason})` : '';
    return `Asistencia de ${studentName}: ${label('attendance_status', data.status)} el ${when}${reason}.`;
  }
  const bits: string[] = [];
  for (const field of ['mood', 'general_mood', 'food', 'food_mood', 'behavior', 'learning', 'uniform_status']) {
    if (data[field]) {
      const group = field === 'uniform_status' ? 'uniform' : field;
      bits.push(`${field.replace(/_/g, ' ')}: ${label(group, data[field])}`);
    }
  }
  if (data.sleep_hours != null || data.sleep_minutes != null) {
    bits.push(`siesta: ${Number(data.sleep_hours || 0)} h ${Number(data.sleep_minutes || 0)} min`);
  }
  const send = data.sent_to_parents ? 'Se enviará a la familia.' : 'No se enviará a la familia.';
  return `Bitácora de ${studentName} del ${when}: "${data.notes_text}"${bits.length ? ` · ${bits.join(' · ')}` : ''}. ${send}`;
}

// Spanish explanations for the model, so it can tell the user WHY — "no tienes
// acceso" and "no hay registros" are different answers (a denial must never
// read as an empty result).
export const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'No pude identificar tu sesión. Cierra y vuelve a abrir LIUMA.',
  NO_PROFILE: 'Tu cuenta no tiene un perfil activo en ninguna escuela.',
  INACTIVE_PROFILE: 'Tu perfil en la escuela todavía no está activo; la dirección debe aprobarlo.',
  NO_SCHOOL: 'Tu perfil no está ligado a una escuela.',
  INVALID_ROLE: 'Tu perfil no tiene un rol válido.',
  NOT_ALLOWED_FOR_ROLE: 'Esa consulta no está disponible para tu rol.',
  UNKNOWN_INTENT: 'No conozco esa consulta.',
  UNKNOWN_KIND: 'Sólo puedo registrar asistencia o bitácoras.',
  INTERNAL: 'Ocurrió un error inesperado. Intenta de nuevo o crea un ticket en Soporte.',
  STUDENT_NOT_VISIBLE: 'Ese alumno no está entre los que puedes ver o registrar.',
  NEEDS_CONFIRMATION: 'Primero muestra el resumen y pide confirmación; luego repite con el código de confirmación.',
  ALREADY_EXISTS: 'Ese alumno ya tiene bitácora ese día. Se puede editar desde la pantalla Bitácoras.',
  FORBIDDEN: 'La escuela te quitó el permiso para registrar esto.',
  WRITE_BLOCKED: 'La licencia de la escuela está en modo solo lectura; no se pueden registrar cambios.',
  WRITE_FAILED: 'No se pudo guardar. Intenta desde la pantalla correspondiente o crea un ticket en Soporte.',
  BAD_DATE: 'La fecha no es válida.',
  FUTURE_DATE: 'No se puede registrar una fecha futura.',
  DATE_TOO_OLD: `Sólo se pueden registrar fechas de los últimos ${MAX_BACKDATE_DAYS} días.`,
  BAD_STATUS: 'El estado de asistencia debe ser presente, ausente, retardo o falta justificada.',
  MISSING_NOTES: 'La bitácora necesita al menos las notas del día.',
  ASK_SEND_TO_PARENTS: 'Pregunta si la bitácora se envía a la familia (sí o no).',
};

export function errorMessage(code: string): string {
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  if (code.startsWith('BAD_')) return 'Uno de los datos no tiene un valor válido.';
  return 'Ocurrió un error inesperado.';
}
