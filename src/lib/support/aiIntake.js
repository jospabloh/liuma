/**
 * aiIntake — el "BA + PO experto" que entrevista al solicitante ANTES de crear
 * un ticket, para que quien atienda (dirección de la escuela o el equipo LIUMA)
 * reciba una especificación lista para diseñar e implementar (no un "no funciona"
 * sin contexto).
 *
 * Portable entre apps del portafolio ACACIA: lo único específico de la app es
 * `APP_CONTEXT` (nombre + dominio + módulos). El motor es el LLM de Base44,
 * pero ya NO se invoca desde el navegador: `intakeTurn` llama a la Safe
 * function `aiAssist` (`base44/functions/aiAssist/entry.ts`), que arma el
 * prompt server-side y hace el `InvokeLLM` con el rol de servicio. Ver el
 * comentario de cabecera de esa función — mover esto detrás de un backend fue
 * el arreglo al hallazgo "Evitar el uso no autorizado de créditos" del scan
 * de seguridad de Base44 (InvokeLLM es una integración que consume créditos;
 * llamarla directo desde el cliente con un prompt armado en el navegador
 * dejaba a cualquier token quemar créditos con lo que quisiera). `APP_CONTEXT`,
 * `KIND_LABEL`, `TURN_SCHEMA`, `systemPreamble`/`conversationBlock` y la
 * lógica de `forceClose` viven ahora (duplicados, no importados — Deno no
 * puede importar entre funciones) en `entry.ts`; lo que queda aquí es sólo
 * `APP_CONTEXT`/`MAX_QUESTIONS`/`briefToMarkdown` (siguen exportados porque
 * `AiIntakeChat.jsx`/`NewTicketDialog.jsx` los usan) y una copia de
 * `sanitize` para el fallback degenerado si el turno falla.
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
import { invokeFunction } from '@/lib/functionResponse';

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
 * Ejecuta un turno de la entrevista llamando a la Safe function `aiAssist`
 * (task: 'support_intake'), que arma el prompt y hace el InvokeLLM
 * server-side. Devuelve el objeto validado por el TURN_SCHEMA de esa función:
 *   { done:false, question:{text,hint,suggestions} }  ó  { done:true, brief:{…} }.
 *
 * Si la llamada falla (red, la función rechaza por autorización, etc.) el
 * error se propaga tal cual — AiIntakeChat.jsx ya lo captura y muestra
 * "La IA no está disponible en este momento…" con salida a "Crear sin
 * asistente". El fallback de abajo es para una respuesta que SÍ llegó pero
 * vino degenerada (sin done/question/brief utilizable), no para un error.
 *
 * @param {'feature'|'bug'} kind
 * @param {{subject?:string, description?:string, history?:Array<{question:string,answer:string}>}} [ctx]
 * @returns {Promise<IntakeTurnResult>}
 */
export async function intakeTurn(kind, { subject = '', description = '', history = [] } = {}) {
  const out = /** @type {IntakeTurnResult} */ (await invokeFunction(base44, 'aiAssist', {
    task: 'support_intake',
    kind,
    subject,
    description,
    history,
  })) || /** @type {IntakeTurnResult} */ ({ done: false });
  // Salvaguarda: si el modelo se pasa del límite sin cerrar, o la respuesta
  // llega en una forma inesperada, normalizamos aquí.
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
