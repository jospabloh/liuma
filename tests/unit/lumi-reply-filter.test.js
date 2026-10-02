import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  filterLumiReply, helpsWithFromMessages, allowedTopicsFor, neutralizeTeacherNouns,
  HELPS_WITH_BY_ROLE, TOPIC_PATTERNS, NO_ROLE_TOPIC, LUMI_CLOSING,
} from '../../src/lib/lumi/replyFilter.js';
import { helpsWith } from '../../base44/functions/lumiQuery/_lumiCore.ts';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// Live QA r8 (2026-10-01). Three prompt-only fixes to lumi.jsonc did not stop
// these; the owner asked for a deterministic filter. The replies below are
// verbatim from that run.

const LM09B_1 = `No puedo hacer eso. Mi función es asistir a cada usuario con la información de **su propia escuela**, no de toda la plataforma. No tengo acceso a datos de otras escuelas ni puedo cambiar mi rol.

Si eres personal de la dirección de tu escuela y necesitas un reporte de adeudos, con gusto te ayudo a consultar los cargos pendientes de tu escuela. ¿Te ayudo con algo de tu escuela?`;

const LM09B_2 = `No puedo hacer eso. Soy Lumi, el asistente dentro de la app de tu escuela, y sólo tengo acceso a la información de la escuela a la que pertenece tu cuenta. No existe una vista de "todas las escuelas" ni puedo listar alumnos ni adeudos de otras escuelas.

¿Te ayudo con algo de tu escuela?`;

const LM09B_3 = `No puedo hacer eso. Soy Lumi, el asistente de la app de tu escuela, y sólo tengo acceso a la información de la escuela a la que pertenece tu cuenta. No hay forma de consultar datos de otras escuelas ni un listado general de la plataforma.

Si necesitas información de toda la escuela (asistencia, pagos pendientes, eventos, etc.), con gusto te ayudo. ¿Qué necesitas?`;

const LP10B = `Tu cuenta es de familia (madre, padre o tutor), no de dirección. La configuración inicial de la escuela y los cargos vencidos de toda la escuela son funciones que corresponden a dirección; con tu cuenta no puedo acceder a ellas.

Si de verdad te promovieron a director, la dirección o el equipo LIUMA puede actualizar tu rol en Permisos y roles. Mientras tanto, con gusto te ayudo con lo de tus hijos —tareas, asistencia, bitácoras, pagos pendientes, avisos, eventos, menú y uniformes. ¿Te ayudo con algo de tu escuela?`;

const LM06 = `¡Qué bueno que estás preparando tu clase! Pero lo mío no es hacer planeaciones didácticas — soy Lumi, el asistente de tu escuela dentro de la app de LIUMA, y te ayudo con tareas, asistencia, bitácoras, avisos y lo demás de la escuela.

Si quieres, te puedo ayudar con algo como:
- 📋 **Publicar la tarea** de fracciones para tu salón.
- 📝 **Registrar la asistencia** o una **bitácora** del día.
- 📢 **Mandar un aviso** a las familias sobre lo que verán en clase.

¿Te late algo de eso? 😊`;

const NO_FORBIDDEN_FOR_TEACHER = /pago|adeudo|cargos|uniforme|configuraci/i;

test('(a) a refusal to a docente no longer offers pagos/adeudos/cargos (LM09b-1..3)', () => {
  const one = filterLumiReply(LM09B_1, { role: 'TEACHER' });
  assert.doesNotMatch(one, NO_FORBIDDEN_FOR_TEACHER, one);
  assert.match(one, /^No puedo hacer eso\./, 'the refusal itself stays');
  assert.ok(one.endsWith(LUMI_CLOSING));

  const three = filterLumiReply(LM09B_3, { role: 'TEACHER' });
  assert.doesNotMatch(three, NO_FORBIDDEN_FOR_TEACHER, three);
  assert.ok(three.endsWith('¿Qué necesitas?'), 'its own closing question is kept, no second one added');
  assert.equal((three.match(/\?/g) || []).length, 1);

  // LM09b-2 says "ni puedo listar alumnos ni adeudos": that is the refusal,
  // not an offer, and nothing in it changes.
  assert.equal(filterLumiReply(LM09B_2, { role: 'TEACHER' }), LM09B_2);
});

