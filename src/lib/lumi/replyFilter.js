// replyFilter.js — deterministic clean-up of Lumi's replies before they are
// shown (LumiChat). DISPLAY ONLY, NOT A PERMISSION CHECK: what Lumi can read
// or write is decided by lumiQuery/lumiWrite on the server, which re-derive
// the caller's role from their own UserProfile. This only stops the chat from
// SAYING things the server would then refuse.
//
// Why it exists (live QA r8, 2026-10-01, after three prompt-only attempts):
//   (a) a refusal to a docente offered "consultar los cargos pendientes",
//       "pagos pendientes", "adeudos" (LM09b-1..3), a docente was offered
//       "Publicar la tarea" / "Mandar un aviso" — writes Lumi does not have
//       (LM06) — and a family was offered "registrar asistencia/bitácoras";
//   (b) a family that claimed a promotion got "Si de verdad te promovieron a
//       director, … puede actualizar tu rol en Permisos y roles" (LP10b), and
//       other runs said "una vez que se refleje" / "quizá aún no se actualiza";
//   (c) "su maestra" when no teacher name is known (it guesses a gender).
//
// What it does, per sentence (or clause joined by ", pero" / ";") and per
// list item:
//   - drops an OFFER or a LIST of a topic outside the viewer's helps_with.
//     An offer is Lumi offering help ("con gusto te ayudo", "puedo
//     revisar…", or "si quieres…" that does not send the user to a screen or
//     a person); a list is ≥3 help topics in one clause; a list item
//     counts as an offer when the line that introduces its list is one;
//   - drops role/sync speculation, and "Permisos y roles" to a non-ADMIN;
//   - rewrites "su/tu maestra|maestro" (no name after it) as "su/tu docente";
//   - if anything was dropped and the reply no longer ends in a question,
//     appends "¿Te ayudo con algo de tu escuela?".
//
// What it deliberately does NOT drop (conservative by design; the tests in
// tests/unit/lumi-reply-filter.test.js pin each one):
//   - a statement that is not an offer, even about a topic outside the role:
//     "Los papás ven sus pagos en la pantalla Pagos" to a docente survives —
//     it answers "¿dónde ven los papás sus pagos?", and "No puedo consultar
//     pagos con tu cuenta" is the refusal itself;
//   - anything carrying data (a digit or "$"): an offer clause with numbers
//     is an answer, not a menu;
//   - a sentence whose ** bold is unbalanced (dropping it would break the
//     Markdown of its neighbours), and anything inside a ``` fence.
//
// HELPS_WITH_BY_ROLE mirrors helpsWith() in base44/functions/lumiQuery/
// _lumiCore.ts with every write allowed; tests/unit/lumi-reply-filter.test.js
// compares them, so a new intent or role cannot drift silently. When the
// conversation holds the server's own my_context answer, its helps_with wins
// (it also knows a read-only license or a deny override).
//
// Import-free on purpose: node --test loads it directly.

export const LUMI_CLOSING = '¿Te ayudo con algo de tu escuela?';

export const HELPS_WITH_BY_ROLE = {
  ADMIN: [
    'tareas', 'asistencia', 'registrar asistencia', 'bitácoras', 'registrar bitácoras',
    'pagos pendientes', 'avisos', 'eventos', 'menú', 'documentos de la escuela',
    'pedidos de uniforme', 'configuración inicial', 'cómo usar la app',
  ],
  TEACHER: [
    'tareas', 'asistencia', 'registrar asistencia', 'bitácoras', 'registrar bitácoras',
    'avisos', 'eventos', 'menú', 'documentos de la escuela', 'cómo usar la app',
  ],
  PARENT: [
    'el resumen de hoy de tus hijos', 'tareas', 'asistencia', 'bitácoras',
    'pagos pendientes', 'avisos', 'eventos', 'menú', 'documentos de la escuela',
    'pedidos de uniforme', 'cómo usar la app',
  ],
};

// Writes Lumi has for no role at all (WRITE_KINDS is attendance + diary only).
export const NO_ROLE_TOPIC = 'otras escrituras';

