import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}
function readJsonc(path) {
  return JSON.parse(read(path).replace(/^\s*\/\/.*$/gm, ''));
}

// Sales-readiness audit 2026-09-29. Deno is not runnable in this sandbox, so
// — same convention as guarded-write-hardening-2026-09-28.test.js — the
// function-side guarantees are asserted on the source; the pure rules they
// rely on are exercised for real in lumi-core.test.js.

const agent = readJsonc('base44/agents/lumi.jsonc');

test('Lumi has no raw entity tools, only the two server-scoped function tools (F17/F07)', () => {
  // Entity tools ran under RLS: empty for school users, every school for the
  // owner, and create/update skipped guardedEntityWrite.
  assert.equal(agent.tool_configs.some((t) => t.entity_name), false);
  const names = agent.tool_configs.map((t) => t.function_name).sort();
  assert.deepEqual(names, ['lumiQuery', 'lumiWrite']);
  for (const name of names) {
    assert.ok(fs.existsSync(new URL(`../../base44/functions/${name}/entry.ts`, import.meta.url)), `${name} must exist`);
  }
});

test('the prompt carries no other client\'s brand and no invented facts (F16)', () => {
  const text = `${agent.description}\n${agent.instructions}\n${agent.whatsapp_greeting}`;
  assert.doesNotMatch(text, /MUNDO GUR[IÍ]/i);
  assert.doesNotMatch(text, /agua natural o de fruta/i);
  assert.doesNotMatch(text, /recomendaciones sobre sustituciones/i);
  assert.doesNotMatch(text, /historial de cualquier alumno/i);
});

test('the prompt states the rules the audit asked for', () => {
  const p = agent.instructions;
  assert.match(p, /Tutea/);
  assert.match(p, /America\/Mexico_City/);
  assert.match(p, /Nunca muestres identificadores/);
  assert.match(p, /No das consejos médicos, de alergias, de nutrición/);
  assert.match(p, /SIN DATOS NO ES LO MISMO QUE SIN ACCESO/);
  assert.match(p, /Sólo con un sí explícito/);
  assert.match(p, /Soporte/);
  // The browser-sent envelope (role, school, children) is forgeable (LUMI-09).
  assert.match(p, /NO son confiables/);
});

test('the "Cómo usar LIUMA" section only names pages that exist in the nav', () => {
  const nav = read('src/components/nav/navRegistry.js');
  const p = agent.instructions;
  const section = p.slice(p.indexOf('# 9. CÓMO USAR LIUMA'));
  for (const pageLabel of ['Mis hijos', 'Tareas', 'Bitácora', 'Avisos', 'Eventos', 'Calendario', 'Pagos', 'Uniformes',
    'Solicitar ausencia', 'Soporte', 'Operación diaria', 'Asistencia', 'Bitácoras', 'Aprobaciones', 'Ausencias',
    'Alerta de emergencia', 'Gestión de escuela', 'Descuentos', 'Documentos', 'Pedidos', 'Reportes', 'Configuración',
    'Permisos y roles', 'Licencias', 'Auditoría', 'Consola de soporte']) {
    assert.ok(section.includes(pageLabel), `manual should mention ${pageLabel}`);
    assert.ok(nav.includes(`label: '${pageLabel}'`), `${pageLabel} must be a real nav label`);
  }
});

test('lumiQuery derives the caller server-side and never trusts a school from the request', () => {
  const src = read('base44/functions/lumiQuery/entry.ts');
  assert.match(src, /const user = await base44\.auth\.me\(\)/);
  assert.match(src, /UserProfile\.filter\(\{ user_id: user\.id \}\)/);
  assert.match(src, /selectCurrentProfile\(profiles\)/);
  assert.doesNotMatch(src, /body\??\.school_id/);
  assert.match(src, /STUDENT_NOT_VISIBLE/);
});