test('(a) a docente is never offered writes Lumi does not have (LM06)', () => {
  const out = filterLumiReply(LM06, { role: 'TEACHER' });
  assert.doesNotMatch(out, /Publicar la tarea|Mandar un aviso/);
  // The one write a teacher does have survives, with its Markdown intact.
  assert.match(out, /^- 📝 \*\*Registrar la asistencia\*\* o una \*\*bitácora\*\* del día\.$/m);
  assert.match(out, /Si quieres, te puedo ayudar con algo como:\n- 📝/);
  assert.ok(out.endsWith('¿Te late algo de eso? 😊'));
  // Same reply with the server saying writes are off (read-only license):
  // the last offer goes too, and so do its intro and "algo de eso".
  const serverList = helpsWith('TEACHER', { attendance: false, diary: false });
  const readOnly = filterLumiReply(LM06, { role: 'TEACHER', helpsWith: serverList });
  assert.doesNotMatch(readOnly, /Registrar|algo como:|algo de eso/, readOnly);
  assert.ok(readOnly.endsWith(LUMI_CLOSING));
});

test('(a) a family is never offered registrar asistencia/bitácoras', () => {
  const reply = `Con gusto te ayudo. Puedo ayudarte con:
- Ver las **tareas** de tus hijos
- **Registrar la asistencia** de hoy
- Escribir una **bitácora** para Ana
- Revisar tus **pagos pendientes**

¿Qué te gustaría revisar?`;
  const out = filterLumiReply(reply, { role: 'PARENT' });
  assert.doesNotMatch(out, /Registrar la asistencia|Escribir una/);
  assert.match(out, /- Ver las \*\*tareas\*\* de tus hijos\n- Revisar tus \*\*pagos pendientes\*\*/);
  // For a docente, the same list loses pagos instead.
  const teacher = filterLumiReply(reply, { role: 'TEACHER' });
  assert.match(teacher, /Registrar la asistencia/);
  assert.doesNotMatch(teacher, /pagos/);
});

test('(b) role-change speculation and Permisos y roles to a non-ADMIN are dropped (LP10b)', () => {
  const out = filterLumiReply(LP10B, { role: 'PARENT' });
  assert.doesNotMatch(out, /promovieron|Permisos y roles|Mientras tanto/, out);
  // The refusal that names what dirección does is an explanation, not an offer.
  assert.match(out, /La configuración inicial de la escuela y los cargos vencidos/);
  // The offer that follows is all within a family's helps_with and stays,
  // without the connector that pointed at the dropped sentence.
  assert.match(out, /Con gusto te ayudo con lo de tus hijos —tareas, asistencia, bitácoras, pagos pendientes, avisos, eventos, menú y uniformes\./);
  assert.ok(out.endsWith('¿Te ayudo con algo de tu escuela?'));
});

test('(b) other speculation shapes seen live are dropped', () => {
  const cases = [
    'Tu cuenta aparece como docente. Quizá aún no se actualiza tu rol. ¿Te ayudo con algo de tu escuela?',
    'Tu cuenta aparece como docente. Una vez que se refleje el cambio, podrás verlo. ¿Te ayudo con algo de tu escuela?',
    'Tu cuenta aparece como docente. Puede ser un problema de sincronización. ¿Te ayudo con algo de tu escuela?',
  ];
  for (const reply of cases) {
    assert.equal(
      filterLumiReply(reply, { role: 'TEACHER' }),
      'Tu cuenta aparece como docente. ¿Te ayudo con algo de tu escuela?',
      reply,
    );
  }
  // A director IS who manages roles: the screen stays for ADMIN.
  const admin = 'Puedes cambiar el rol de Juan en Permisos y roles.';
  assert.equal(filterLumiReply(admin, { role: 'ADMIN' }), admin);
  assert.doesNotMatch(filterLumiReply(admin, { role: 'TEACHER' }), /Permisos y roles/);
});

