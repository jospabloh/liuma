/**
 * aiIntake — el "BA + PO experto" que entrevista al solicitante ANTES de crear
 * un ticket, para que quien atienda (dirección de la escuela o el equipo LIUMA)
 * reciba una especificación lista para diseñar e implementar (no un "no funciona"
 * sin contexto).
 *
 * Portable entre apps del portafolio ACACIA: lo único específico de la app es
 * `APP_CONTEXT` (nombre + dominio + módulos). El motor es el LLM de Base44
 * (`base44.integrations.Core.InvokeLLM`), que ya se usa client-side en la app
 * (ver `src/pages/CrearBitacora.jsx`), así que no requiere backend nuevo.
 *
 * Flujo (entrevista conversacional, una pregunta a la vez):
 *   intakeTurn(kind, {}) → primera pregunta
 *   intakeTurn(kind, { history }) → siguiente pregunta … hasta que el modelo
 *   decide que tiene suficiente y devuelve `{ done: true, brief }` con el brief
 *   estructurado.
 *
 * El brief se convierte a Markdown con `briefToMarkdown()` y viaja DENTRO del
 * cuerpo del ticket (garantiza que llegue al hilo, al correo de escalamiento y a
 * Mission Control sin depender de un deploy de esquema), y además se manda como
 * campo estructurado `ai_brief` para render enriquecido.
 */
import { base44 } from '@/api/base44Client';

// —— Contexto específico de la app (lo único que cambia al portar) ———————————————
export const APP_CONTEXT = {
  name: 'LIUMA',
  // Descripción corta del dominio para orientar las preguntas del BA/PO.
  domain:
    'SaaS escolar multi-tenant: cada escuela (tenant) administra su comunidad ' +
    'de alumnos, docentes y padres/tutores. La app cubre operación diaria, ' +
    'asistencia, tareas, bitácoras/diarios del alumno, avisos, eventos, ' +
    'calendario escolar, pagos y cargos, descuentos, documentos oficiales, ' +
    'pedidos de uniformes y solicitudes de ausencia. Los roles son dirección ' +
    '(ADMIN), docente (TEACHER) y padre/madre/tutor (PARENT).',
  // Módulos/pantallas conocidas — ayudan a la IA a ubicar el área afectada.
  modules: [
    'Operación diaria', 'Asistencia', 'Tareas', 'Bitácoras / Diario del alumno',
    'Avisos', 'Eventos', 'Calendario escolar', 'Pagos y cargos', 'Descuentos',
    'Documentos oficiales', 'Uniformes / Pedidos', 'Ausencias', 'Mis hijos',
    'Gestión de escuela', 'Reportes', 'Permisos y roles', 'Licencias', 'Soporte',
  ],
};

// Cuántas preguntas como máximo antes de forzar el brief (evita entrevistas
// eternas y acota el costo de LLM). El modelo puede cerrar antes.
export const MAX_QUESTIONS = 6;

// Neutraliza intentos de inyección de prompt en el texto libre del usuario antes
// de incrustarlo.
function sanitize(text = '') {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\p{P}\p{Z}\p{S}\n]/gu, '')
    .trim()
    .slice(0, 4000);
}

const KIND_LABEL = { feature: 'nueva funcionalidad / mejora', bug: 'reporte de incidencia' };

// Esquema de la respuesta del modelo en cada turno: o una pregunta, o el brief.
const TURN_SCHEMA = {
  type: 'object',
  properties: {
    done: { type: 'boolean' },
    // Presente cuando done=false.
    question: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        hint: { type: 'string' },
        // Respuestas rápidas sugeridas (chips) — opcional.
        suggestions: { type: 'array', items: { type: 'string' } },
      },
    },
    // Presente cuando done=true.
    brief: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['feature', 'bug'] },
        title: { type: 'string' },
        summary: { type: 'string' },
        affected_area: { type: 'string' },
        // Feature / mejora
        user_story: { type: 'string' },
        acceptance_criteria: { type: 'array', items: { type: 'string' } },
        scope_in: { type: 'array', items: { type: 'string' } },
        scope_out: { type: 'array', items: { type: 'string' } },
        // Incidencia
        repro_steps: { type: 'array', items: { type: 'string' } },
        expected_behavior: { type: 'string' },
        actual_behavior: { type: 'string' },
        severity: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] },
        // Comunes
        impact: { type: 'string' },
        priority_suggestion: { type: 'string', enum: ['low', 'normal', 'high'] },
        open_questions: { type: 'array', items: { type: 'string' } },
      },
      required: ['kind', 'title', 'summary'],
    },
  },
  required: ['done'],
};