// Patterns run on folded text (lowercase, no accents, no * _ `). One entry per
// helps_with label that some role lacks; labels every role has need none.
export const TOPIC_PATTERNS = {
  'el resumen de hoy de tus hijos': /\bresumen (de hoy )?de (tus|sus) hij[oa]s\b/,
  // Offer-shaped verb forms only (infinitive, "yo", subjunctive, clitic):
  // "lo que escribió su docente en la bitácora" is a report, not an offer.
  'registrar asistencia': /\b(registr|marc|tom|captur)(ar|o|e|arla|arlas|arlo|arlos)\b[^.?!]{0,30}\b(asistencias?|lista|faltas?|ausentes?|retardos?)\b|\bpas(ar|o|e) (la )?lista\b/,
  'registrar bitácoras': /\b(registr|escrib|llen|redact|captur)(ar|ir|o|e|a|arla|irla|arlas|irlas)\b[^.?!]{0,40}\bbitacoras?\b|\b(crear|creo una|cree una)\b[^.?!]{0,40}\bbitacoras?\b/,
  'pagos pendientes': /\b(pagos?|pagar|adeudos?|cargos|colegiaturas?|cobros?|cobranza|saldos?|mensualidad(es)?)\b|\bcargo (pendiente|vencido)\b/,
  'pedidos de uniforme': /\buniformes?\b/,
  'configuración inicial': /\bconfiguracion\b/,
  [NO_ROLE_TOPIC]: /\b(publicar|publico|publique|publicarla|publicarlo|mandar|mando|mande|mandarle|mandarles|enviar|envio|envie|enviarle|enviarles|crear|creo un|creo una|cree|subir|subo|suba|programar|agendar|registrar|registre)\b[^.?!]{0,25}\b(tareas?|avisos?|eventos?|comunicados?|documentos?|menu|recordatorios?|pedidos?|pagos?|cargos?|citas?)\b/,
};

// Any help topic, to recognise a capability list ("tareas, asistencia,
// avisos, pagos, eventos, etc.") even without an offer verb.
const ANY_TOPIC = [
  /\btareas?\b/, /\basistencias?\b/, /\bbitacoras?\b/, /\bavisos?\b/, /\beventos?\b/,
  /\bmenu\b/, /\bdocumentos?\b/, /\buniformes?\b/, /\b(pagos?|adeudos?|cargos)\b/,
  /\bconfiguracion\b/, /\bcomunicados?\b/, /\bcalendario\b/,
];
const LIST_MIN_TOPICS = 3;

// Lumi offering to do something itself.
const OFFER = new RegExp([
  'te ayudo', 'te puedo ayudar', 'puedo ayudarte', 'puedo apoyarte', 'te puedo apoyar', 'te apoyo',
  'quieres que', 'te gustaria que', 'lo que si puedo', 'tambien puedo', 'puedes pedirme', 'preguntame',
  'puedo (consultar|revisar|ver|buscar|darte|mostrarte|registrar|ayudar|apoyar|decirte|hacer|listar|sacar|preparar|publicar|mandar|enviar|crear)',
  'te puedo (consultar|revisar|mostrar|dar|registrar|decir|buscar)',
].map((p) => `\\b${p}\\b`).join('|'));
// Politeness that is only an offer when it does not point the user somewhere
// else: "Si quieres reviso los adeudos" offers, "Si quieres crear un evento,
// ve a Calendario" / "Si necesitas registrar una falta, entra a Ausencias" /
// "con gusto: sigue estos pasos" is the how-to answer to the user's question.
const SOFT_OFFER = /\b(con gusto|si quieres|si gustas|si necesitas|si tienes (alguna |una )?(duda|pregunta))\b/;
const REDIRECT = /\b(ve a|ve al|entra a|entra al|abre|pulsa|toca|selecciona|sigue (estos|los) pasos|pidele|pideselo|pidesela|preguntale|consultalo con|consulta con|habla con|acude a|acercate a|escribele)\b/;
// "No puedo ayudarte con pagos" / "ni puedo listar adeudos" is the refusal,
// not an offer.
const NEGATED_OFFER = /\b(no|ni) (te )?(puedo|podria)( \w+)?/g;