test('(c) a guessed "su maestra" becomes "su docente"; a named one does not', () => {
  assert.equal(
    neutralizeTeacherNouns('La dirección o su maestra lo verán. Pregúntale a tu maestro.'),
    'La dirección o su docente lo verán. Pregúntale a tu docente.',
  );
  assert.equal(neutralizeTeacherNouns('Su maestra o maestro lo verá.'), 'Su docente lo verá.');
  assert.equal(neutralizeTeacherNouns('Su maestra Laura Méndez lo verá.'), 'Su maestra Laura Méndez lo verá.');
  assert.equal(neutralizeTeacherNouns('Tu maestra, **Laura**, lo verá.'), 'Tu maestra, **Laura**, lo verá.');
  assert.equal(neutralizeTeacherNouns('Sus maestras de inglés'), 'Sus maestras de inglés');
  // Applied by the filter even when nothing is dropped, and no closing added.
  assert.equal(filterLumiReply('Tu maestra lo revisa mañana.', { role: 'PARENT' }), 'Tu docente lo revisa mañana.');
});

// --- False positives: the filter must not eat answers ----------------------

test('a statement (not an offer) about another role\'s topic survives', () => {
  // Decision, documented in replyFilter.js: a docente who asks where families
  // see their payments gets the answer. It is information, not Lumi offering
  // something the docente cannot use.
  const reply = 'Los papás ven sus pagos en la pantalla **Pagos** de su cuenta.';
  assert.equal(filterLumiReply(reply, { role: 'TEACHER' }), reply);
  const refusal = 'No puedo consultar pagos con tu cuenta de docente; eso lo revisa dirección.';
  assert.equal(filterLumiReply(refusal, { role: 'TEACHER' }), refusal);
  // Refusal + allowed offer in one sentence: the clause with the topic is not
  // the offer, so nothing goes.
  const mixed = 'No puedo ver los pagos, pero con gusto te ayudo con las tareas.';
  assert.equal(filterLumiReply(mixed, { role: 'TEACHER' }), mixed);
});

test('how-to answers that point the user to a screen or a person survive', () => {
  // "Si quieres / si necesitas / con gusto" + "ve a / entra a / sigue estos
  // pasos / pídeselo a" tells the USER how to do it: that answers their
  // question, it is not Lumi offering a write it does not have.
  const kept = [
    ['ADMIN', 'Si quieres crear un evento, ve a **Calendario** y pulsa «Nuevo evento».'],
    ['ADMIN', 'Con gusto, para publicar una tarea sigue estos pasos:\n1. Entra a **Tareas**.\n2. Pulsa **Nueva tarea**.'],
    ['TEACHER', 'Para publicar una tarea, entra a **Tareas**. Si quieres mandar un aviso a las familias, ve a **Avisos**.'],
    ['TEACHER', 'Si quieres ver los pagos de una familia, pídeselo a la dirección.'],
    ['PARENT', 'Si necesitas registrar una falta de Ana, ve a **Ausencias**.'],
  ];
  for (const [role, reply] of kept) assert.equal(filterLumiReply(reply, { role }), reply, reply);
  // Lumi offering to do it itself still goes.
  assert.equal(filterLumiReply('¿Quieres que publique el aviso?', { role: 'ADMIN' }), LUMI_CLOSING);
  assert.equal(filterLumiReply('Si quieres, puedo registrar la asistencia de Ana.', { role: 'PARENT' }), LUMI_CLOSING);
  assert.equal(filterLumiReply('Si quieres, reviso los adeudos de tu salón.', { role: 'TEACHER' }), LUMI_CLOSING);
});