function systemPreamble(kind) {
  return `Eres un Analista de Negocio (BA) y Product Owner (PO) experto que atiende la mesa de soporte de "${APP_CONTEXT.name}".
Dominio de la app: ${APP_CONTEXT.domain}
Módulos/pantallas: ${APP_CONTEXT.modules.join(', ')}.

Estás atendiendo un caso de tipo: ${KIND_LABEL[kind] || kind}.

Tu objetivo: entrevistar al solicitante (que NO es técnico; suele ser una educadora,
la dirección de la escuela o un padre/madre de familia) con preguntas claras y
breves, UNA A LA VEZ, para reunir todo lo necesario y que un desarrollador pueda
pasar directo a DISEÑAR e IMPLEMENTAR sin volver a preguntar.

Reglas de la entrevista:
- Habla en español mexicano, cálido y concreto. Nada de tecnicismos.
- Una sola pregunta por turno. Que sea la de mayor valor según lo que ya sabes.
- No repitas lo que el usuario ya respondió. No hagas preguntas obvias ni de relleno.
- Ofrece 2-4 "suggestions" como respuestas rápidas cuando aplique (ej. pantallas, roles, opciones).
- Para NUEVA FUNCIONALIDAD, cubre: quién lo necesita (rol: dirección, docente o padre),
  qué quiere lograr y para qué (beneficio para la escuela o la familia), en qué
  pantalla/módulo, con qué datos/reglas (¿toca a un alumno, un grupo o toda la escuela?),
  casos límite, y cómo sabrá que quedó bien (criterios de aceptación). Define alcance
  (incluye / NO incluye).
- Para INCIDENCIA, cubre: pasos exactos para reproducir, qué esperaba vs qué pasó, en qué
  pantalla/módulo, desde cuándo, a cuántos afecta (un alumno, un grupo, toda la escuela),
  si hay mensaje de error o folio, y severidad/impacto en la operación diaria de la escuela.
- Cierra la entrevista (done=true) en cuanto tengas lo suficiente para un brief accionable,
  sin exceder ${MAX_QUESTIONS} preguntas. Antes de eso, done=false con la siguiente pregunta.
- Al cerrar, entrega el brief completo y bien redactado (title, summary, criterios, etc.).
  Redacta user_story como "Como <rol>, quiero <capacidad>, para <beneficio>".
  Deja en open_questions lo que quede pendiente de validar con la escuela.`;
}

function conversationBlock(subject, description, history) {
  const lines = [
    `Asunto: ${sanitize(subject)}`,
    `Descripción inicial del solicitante: ${sanitize(description)}`,
    '',
    'Entrevista hasta ahora:',
  ];
  if (!history.length) lines.push('(aún no has hecho preguntas)');
  for (const turn of history) {
    lines.push(`P (tú): ${sanitize(turn.question)}`);
    lines.push(`R (solicitante): ${sanitize(turn.answer)}`);
  }
  return lines.join('\n');
}

/**
 * @typedef {Object} IntakeQuestion
 * @property {string} text
 * @property {string} [hint]
 * @property {string[]} [suggestions]
 */
/**
 * @typedef {Object} IntakeBrief
 * @property {'feature'|'bug'} [kind]
 * @property {string} [title]
 * @property {string} [summary]
 * @property {string} [affected_area]
 * @property {string} [user_story]
 * @property {string[]} [acceptance_criteria]
 * @property {string[]} [scope_in]
 * @property {string[]} [scope_out]
 * @property {string[]} [repro_steps]
 * @property {string} [expected_behavior]
 * @property {string} [actual_behavior]
 * @property {string} [severity]
 * @property {string} [impact]
 * @property {string} [priority_suggestion]
 * @property {string[]} [open_questions]
 */
/**
 * @typedef {Object} IntakeTurnResult
 * @property {boolean} done
 * @property {IntakeQuestion} [question]
 * @property {IntakeBrief} [brief]
 */

/**
 * Ejecuta un turno de la entrevista. Devuelve el objeto validado por TURN_SCHEMA:
 *   { done:false, question:{text,hint,suggestions} }  ó  { done:true, brief:{…} }.
 *
 * @param {'feature'|'bug'} kind
 * @param {{subject?:string, description?:string, history?:Array<{question:string,answer:string}>}} [ctx]
 * @returns {Promise<IntakeTurnResult>}
 */