const SPECULATION = [
  /\bsi (de verdad |realmente |en verdad |efectivamente |ya )?te (promovieron|nombraron|ascendieron|cambiaron|asignaron|dieron)\b/,
  /\bsi (de verdad |realmente |en verdad |efectivamente )?eres (parte del |personal de )?(la )?(direccion|director|directora|administrador|administradora|admin|personal)\b/,
  /\b(una vez que|cuando|en cuanto|apenas) (se )?(refleje|actualice|aplique|sincronice|vea reflejad)/,
  /\b(quiza|quizas|tal vez|puede que|es posible que|probablemente)\b[^.?!]*\b(no se (ha )?(actualiz|reflej|aplic|sincroniz)|aun no|todavia no)/,
  /\b(aun|todavia) no se (ha )?(actualizad|reflejad|aplicad|sincronizad|actualiza|refleja|aplica)/,
  // Blaming sync, not any mention of it: "LIUMA no se sincroniza con Google
  // Calendar" answers a question.
  /\b(problema|falla|error|retraso|tema|detalle|cuestion|desfase|falta)s? de (la )?sincroniz/,
  /\b(se )?sincronice\b/,
];
const PERMISSIONS_SCREEN = /\bpermisos y roles\b/;

const CONNECTOR_AFTER_DROP = /^(mientras tanto|por lo pronto|en ese caso|de todos modos|de cualquier forma)\s*,\s*/i;
// "¿Quieres que lo consulte?" right after a dropped offer points at it.
const FOLLOW_UP_ON_DROPPED = /^[¿]?\s*(quieres que|te gustaria que|deseas que|te parece si|lo (reviso|consulto)|los (reviso|consulto))\b[^?]{0,60}\?/;
const FOLLOW_UP_ON_LIST = /^[¿¡]?[^.!]{0,60}\b(eso|esto|esas|estas|esos|estos|alguna|alguno)\b[^.!]{0,30}\?/;

const BULLET = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/;
const ORDERED = /^(\s*)(\d+)([.)])(\s+)/;
const FENCE = /^\s*(```|~~~)/;
const DATA = /[0-9$]/;

export function foldText(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[*_`]/g, '');
}

/**
 * What the viewer may be offered: the server's own helps_with from the latest
 * my_context answer in the conversation when there is one, else the mirror
 * for their role (unknown → the narrowest, PARENT, same fallback as LumiChat).
 */
export function allowedTopicsFor(role, serverHelpsWith) {
  if (Array.isArray(serverHelpsWith) && serverHelpsWith.length > 0
    && serverHelpsWith.every((t) => typeof t === 'string')) {
    return new Set(serverHelpsWith);
  }
  return new Set(HELPS_WITH_BY_ROLE[role] || HELPS_WITH_BY_ROLE.PARENT);
}

function parseHelpsWith(results) {
  if (results == null) return null;
  let obj = results;
  if (typeof results === 'string') {
    if (!/"intent"\s*:\s*"my_context"/.test(results)) return null;
    try {
      obj = JSON.parse(results);
    } catch {
      const m = results.match(/"helps_with"\s*:\s*(\[[^\]]*\])/);
      if (!m) return null;
      try { return JSON.parse(m[1]); } catch { return null; }
    }
  }
  if (!obj || typeof obj !== 'object' || obj.intent !== 'my_context') return null;
  return Array.isArray(obj.helps_with) ? obj.helps_with : null;
}

/** helps_with from the newest lumiQuery my_context result in `messages`, or null. */
export function helpsWithFromMessages(messages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const calls = Array.isArray(messages[i]?.tool_calls) ? messages[i].tool_calls : [];
    for (let j = calls.length - 1; j >= 0; j -= 1) {
      if (!String(calls[j]?.name || '').includes('lumiQuery')) continue;
      const list = parseHelpsWith(calls[j]?.results);
      if (Array.isArray(list) && list.length > 0 && list.every((t) => typeof t === 'string')) return list;
    }
  }
  return null;
}

