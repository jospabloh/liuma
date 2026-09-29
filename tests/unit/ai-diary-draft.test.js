import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// Sales-readiness audit 2026-09-29, F31 (LUMI-10) and F30 (aiAssist half).
// Deno is not runnable here, so the function side is asserted on its source.

test('aiAssist diary_draft writes from the teacher\'s own input and is told not to invent', () => {
  const src = read('base44/functions/aiAssist/entry.ts');
  // The old prompt asked for "actividades típicas" about a real, named child:
  // parents received activities their child never did.
  assert.doesNotMatch(src, /mencionar actividades típicas/);
  assert.match(src, /NO inventes actividades/);
  assert.match(src, /const draft = sanitize\(body\?\.draft\);/);
  assert.match(src, /const facts = diaryFacts\(body\?\.fields\);/);
  // Nothing to go on -> no LLM call at all.
  assert.match(src, /if \(!draft && facts\.length === 0\) \{\s*return bad\(400, 'EMPTY_INPUT'/);
});

test('both aiAssist tasks are capped per user per day before spending credits', () => {
  const src = read('base44/functions/aiAssist/entry.ts');
  assert.match(src, /const DAILY_LIMITS: Record<string, number> = \{/);
  assert.match(src, /overDailyLimit\(sr, user, 'diary_draft'/);
  assert.match(src, /overDailyLimit\(sr, user, 'support_intake'/);
  assert.match(src, /bad\(429, 'DAILY_LIMIT'/);
  // The check runs before InvokeLLM in each branch.
  for (const task of ['diary_draft', 'support_intake']) {
    const branch = src.slice(src.indexOf(`if (task === '${task}')`));
    assert.ok(branch.indexOf('overDailyLimit(') < branch.indexOf('InvokeLLM('), `${task}: limit must precede InvokeLLM`);
  }
});

test('the daily counter lives in AuditLog under an action the schema accepts', () => {
  const schema = JSON.parse(read('base44/entities/AuditLog.jsonc').replace(/^\s*\/\/.*$/gm, ''));
  assert.ok(schema.properties.action.enum.includes('AI_REQUEST_ALLOWED'));
  const src = read('base44/functions/aiAssist/entry.ts');
  assert.match(src, /action: 'AI_REQUEST_ALLOWED',\s*target_type: `aiAssist:\$\{task\}`/);
});

test('CrearBitacora offers Lumi\'s text as a suggestion with undo, never overwriting the draft', () => {
  const src = read('src/pages/CrearBitacora.jsx');
  // The old code replaced whatever the teacher had typed.
  assert.doesNotMatch(src, /notes_text: response\?\.text/);
  assert.match(src, /draft: formData\.notes_text,/);
  assert.match(src, /setSuggestion\(text\)/);
  assert.match(src, /Usar esta versión/);
  assert.match(src, /Agregar al final/);
  assert.match(src, /Deshacer el cambio de Lumi/);
});

test('CrearBitacora stores and shows the local school day, and themes its chips for dark mode', () => {
  const src = read('src/pages/CrearBitacora.jsx');
  assert.match(src, /const today = formatLocalDate\(new Date\(\)\);/);
  assert.doesNotMatch(src, /format\(new Date\(\), "d 'de' MMMM/);
  for (const light of ['from-pink-50', 'bg-amber-50', 'text-amber-600']) {
    const line = src.split('\n').find((l) => l.includes(light));
    assert.match(line, /dark:/, `${light} needs a dark: variant`);
  }
});

test('Soporte no longer promises a "manual" Lumi does not have', () => {
  const src = read('src/pages/Soporte.jsx');
  assert.doesNotMatch(src, /con el manual de la app/);
});