export async function intakeTurn(kind, { subject = '', description = '', history = [] } = {}) {
  const forceClose = history.length >= MAX_QUESTIONS;
  const prompt = `${systemPreamble(kind)}

${conversationBlock(subject, description, history)}

${forceClose
    ? 'Ya alcanzaste el máximo de preguntas: cierra ahora (done=true) y entrega el brief con lo que tengas.'
    : 'Decide: ¿te falta información clave? Si sí, done=false y formula la SIGUIENTE pregunta. Si ya es suficiente, done=true y entrega el brief.'}

Responde SOLO el JSON del esquema.`;

  const out = /** @type {IntakeTurnResult} */ (await base44.integrations.Core.InvokeLLM({
    prompt,
    add_context_from_internet: false,
    response_json_schema: TURN_SCHEMA,
  })) || /** @type {IntakeTurnResult} */ ({ done: false });
  // Salvaguarda: si el modelo se pasa del límite sin cerrar, forzamos cierre en
  // el siguiente turno vía forceClose; aquí normalizamos la forma.
  if (out.done && out.brief) {
    out.brief.kind = out.brief.kind || kind;
    return out;
  }
  if (out.question && out.question.text) {
    return { done: false, question: out.question };
  }
  // Respuesta degenerada → cerramos con un brief mínimo desde lo capturado.
  return {
    done: true,
    brief: {
      kind,
      title: sanitize(subject) || 'Solicitud de soporte',
      summary: sanitize(description),
      open_questions: ['La IA no pudo estructurar el caso; revisar con el solicitante.'],
    },
  };
}

const bullets = (arr) => (Array.isArray(arr) && arr.length ? arr.map((x) => `- ${x}`).join('\n') : null);

/**
 * Convierte el brief estructurado a Markdown legible para quien atienda.
 * Este texto se incrusta en el cuerpo del ticket para que llegue a todos lados.
 *
 * @param {IntakeBrief} [brief]
 * @returns {string}
 */
export function briefToMarkdown(brief = {}) {
  const isBug = brief.kind === 'bug';
  const S = [];
  S.push(`## Brief ${isBug ? '· Incidencia' : '· Nueva funcionalidad'} (generado por IA BA/PO)`);
  if (brief.title) S.push(`**${brief.title}**`);
  if (brief.summary) S.push(brief.summary);
  if (brief.affected_area) S.push(`**Área / pantalla:** ${brief.affected_area}`);

  if (!isBug) {
    if (brief.user_story) S.push(`**Historia de usuario**\n${brief.user_story}`);
    const ac = bullets(brief.acceptance_criteria);
    if (ac) S.push(`**Criterios de aceptación**\n${ac}`);
    const si = bullets(brief.scope_in);
    if (si) S.push(`**Incluye (alcance)**\n${si}`);
    const so = bullets(brief.scope_out);
    if (so) S.push(`**NO incluye**\n${so}`);
  } else {
    const rs = bullets(brief.repro_steps);
    if (rs) S.push(`**Pasos para reproducir**\n${rs}`);
    if (brief.expected_behavior) S.push(`**Comportamiento esperado**\n${brief.expected_behavior}`);
    if (brief.actual_behavior) S.push(`**Comportamiento actual**\n${brief.actual_behavior}`);
    if (brief.severity) S.push(`**Severidad:** ${brief.severity}`);
  }

  if (brief.impact) S.push(`**Impacto:** ${brief.impact}`);
  if (brief.priority_suggestion) S.push(`**Prioridad sugerida:** ${brief.priority_suggestion}`);
  const oq = bullets(brief.open_questions);
  if (oq) S.push(`**Preguntas abiertas para la escuela**\n${oq}`);

  return S.join('\n\n');
}

/**
 * Cuerpo final del ticket = descripción original + el brief en Markdown.
 * Garantiza que quien atienda vea la especificación completa aunque el campo
 * estructurado `ai_brief` no esté desplegado en el backend.
 *
 * @param {string} originalDescription
 * @param {IntakeBrief} brief
 * @returns {string}
 */
export function composeTicketBody(originalDescription, brief) {
  const orig = sanitize(originalDescription);
  const md = briefToMarkdown(brief);
  return `${orig}\n\n---\n\n${md}`.trim();
}
