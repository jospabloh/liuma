#!/usr/bin/env node
// STANDARD Module 24 — a tenant's role must never match rows of every tenant.
//
// Copy into an app as scripts/check-tenant-roles.mjs and run it in CI
// (`npm run validate:tenant-roles`). It fails the build on:
//   1. an RLS `user_condition` that tests anything other than the platform tier
//      (built-in role "admin" / "__service_role_only__") WITHOUT being ANDed
//      with a tenant match — i.e. a tenant role (owner, business_admin, a
//      data.*_role field…) that would match every tenant's rows;
//   2. an object holding `user_condition` next to sibling keys — Base44 drops
//      the siblings silently, so the condition ends up unscoped;
//   3. backend code that writes built-in role "admin" to a user outside the
//      platform-owner files listed in --allow;
//   4. a User field that any RLS rule reads as {{user.data.<field>}} (the
//      tenant pointer, a data role) without a platform-only rls.write lock on
//      User — otherwise a user re-points themselves to another tenant with
//      updateMe, and every rule keyed on that field follows them there.
// It reads the repo's schema files, not the deployed schema: pair it with the
// Module 4 rule of verifying what is deployed.
//
//   node scripts/check-tenant-roles.mjs [--root .] [--allow path1,path2]
//        [--tenant-admin] [--delegated field1,field2]
//
// --tenant-admin  design B (Module 24): the app's tenant admins hold built-in
//                 "admin", so "admin" is a TENANT role and must be scoped like
//                 any other. Only "__service_role_only__" counts as platform.
// --delegated     User fields a tenant admin assigns to members of their own
//                 tenant (e.g. an investor's group). Their lock may be a tenant
//                 role, as long as it is scoped to the tenant. Tenant pointers
//                 (tenant_id, business_id…) never belong here.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

export const PLATFORM_ROLES = new Set(['admin', '__service_role_only__'])
export const SERVICE_ONLY = new Set(['__service_role_only__'])
const TENANT_TEMPLATE = /^\{\{\s*user\.(id|email|data\.[A-Za-z0-9_]+)\s*\}\}$/

export function stripJsonc(text) {
  let out = ''
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      out += c
      if (c === '\\') { out += text[++i] ?? ''; continue }
      if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; out += c; continue }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue }
    out += c
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

// A node "matches the caller's tenant" if it pins a record field to a user template.
function isTenantMatch(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false
  return Object.entries(node).some(([k, v]) =>
    k !== 'user_condition' && !k.startsWith('$') && typeof v === 'string' && TENANT_TEMPLATE.test(v))
}

function isPlatformCondition(cond, platform = PLATFORM_ROLES) {
  const keys = Object.keys(cond ?? {})
  return keys.length === 1 && keys[0] === 'role' && platform.has(cond.role)
}

// Walk one rule; `scoped` is true once an enclosing $and carries a tenant match.
export function findUnscoped(rule, path = '', scoped = false, out = [], platform = PLATFORM_ROLES) {
  if (!rule || typeof rule !== 'object') return out
  if (Array.isArray(rule)) { rule.forEach((r, i) => findUnscoped(r, `${path}[${i}]`, scoped, out, platform)); return out }
  if ('user_condition' in rule) {
    const siblings = Object.keys(rule).filter((k) => k !== 'user_condition')
    if (siblings.length) out.push({ path, kind: 'sibling-keys', detail: `user_condition beside ${siblings.join(', ')} (siblings are dropped)` })
    if (!scoped && !isPlatformCondition(rule.user_condition, platform)) {
      out.push({ path, kind: 'unscoped-tenant-role', detail: JSON.stringify(rule.user_condition) })
    }
  }
  if (Array.isArray(rule.$and)) {
    const tenantScoped = scoped || rule.$and.some(isTenantMatch)
    rule.$and.forEach((r, i) => findUnscoped(r, `${path}.$and[${i}]`, tenantScoped, out, platform))
  }
  if (Array.isArray(rule.$or)) rule.$or.forEach((r, i) => findUnscoped(r, `${path}.$or[${i}]`, scoped, out, platform))
  return out
}

export function checkEntity(name, schema, platform = PLATFORM_ROLES) {
  const findings = []
  for (const [op, rule] of Object.entries(schema?.rls ?? {})) {
    for (const f of findUnscoped(rule, `rls.${op}`, false, [], platform)) findings.push({ entity: name, ...f })
  }
  for (const [field, def] of Object.entries(schema?.properties ?? {})) {
    for (const [op, rule] of Object.entries(def?.rls ?? {})) {
      for (const f of findUnscoped(rule, `properties.${field}.rls.${op}`, false, [], platform)) findings.push({ entity: name, ...f })
    }
  }
  return findings
}