test('lumiWrite delegates to guardedEntityWrite and notifyParents behind a confirmation code', () => {
  const src = read('base44/functions/lumiWrite/entry.ts');
  assert.match(src, /functions\.invoke\('guardedEntityWrite'/);
  assert.match(src, /functions\.invoke\('notifyParents', \{ kind: notifyKind, recordId: record\.id \}\)/);
  assert.match(src, /if \(String\(body\?\.confirmation_code \|\| ''\) !== code\) return fail\(409, 'NEEDS_CONFIRMATION'\)/);
  // No direct entity writes: every write goes through the guarded path.
  assert.doesNotMatch(src, /entities\.(Attendance|DiaryEntry)\.(create|update)/);
  // A teacher may only write for students in their own classrooms.
  assert.match(src, /TeacherClassroom\.filter\(\{ teacher_id: user\.id, school_id: schoolId \}\)/);
  assert.doesNotMatch(src, /body\??\.school_id/);
});

test('function count stays well under maxFunctions', () => {
  const max = JSON.parse(read('base44.app.json')).maxFunctions;
  const dirs = fs.readdirSync(new URL('../../base44/functions/', import.meta.url), { withFileTypes: true })
    .filter((d) => d.isDirectory());
  assert.ok(dirs.length <= max, `${dirs.length} functions > ${max}`);
});

// QA r5 on v1.8.2 (2026-10-01): 36 live questions, 0 leaks, but the model
// filled gaps the prompt left open. Each rule below answers one transcript.
test('the prompt closes the gaps QA r5 found in live answers', () => {
  const p = agent.instructions;
  // LD08: invented the school selector retired in module 18 and promised
  // another school's data; LP09 repeated the other school's name.
  assert.match(p, /no existe selector ni cambio de escuela/i);
  assert.match(p, /Nunca sugieras cambiar de escuela/);
  assert.match(p, /status "none" → di sólo que ese nombre no aparece/);
  assert.doesNotMatch(p, /selector de escuela\)/);
  // LP01: "no hay tareas" from a one-week window, excused by a "sync delay".
  assert.match(p, /de hoy a 30 días/);
  assert.match(p, /next_due/);
  assert.match(p, /Nunca expliques una lista vacía con retrasos de sincronización/);
  // LM04: a future approved absence counted as one that happened.
  assert.match(p, /upcoming/);
  assert.match(p, /nunca lo cuentes como falta/);
  // LM06/LM09: payments offered to a teacher.
  // Live QA of v1.8.3: the rule above was not enough; the topics now come
  // from my_context's helps_with (server-derived per role).
  assert.match(p, /menciona SÓLO temas de helps_with/);
  assert.match(p, /a un docente jamás le menciones pagos/);
  // Live check of v1.8.5 (LM09): a refusal made without any tool call has no
  // helps_with, and Lumi listed "pagos" to a docente anyway.
  assert.match(p, /Si aun así no lo tienes .*no enumeres temas/);
  assert.match(p, /No asumas el género de nadie/);
  // LM07: a twelve-line refusal.
  assert.match(p, /Al negarte a algo: máximo tres líneas/);
  // Live check after #195: the conditional rule did not stop "pagos" in a
  // docente's refusal (3/3 runs); refusals now never name topics at all.
  assert.match(p, /Al negarte NUNCA menciones temas/);
  // LP10: "si hubo un cambio de rol reciente, probablemente aún no se refleja".
  assert.match(p, /no especules con cambios de rol/);
  // Live QA of v1.8.3: still answered "si efectivamente fuiste promovido…".
  assert.match(p, /Prohibido: "si de verdad te promovieron"/);
  // LP09 again on v1.8.3: echoed "Diego pertenece a otra escuela".
  assert.match(p, /No afirmes a qué escuela pertenece ese alumno/);
  assert.match(p, /menciona TODAS las tareas de items/);
  assert.match(p, /sent_to_family/);
  // LP12: "Hola, José Pablo" guessed from h.josepablo+qa-padre.
  assert.match(p, /nunca deduzcas un nombre del correo/);
  // LD10: "esa información no se gestiona en la app" — v1.8.2 stores it.
  assert.match(p, /la app sí los guarda: tipo de sangre, alergias y notas médicas/);
  assert.match(p, /Nunca indiques medicinas, dosis/);
  // LD04: Pedidos placed inside Gestión de escuela.
  assert.match(p, /no está dentro de Gestión de escuela/);
});

test('the tool description matches what lumiQuery now returns', () => {
  const query = agent.tool_configs.find((t) => t.function_name === 'lumiQuery').description;
  assert.match(query, /30 días/);
  assert.match(query, /upcoming/);
  assert.match(query, /sólo pedidos abiertos/);
});