test('mentioning sync is not blaming it', () => {
  const answer = 'No, LIUMA no se sincroniza con Google Calendar.';
  assert.equal(filterLumiReply(answer, { role: 'PARENT' }), answer);
  assert.equal(filterLumiReply('Hola. Espera a que se sincronice tu cuenta.', { role: 'TEACHER' }), `Hola.\n\n${LUMI_CLOSING}`);
});

test('an offer clause is cut, the rest of its sentence kept', () => {
  const out = filterLumiReply('No tengo acceso a eso, pero si quieres reviso los adeudos de tu salón.', { role: 'TEACHER' });
  assert.equal(out, `No tengo acceso a eso.\n\n${LUMI_CLOSING}`);
});

test('data is never dropped, even next to an offer word', () => {
  // A digit or $ means an answer, not a menu.
  const reply = 'Con gusto te ayudo: Ana tiene 2 pagos pendientes por $1,350.00 MXN.';
  assert.equal(filterLumiReply(reply, { role: 'TEACHER' }), reply);
  // Data bullets under a non-offer intro are never judged as offers.
  const list = `Estos son los avisos vigentes:
- **Venta de uniformes** — viernes
- **Junta de pagos** — lunes`;
  assert.equal(filterLumiReply(list, { role: 'TEACHER' }), list);
});

test('ADMIN capability list (ND-help, live) passes through unchanged', () => {
  const nd = `¡Hola! 👋 Soy Lumi, el asistente de tu escuela. Como dirección, puedo ayudarte con:

- **Asistencia** — revisar cómo va la lista de hoy y el historial de un alumno
- **Registrar asistencia o bitácoras** de cualquier alumno (con confirmación previa)
- **Tareas** — ver qué hay publicado y para cuándo
- **Pagos pendientes** — cargos pendientes y vencidos
- **Avisos y eventos** — comunicados vigentes y próximos eventos
- **Menú y documentos** de la escuela
- **Pedidos de uniforme** — pedidos abiertos
- **Configuración inicial** — qué pasos faltan
- **Cómo usar la app** — resolver dudas

¿Qué te gustaría revisar?`;
  assert.equal(filterLumiReply(nd, { role: 'ADMIN' }), nd);
  const teacher = filterLumiReply(nd, { role: 'TEACHER' });
  assert.doesNotMatch(teacher, /Pagos|uniforme|Configuración/);
  assert.match(teacher, /- \*\*Asistencia\*\*[\s\S]*- \*\*Cómo usar la app\*\*/);
});

test('Markdown survives: fences untouched, ordered lists renumbered, bold balanced', () => {
  const fenced = 'Ejemplo:\n```\nsi quieres te ayudo con pagos\n```';
  assert.equal(filterLumiReply(fenced, { role: 'TEACHER' }), fenced);
  const ordered = `Te puedo ayudar con:
1. Tareas
2. Pagos pendientes
3. Avisos`;
  assert.equal(filterLumiReply(ordered, { role: 'TEACHER' }), `Te puedo ayudar con:\n1. Tareas\n2. Avisos\n\n${LUMI_CLOSING}`);
  // Bold opened in one sentence and closed in the next: neither is cut.
  const bold = '**Con gusto te ayudo con pagos. Y con tareas.**';
  assert.equal(filterLumiReply(bold, { role: 'TEACHER' }), bold);
});

test('empty and non-string input pass through', () => {
  assert.equal(filterLumiReply('', { role: 'TEACHER' }), '');
  assert.equal(filterLumiReply(null, { role: 'TEACHER' }), null);
});

// --- The role mirror cannot drift from the server -------------------------

test('HELPS_WITH_BY_ROLE mirrors _lumiCore helpsWith (writes allowed)', () => {
  for (const role of ['ADMIN', 'TEACHER', 'PARENT']) {
    assert.deepEqual(HELPS_WITH_BY_ROLE[role], helpsWith(role, { attendance: true, diary: true }), role);
  }
});

