// aiAssist — server-authoritative InvokeLLM calls for the two client-side AI
// features that used to call base44.integrations.Core.InvokeLLM directly from
// the browser: CrearBitacora.jsx's "Generar con Lumi" diary draft, and the
// support-ticket AI BA/PO intake (src/lib/support/aiIntake.js /
// AiIntakeChat.jsx).
//
// WHY THIS EXISTS (Base44 security scan, "Evitar el uso no autorizado de
// créditos", High). InvokeLLM is a credit-consuming integration. Both call
// sites used to build their prompt in the browser and hand it straight to
// InvokeLLM — a token holder could submit an arbitrary prompt (unrelated to
// any real student or ticket) and burn credits freely. Here the client sends
// only an id (`studentId`) or a bounded set of free-text fields, and the
// prompt is always assembled server-side from data this function itself
// reads (or from sanitized, length-capped copies of the client's fields for
// the intake, mirroring what aiIntake.js already did client-side) — never
// from a client-supplied prompt string.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';

const MAX_QUESTIONS = 6; // mirrors src/lib/support/aiIntake.js's MAX_QUESTIONS

// Mirrors src/lib/support/aiIntake.js's APP_CONTEXT — duplicated, not
// imported: Deno functions can't import across function directories (same
// constraint documented on guardedEntityWrite/entry.ts), and aiIntake.js
// can't import server-side modules at all (it runs in the browser). Keep the
// two in sync by hand if either changes.
const APP_CONTEXT = {
  name: 'LIUMA',
  domain:
    'SaaS escolar multi-tenant: cada escuela (tenant) administra su comunidad ' +
    'de alumnos, docentes y padres/tutores. La app cubre operación diaria, ' +
    'asistencia, tareas, bitácoras/diarios del alumno, avisos, eventos, ' +
    'calendario escolar, pagos y cargos, descuentos, documentos oficiales, ' +
    'pedidos de uniformes y solicitudes de ausencia. Los roles son dirección ' +
    '(ADMIN), docente (TEACHER) y padre/madre/tutor (PARENT).',
  modules: [
    'Operación diaria', 'Asistencia', 'Tareas', 'Bitácoras / Diario del alumno',
    'Avisos', 'Eventos', 'Calendario escolar', 'Pagos y cargos', 'Descuentos',
    'Documentos oficiales', 'Uniformes / Pedidos', 'Ausencias', 'Mis hijos',
    'Gestión de escuela', 'Reportes', 'Permisos y roles', 'Licencias', 'Soporte',
  ],
};

const KIND_LABEL: Record<string, string> = { feature: 'nueva funcionalidad / mejora', bug: 'reporte de incidencia' };

const TURN_SCHEMA = {
  type: 'object',
  properties: {
    done: { type: 'boolean' },
    question: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        hint: { type: 'string' },
        suggestions: { type: 'array', items: { type: 'string' } },
      },
    },
    brief: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['feature', 'bug'] },
        title: { type: 'string' },
        summary: { type: 'string' },
        affected_area: { type: 'string' },
        user_story: { type: 'string' },
        acceptance_criteria: { type: 'array', items: { type: 'string' } },
        scope_in: { type: 'array', items: { type: 'string' } },
        scope_out: { type: 'array', items: { type: 'string' } },
        repro_steps: { type: 'array', items: { type: 'string' } },
        expected_behavior: { type: 'string' },
        actual_behavior: { type: 'string' },
        severity: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] },
        impact: { type: 'string' },
        priority_suggestion: { type: 'string', enum: ['low', 'normal', 'high'] },
        open_questions: { type: 'array', items: { type: 'string' } },
      },
      required: ['kind', 'title', 'summary'],
    },
  },
  required: ['done'],
};

// Neutralizes prompt-injection attempts in free text before it's embedded in
// the prompt. Mirrors aiIntake.js's `sanitize` exactly.
function sanitize(text = ''): string {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\p{P}\p{Z}\p{S}\n]/gu, '')
    .trim()
    .slice(0, 4000);
}