function forbiddenTopicIn(folded, allowed) {
  for (const [label, pattern] of Object.entries(TOPIC_PATTERNS)) {
    if (label !== NO_ROLE_TOPIC && allowed.has(label)) continue;
    if (pattern.test(folded)) return label;
  }
  return null;
}

function isOffer(folded) {
  const positive = folded.replace(NEGATED_OFFER, ' ');
  if (OFFER.test(positive)) return true;
  if (SOFT_OFFER.test(positive) && !REDIRECT.test(positive)) return true;
  return ANY_TOPIC.filter((p) => p.test(folded)).length >= LIST_MIN_TOPICS;
}

function isSpeculation(folded, role) {
  if (SPECULATION.some((p) => p.test(folded))) return true;
  return role !== 'ADMIN' && PERMISSIONS_SCREEN.test(folded);
}

function balancedBold(text) {
  return ((text.match(/\*\*/g) || []).length % 2) === 0;
}

// Why a clause must go, or null. `listOffer`: it is an item of a list that an
// offer introduced, so the item needs no offer verb of its own.
function clauseProblem(clause, ctx, listOffer = false) {
  const folded = foldText(clause);
  if (isSpeculation(folded, ctx.role)) return 'speculation';
  if (DATA.test(clause)) return null;
  if (!forbiddenTopicIn(folded, ctx.allowed)) return null;
  return (listOffer || isOffer(folded)) ? 'offer' : null;
}