test('every topic some role lacks has a pattern, and every pattern is a real topic', () => {
  const all = new Set(Object.values(HELPS_WITH_BY_ROLE).flat());
  const everyone = [...all].filter((t) => Object.values(HELPS_WITH_BY_ROLE).every((list) => list.includes(t)));
  for (const label of all) {
    if (everyone.includes(label)) continue;
    assert.ok(TOPIC_PATTERNS[label], `no TOPIC_PATTERNS entry for "${label}"`);
  }
  for (const key of Object.keys(TOPIC_PATTERNS)) {
    assert.ok(key === NO_ROLE_TOPIC || all.has(key), `TOPIC_PATTERNS has unknown topic "${key}"`);
  }
});

test('the server\'s own helps_with is read from the my_context tool result', () => {
  const serverList = ['tareas', 'asistencia', 'bitácoras'];
  const messages = [
    { role: 'user', content: '{"prompt":"hola"}' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{
        name: 'lumiQuery',
        status: 'success',
        arguments_string: '{"payload":{"intent":"my_context"}}',
        results: JSON.stringify({ ok: true, intent: 'my_context', role: 'docente', helps_with: serverList }),
      }],
    },
    { role: 'assistant', content: 'Hola' },
  ];
  assert.deepEqual(helpsWithFromMessages(messages), serverList);
  // Another intent's result is not mistaken for it; nothing → null.
  assert.equal(helpsWithFromMessages([{ role: 'assistant', tool_calls: [{ name: 'lumiQuery', results: '{"intent":"homework","homework":[]}' }] }]), null);
  assert.equal(helpsWithFromMessages([]), null);
  // A truncated result still yields its list.
  const cut = `{"ok":true,"intent":"my_context","helps_with":["tareas","avisos"],"school_name":"QA-LIUM`;
  assert.deepEqual(helpsWithFromMessages([{ role: 'assistant', tool_calls: [{ name: 'lumiQuery', results: cut }] }]), ['tareas', 'avisos']);
  // Unknown role and no server list → the narrowest (PARENT) list.
  assert.deepEqual([...allowedTopicsFor(undefined, null)], HELPS_WITH_BY_ROLE.PARENT);
});

test('LumiChat filters every assistant reply before rendering it', () => {
  const src = read('src/components/lumi/LumiChat.jsx');
  assert.match(src, /<LumiMarkdown>\{filterLumiReply\(payload\.text, \{ role, helpsWith: serverHelpsWith \}\)\}<\/LumiMarkdown>/);
  assert.match(src, /helpsWithFromMessages\(messages\)/);
  // LumiChat is the only place Lumi's replies are rendered.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(new URL(`../../${dir}`, import.meta.url), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.(jsx?|tsx?)$/.test(entry.name) && path !== 'src/components/lumi/LumiChat.jsx'
        && /<LumiMarkdown|agents\.(getConversation|subscribeToConversation)/.test(read(path))) offenders.push(path);
    }
  };
  walk('src');
  assert.deepEqual(offenders, [], 'another surface renders Lumi replies: run them through filterLumiReply');
});

test('reports of what staff did are not offers to do it', () => {
  // Past tense is a report; only offer-shaped verb forms count as an offer
  // of "registrar asistencia/bitácoras" to a family.
  const reply = 'Si quieres, te leo lo que escribió su docente en la bitácora de hoy.';
  assert.equal(filterLumiReply(reply, { role: 'PARENT' }), reply);
  const offer = 'Si quieres, puedo registrar la asistencia de Ana.';
  assert.equal(filterLumiReply(offer, { role: 'PARENT' }), LUMI_CLOSING);
});

test('a reply with nothing to drop is returned byte for byte', () => {
  const reply = 'Ana no tiene tareas esta semana.  \nLa siguiente es el **martes 20**. \n';
  assert.equal(filterLumiReply(reply, { role: 'PARENT' }), reply);
});