function systemPreamble(kind: string): string {
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

function conversationBlock(subject: string, description: string, history: Array<{ question?: string; answer?: string }>): string {
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

function bad(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, code, error: message }, { status });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return bad(401, 'UNAUTHENTICATED', 'Unauthorized');

    const body = await req.json().catch(() => ({}));
    const task = String(body?.task || '');
    const sr = base44.asServiceRole;
    const isPlatformOwner = user.role === 'admin';

    if (task === 'diary_draft') {
      const studentId = String(body?.studentId || '');
      if (!studentId) return bad(400, 'MISSING_STUDENT', 'studentId is required');

      const student = await sr.entities.Student.get(studentId).catch(() => null);
      if (!student) return bad(404, 'NOT_FOUND', 'Student not found');

      if (!isPlatformOwner) {
        const profiles: Array<{ status?: string; app_role?: string }> = await sr.entities.UserProfile.filter({
          user_id: user.id,
          school_id: student.school_id,
        });
        const profile = profiles.find((p) => p.status === 'ACTIVE' && ['TEACHER', 'ADMIN'].includes(String(p.app_role)));
        if (!profile) return bad(403, 'NO_PROFILE', 'Requires an active TEACHER or ADMIN profile in this school');
      }

      const prompt = `Genera una nota de bitácora escolar en español para un alumno llamado ${student.first_name}.
        La nota debe ser positiva, breve (2-3 oraciones) y mencionar actividades típicas del día escolar.
        Solo devuelve el texto de la nota, sin comillas ni formato adicional.`;

      const text = await sr.integrations.Core.InvokeLLM({ prompt });
      return Response.json({ ok: true, text });
    }

    if (task === 'support_intake') {
      // Any registered user with at least one ACTIVE profile (in any school)
      // may use the intake — it's not school-scoped, it's a support/feature
      // request about the app itself. Platform owner bypasses, as usual.
      if (!isPlatformOwner) {
        const profiles: Array<{ status?: string }> = await sr.entities.UserProfile.filter({ user_id: user.id, status: 'ACTIVE' });
        if (!profiles.length) return bad(403, 'NO_PROFILE', 'Requires at least one active profile');
      }

      const kind = String(body?.kind || '');
      if (kind !== 'feature' && kind !== 'bug') return bad(400, 'BAD_KIND', 'kind must be feature or bug');

      const subject = String(body?.subject || '');
      const description = String(body?.description || '');
      const historyRaw = Array.isArray(body?.history) ? body.history : null;
      if (!historyRaw) return bad(400, 'BAD_HISTORY', 'history must be an array');
      if (historyRaw.length > MAX_QUESTIONS) return bad(400, 'BAD_HISTORY', `history may not exceed ${MAX_QUESTIONS} turns`);

      const history = historyRaw.map((turn: { question?: unknown; answer?: unknown } | null) => ({
        question: String(turn?.question || ''),
        answer: String(turn?.answer || ''),
      }));

      const forceClose = history.length >= MAX_QUESTIONS;
      const prompt = `${systemPreamble(kind)}

${conversationBlock(subject, description, history)}

${forceClose
    ? 'Ya alcanzaste el máximo de preguntas: cierra ahora (done=true) y entrega el brief con lo que tengas.'
    : 'Decide: ¿te falta información clave? Si sí, done=false y formula la SIGUIENTE pregunta. Si ya es suficiente, done=true y entrega el brief.'}

Responde SOLO el JSON del esquema.`;

      const out = await sr.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: false,
        response_json_schema: TURN_SCHEMA,
      });

      return Response.json(out ?? { done: false });
    }

    return bad(400, 'BAD_TASK', 'Unknown task');
  } catch (e) {
    return Response.json({ ok: false, code: 'INTERNAL', error: (e as Error).message }, { status: 500 });
  }
});