// Every {{user.data.<field>}} a rule depends on must be locked on User.
export function userDataFieldsUsed(schema) {
  const out = new Set()
  const re = /\{\{\s*user\.data\.([A-Za-z0-9_]+)\s*\}\}/g
  const scan = (v) => {
    if (typeof v === 'string') { for (const m of v.matchAll(re)) out.add(m[1]) }
    else if (Array.isArray(v)) v.forEach(scan)
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
      scan(x)
    }
  }
  const walkUserCond = (v) => {
    if (Array.isArray(v)) return v.forEach(walkUserCond)
    if (!v || typeof v !== 'object') return
    if (v.user_condition && typeof v.user_condition === 'object') {
      for (const k of Object.keys(v.user_condition)) { const km = /^data\.([A-Za-z0-9_]+)$/.exec(k); if (km) out.add(km[1]) }
    }
    Object.values(v).forEach(walkUserCond)
  }
  scan(schema?.rls); walkUserCond(schema?.rls)
  for (const def of Object.values(schema?.properties ?? {})) { scan(def?.rls); walkUserCond(def?.rls) }
  return out
}

// A User field is locked when nobody but the platform can write it: `false`
// (the strongest lock — not even the service role's client-side callers), or a
// lone platform `user_condition`. A --delegated field may instead be locked to a
// tenant role, provided every condition in that lock is scoped to the tenant.
function hasCondition(rule) {
  if (!rule || typeof rule !== 'object') return false
  if (Array.isArray(rule)) return rule.some(hasCondition)
  return 'user_condition' in rule || Object.values(rule).some(hasCondition)
}

export function unlockedUserFields(fieldsUsed, userSchema, { platform = PLATFORM_ROLES, delegated = new Set() } = {}) {
  const missing = []
  for (const f of fieldsUsed) {
    const w = userSchema?.properties?.[f]?.rls?.write
    let locked = w === false ||
      (!!w && typeof w === 'object' && isPlatformCondition(w.user_condition, platform) && Object.keys(w).length === 1)
    if (!locked && delegated.has(f) && w && typeof w === 'object') {
      locked = hasCondition(w) && findUnscoped(w, '', false, [], platform).length === 0
    }
    if (!locked) missing.push(f)
  }
  return missing.sort()
}

const ASSIGN_ADMIN = /\brole\s*:\s*['"]admin['"]/

export function findAdminAssignments(source) {
  const hits = []
  source.split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '')
    if (ASSIGN_ADMIN.test(code) && !/user_condition/.test(code)) hits.push({ line: i + 1, text: line.trim() })
  })
  return hits
}

function walk(dir, exts) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p, exts) : exts.some((e) => p.endsWith(e)) ? [p] : []
  })
}

function main() {
  const args = process.argv.slice(2)
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
  const root = opt('--root') ?? '.'
  const allow = new Set((opt('--allow') ?? '').split(',').filter(Boolean))
  const tenantAdmin = args.includes('--tenant-admin')
  const platform = tenantAdmin ? SERVICE_ONLY : PLATFORM_ROLES
  const delegated = new Set((opt('--delegated') ?? '').split(',').filter(Boolean))
  const problems = []

  const entDir = [join(root, 'base44/entities'), join(root, 'entities')].find(existsSync)
  if (!entDir) { console.error('✗ no base44/entities directory found'); process.exit(1) }
  const fieldsUsed = new Set()
  let userSchema = null
  for (const file of walk(entDir, ['.jsonc', '.json'])) {
    let schema
    try { schema = JSON.parse(stripJsonc(readFileSync(file, 'utf8'))) } catch (e) {
      problems.push(`${relative(root, file)}: cannot parse (${e.message})`); continue
    }
    if ((schema.name ?? '') === 'User' || /\/User\.jsonc?$/.test(file)) userSchema = schema
    for (const f of checkEntity(schema.name ?? file, schema, platform)) {
      problems.push(`${relative(root, file)} ${f.path}: ${f.kind} — ${f.detail}`)
    }
    for (const f of userDataFieldsUsed(schema)) fieldsUsed.add(f)
  }
  for (const f of unlockedUserFields(fieldsUsed, userSchema, { platform, delegated })) {
    problems.push(`User.${f}: RLS reads {{user.data.${f}}} but User has no platform-only rls.write lock on it${userSchema ? '' : ' (no User schema file at all)'}`)
  }
  // Design B hands out built-in "admin" to tenant admins on purpose; its rules
  // (checked above with admin as a tenant role) are what keep that safe.
  for (const file of tenantAdmin ? [] : walk(join(root, 'base44/functions'), ['.ts', '.js'])) {
    const rel = relative(root, file)
    if (allow.has(rel) || /\.test\.(ts|js)$/.test(rel)) continue
    for (const h of findAdminAssignments(readFileSync(file, 'utf8'))) {
      problems.push(`${rel}:${h.line}: assigns built-in role 'admin' — ${h.text}`)
    }
  }

  if (problems.length) {
    console.error(`✗ Module 24 — ${problems.length} problem(s):`)
    for (const p of problems) console.error('  ' + p)
    console.error("  A tenant's role must be ANDed with a tenant match; built-in 'admin' is the platform's only.")
    process.exit(1)
  }
  console.log('✓ Module 24 — no tenant role reaches every tenant; no code hands out built-in admin.')
}

if (import.meta.url === `file://${process.argv[1]}`) main()
