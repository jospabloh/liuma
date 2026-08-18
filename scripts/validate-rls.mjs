#!/usr/bin/env node
/**
 * validate-rls.mjs — static guard for Base44 Row-Level Security correctness.
 *
 * Multi-tenant isolation in Base44 has TWO halves and getting either wrong fails
 * SILENTLY (see the ACACIA portfolio post-mortems):
 *
 *   - Entity side (left of a rule): a custom field MUST be addressed as `data.<f>`
 *     or be a built-in (id, _id, created_by_id, created_date, updated_date). A
 *     bare key (e.g. `tenant_id`) points at nothing → the clause matches EVERY
 *     row → RLS OFF (cross-tenant leak).
 *   - User side (the template, right of a rule): custom user fields resolve as
 *     `{{user.data.<f>}}`. The only bare built-ins are {{user.id}}, {{user.email}},
 *     {{user.role}}. `{{user.tenant_id}}` resolves to nothing → matches ZERO rows
 *     → every tenant sees an empty app.
 *
 * This script parses every base44/entities/*.jsonc and FAILS CI on either class
 * of error.
 *
 * NOTE: it does NOT flag a missing service-role (`role: admin`) $or branch. That
 * branch is needed only on the specific entities a backend `asServiceRole`
 * function reads/writes — which is not statically decidable from the schema, so
 * a heuristic over-fires (every tenant-scoped entity, most of them end-user
 * only). Keep that review manual; this guard stays focused on the two silent,
 * always-wrong classes above so every failure it reports is actionable.
 *
 * THIRD class, added 2026-08-18: a rule object that mixes "user_condition"
 * with sibling field keys — e.g. {"data.school_id": X, "user_condition": Y} —
 * looks like valid Mongo-style implicit-AND syntax and this script used to
 * accept it, but Base44's live deploy-time engine does NOT: it silently DROPS
 * every sibling key and keeps only user_condition. A tenant-scoping clause
 * written that way isn't "strict but correct" — it's not enforced at all.
 * Found across 29 of liuma's 32 entities (84 instances) while completing the
 * module-4 live deploy: the *deployed* schemas already had this exact shape,
 * meaning tenant scoping on most read/write rules combined with a role check
 * was silently inert in production. Confirmed via update_entity_schema's own
 * validator error ("user_condition must be the only key in its rule — the
 * engine drops the sibling clause(s)") — the same defect class (and message)
 * jospabloh/cateqhub's CLAUDE.md documents finding once, in one entity
 * (Parish), with a note it was worth checking elsewhere. This is elsewhere.
 * The fix is always the same: wrap as {"$and": [{"user_condition": Y}, {rest
 * of the keys}]} — never drop the entity-side clause to "simplify".
 *
 * Run: node scripts/validate-rls.mjs   (also: npm run validate:rls)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTITIES_DIR = join(__dirname, '..', 'base44', 'entities');

// `_id` is the Base44/Mongo record-id alias and is a legitimate built-in.
const BUILTIN_ENTITY_FIELDS = new Set(['id', '_id', 'created_by_id', 'created_date', 'updated_date']);
const BUILTIN_USER_TEMPLATES = new Set(['{{user.id}}', '{{user.email}}', '{{user.role}}']);
const OPS = ['create', 'read', 'update', 'delete'];

/** Strip // and block comments so JSONC parses as JSON. */
function parseJsonc(text) {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, '$1');
  return JSON.parse(noLine);
}

const errors = [];

function checkUserTemplate(value, ctx) {
  if (typeof value !== 'string') return;
  const matches = value.match(/\{\{\s*user[^}]*\}\}/g) || [];
  for (const tpl of matches) {
    const normalized = tpl.replace(/\s+/g, '');
    if (BUILTIN_USER_TEMPLATES.has(normalized)) continue;
    if (/^\{\{user\.data\.[\w.]+\}\}$/.test(normalized)) continue;
    errors.push(`${ctx}: invalid user template "${tpl}" — custom user fields must be {{user.data.<field>}}; only {{user.id}}, {{user.email}}, {{user.role}} are bare built-ins.`);
  }
}

function checkEntityKey(key, ctx) {
  if (key.startsWith('$') || key === 'user_condition') return;
  if (BUILTIN_ENTITY_FIELDS.has(key)) return;
  if (key.startsWith('data.')) return;
  errors.push(`${ctx}: invalid entity field path "${key}" — custom fields must be "data.${key}" (a bare key matches every row and disables RLS).`);
}

function walkRule(node, ctx) {
  if (Array.isArray(node)) {
    node.forEach((n, i) => walkRule(n, `${ctx}[${i}]`));
    return;
  }
  if (node && typeof node === 'object') {
    const keys = Object.keys(node);
    if (keys.includes('user_condition') && keys.length > 1) {
      const siblings = keys.filter((k) => k !== 'user_condition');
      errors.push(`${ctx}: "user_condition" has sibling key(s) [${siblings.join(', ')}] in the same rule object — Base44's engine drops the sibling clause(s) and evaluates user_condition alone. Wrap as {"$and": [{"user_condition": ...}, {${siblings.join(', ')}}]}.`);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'user_condition') continue;
      if (key === '$or' || key === '$and' || key === '$in' || key === '$nin') {
        walkRule(value, `${ctx}.${key}`);
        continue;
      }
      checkEntityKey(key, ctx);
      checkUserTemplate(value, `${ctx}.${key}`);
    }
  }
}

const files = readdirSync(ENTITIES_DIR).filter((f) => f.endsWith('.jsonc'));
if (files.length === 0) {
  console.error('validate:rls — no entity files found in base44/entities');
  process.exit(1);
}

for (const file of files) {
  let schema;
  try {
    schema = parseJsonc(readFileSync(join(ENTITIES_DIR, file), 'utf8'));
  } catch (e) {
    errors.push(`${file}: not valid JSONC — ${e.message}`);
    continue;
  }
  const rls = schema.rls || {};
  // Entity-level RLS
  for (const op of OPS) {
    if (!rls[op]) continue;
    walkRule(rls[op], `${file}:rls.${op}`);
  }
  // Field-level RLS
  for (const [fname, fdef] of Object.entries(schema.properties || {})) {
    if (fdef && fdef.rls) {
      for (const op of Object.keys(fdef.rls)) {
        walkRule(fdef.rls[op], `${file}:${fname}.rls.${op}`);
      }
    }
  }
}

if (errors.length) {
  console.error(`\n❌ validate:rls failed with ${errors.length} error(s):`);
  for (const e of errors) console.error(`   • ${e}`);
  process.exit(1);
}
console.log(`✅ validate:rls — ${files.length} entities OK.`);
