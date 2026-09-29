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