function splitSentences(text) {
  const out = [];
  const re = /[.!?…]+["”»)]*\s+(?=[¿¡"“«(*_]*[\p{Lu}\d])/gu;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const end = m.index + m[0].length;
    out.push(text.slice(last, end));
    last = end;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function capitalize(text) {
  return text.replace(/^([¿¡"“«(*_\s]*)(\p{Ll})/u, (_, pre, ch) => pre + ch.toUpperCase());
}

// One sentence → the sentence, a shortened sentence, or '' (dropped).
function filterSentence(sentence, ctx, listOffer) {
  if (!balancedBold(sentence)) return { text: sentence, dropped: false };
  const trailing = sentence.match(/\s*$/)[0];
  const body = sentence.slice(0, sentence.length - trailing.length);
  // Questions are judged whole: cutting a clause out of ¿…? unbalances it.
  const parts = body.includes('¿') ? [body] : body.split(/(,\s+pero\s+|;\s+)/i);
  const clauses = [];
  for (let i = 0; i < parts.length; i += 2) clauses.push({ sep: i === 0 ? '' : parts[i - 1], text: parts[i] });
  const keep = clauses.filter((c) => !clauseProblem(c.text, ctx, listOffer));
  if (keep.length === clauses.length) return { text: sentence, dropped: false };
  if (keep.length === 0) return { text: '', dropped: true };
  let rebuilt = keep.map((c, i) => (i === 0 ? c.text : c.sep + c.text)).join('');
  if (keep[0] !== clauses[0]) rebuilt = capitalize(rebuilt.replace(/^pero\s+/i, ''));
  if (keep[keep.length - 1] !== clauses[clauses.length - 1]) rebuilt = `${rebuilt.replace(/[\s,;:—-]+$/, '')}.`;
  return { text: rebuilt + trailing, dropped: true };
}

function filterProse(text, ctx, listOffer = false) {
  let dropped = false;
  let prevDropped = false;
  const kept = [];
  for (const sentence of splitSentences(text)) {
    if (prevDropped && FOLLOW_UP_ON_DROPPED.test(foldText(sentence.trim()))) {
      dropped = true;
      continue;
    }
    const res = filterSentence(sentence, ctx, listOffer);
    if (res.dropped) dropped = true;
    if (!res.text) { prevDropped = true; continue; }
    let out = res.text;
    if (prevDropped && CONNECTOR_AFTER_DROP.test(out)) out = capitalize(out.replace(CONNECTOR_AFTER_DROP, ''));
    kept.push(out);
    prevDropped = false;
  }
  return { text: kept.join('').replace(/\s+$/, ''), dropped };
}

/** "su maestra" → "su docente" unless a name follows ("su maestra Laura"). */
export function neutralizeTeacherNouns(text) {
  return String(text)
    .replace(/\b([Ss]u|[Tt]u) maestr[ao] o (el |la )?maestr[ao]\b/g, '$1 docente')
    .replace(/\b([Ss]u|[Tt]u) maestr[ao]\b(?!\s*,?\s*\**\s*\p{Lu})/gu, '$1 docente');
}

function renumberOrderedLists(lines) {
  const out = [];
  let run = null; // { indent, next }
  for (const line of lines) {
    const m = line.match(ORDERED);
    if (m && (!run || run.indent === m[1])) {
      if (!run) run = { indent: m[1], next: Number(m[2]) };
      out.push(line.replace(ORDERED, `${m[1]}${run.next}${m[3]}${m[4]}`));
      run.next += 1;
      continue;
    }
    if (!m && run && line.trim() !== '' && /^\s+/.test(line)) { out.push(line); continue; }
    run = m ? { indent: m[1], next: Number(m[2]) + 1 } : null;
    out.push(line);
  }
  return out;
}

function endsWithQuestion(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim() === '') continue;
    return lines[i].includes('?');
  }
  return false;
}

/**
 * Filter one assistant reply. `role` is the viewer's app_role (from their own
 * stored UserProfile); `helpsWith` is the server's list when known.
 */
export function filterLumiReply(text, { role, helpsWith } = {}) {
  if (typeof text !== 'string' || text.trim() === '') return text;
  const ctx = { role, allowed: allowedTopicsFor(role, helpsWith) };
  const lines = text.split('\n');
  const out = [];
  let dropped = false;
  let inFence = false;
  // The last prose line before the current list, and what happened to its list.
  let intro = null; // { index, offer, items, removed }
  let listJustEmptied = false;

  const closeList = () => {
    if (intro && intro.items > 0 && intro.removed === intro.items) {
      if (out[intro.index] !== undefined && /:\s*$/.test(out[intro.index])) out[intro.index] = null;
      listJustEmptied = true;
    }
    intro = null;
  };

  for (const line of lines) {
    if (FENCE.test(line)) { inFence = !inFence; out.push(line); continue; }
    if (inFence) { out.push(line); continue; }
    if (line.trim() === '') { out.push(line); continue; }

    const bullet = line.match(BULLET);
    if (bullet && intro !== null) {
      const [, indent, marker, gap, content] = bullet;
      intro.items += 1;
      const res = filterProse(content, ctx, intro.offer);
      if (res.dropped) dropped = true;
      if (!res.text.trim()) { intro.removed += 1; continue; }
      out.push(`${indent}${marker}${gap}${res.text}`);
      continue;
    }
    if (bullet) {
      // A list with no introducing line: judge each item on its own.
      const [, indent, marker, gap, content] = bullet;
      const res = filterProse(content, ctx, false);
      if (res.dropped) dropped = true;
      if (res.text.trim()) out.push(`${indent}${marker}${gap}${res.text}`);
      continue;
    }

    closeList();
    if (listJustEmptied && FOLLOW_UP_ON_LIST.test(line.trim())) {
      listJustEmptied = false;
      dropped = true;
      continue;
    }
    listJustEmptied = false;

    const res = filterProse(line, ctx, false);
    if (res.dropped) dropped = true;
    if (!res.text.trim()) { out.push(null); intro = null; continue; }
    out.push(res.text);
    intro = /:\s*$/.test(res.text)
      ? { index: out.length - 1, offer: isOffer(foldText(res.text)), items: 0, removed: 0 }
      : null;
  }
  closeList();
  // Nothing dropped: the reply goes out byte for byte (trailing "  " hard
  // breaks included), only with the teacher nouns neutralised.
  if (!dropped) return neutralizeTeacherNouns(text);

  let result = out.filter((l) => l !== null);
  result = renumberOrderedLists(result);
  // Collapse blank runs left behind by dropped paragraphs.
  let joined = result.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
  joined = neutralizeTeacherNouns(joined);
  if (!endsWithQuestion(joined.split('\n'))) {
    joined = joined ? `${joined}\n\n${LUMI_CLOSING}` : LUMI_CLOSING;
  }
  return joined;
}
