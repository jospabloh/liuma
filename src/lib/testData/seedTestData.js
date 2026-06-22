/**
 * Test-data applier — persists the blueprint into Base44 via the app SDK.
 *
 * IMPORTANT: this only produces Base44 "sample" data (is_sample:true, hidden when
 * the Test Data toggle is off) when it runs INSIDE the app while Test Data mode
 * is ON — the platform tags writes based on that context. Run from the in-app
 * Seed page, not from a plain server script.
 *
 * Safety: there is no delete in the data API, so this refuses to run twice
 * (it aborts if a `[TEST]`-prefixed classroom already exists) to avoid
 * duplicates that can't be cleaned up programmatically.
 */
import { buildTestDataBlueprint, TEST_PREFIX } from './blueprint.js';
import { deriveScopes } from './isolation.js';

const REF = (v) => v && typeof v === 'object' && !Array.isArray(v) && 'ref' in v;

/** Deep-resolve every { ref } in a record against the id map. Throws on dangling. */
export function resolveRefs(value, idMap, path = '') {
  if (Array.isArray(value)) return value.map((v, i) => resolveRefs(v, idMap, `${path}[${i}]`));
  if (REF(value)) {
    const id = idMap[value.ref];
    if (id === undefined) throw new Error(`Unresolved ref '${value.ref}' at ${path || '<root>'}`);
    return id;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveRefs(v, idMap, path ? `${path}.${k}` : k);
    return out;
  }
  return value;
}

/**
 * Attempt to create the fictitious users through whatever the SDK exposes.
 * User provisioning is platform-gated; if it's not available we fall back to a
 * synthetic placeholder id so the rest of the graph still applies and stays
 * internally connected. Never throws.
 * @returns {Promise<Record<localId,{id, provisioned, email, role, full_name, error?}>>}
 */
export async function provisionUsers(sdk, users, ownerUserId, log = () => {}) {
  const result = {};
  for (const u of users) {
    if (u.existing) { result[u.localId] = { id: ownerUserId, provisioned: true, role: u.role, existing: true }; continue; }
    let id;
    let error;
    const attempts = [
      () => sdk?.auth?.inviteUser?.({ email: u.email, full_name: u.full_name }),
      () => sdk?.auth?.invite?.({ email: u.email, full_name: u.full_name }),
      () => sdk?.entities?.User?.create?.({ email: u.email, full_name: u.full_name }),
    ];
    for (const attempt of attempts) {
      try {
        const res = await attempt();
        if (res && (res.id || res._id)) { id = res.id || res._id; break; }
      } catch (e) { error = e?.message || String(e); }
    }
    const provisioned = Boolean(id);
    result[u.localId] = {
      id: id || `placeholder:${u.localId}`,
      provisioned,
      role: u.role,
      email: u.email,
      full_name: u.full_name,
      ...(provisioned ? {} : { error: error || 'SDK user provisioning not available' }),
    };
    log(`${provisioned ? '✓ invited' : '⚠ placeholder for'} ${u.role} ${u.email}`);
  }
  return result;
}

/**
 * Seed the full dataset.
 * @param {object} args
 * @param {object} args.sdk        - the base44 client
 * @param {string} args.schoolId   - target school id (the admin's own school)
 * @param {string} args.ownerUserId- the seeding admin's user id
 * @param {(msg:string)=>void} [args.log]
 * @param {boolean} [args.force]   - bypass the duplicate-seed guard
 * @returns {Promise<{ created, byEntity, users, scopes, warnings, idMap }>}
 */
export async function seedTestData({ sdk, schoolId, ownerUserId, log = () => {}, force = false }) {
  if (!schoolId || !ownerUserId) throw new Error('seedTestData requires schoolId and ownerUserId');
  const warnings = [];

  // Guard: refuse to double-seed (records are not deletable via the API).
  if (!force) {
    const existing = await sdk.entities.Classroom.filter({ school_id: schoolId });
    if ((existing || []).some((c) => typeof c.name === 'string' && c.name.startsWith(TEST_PREFIX))) {
      throw new Error(`Test data appears to already exist for this school (found a "${TEST_PREFIX}" classroom). Aborting to avoid un-deletable duplicates. Pass force=true to override.`);
    }
  }

  const blueprint = buildTestDataBlueprint();

  // Provision people first so their ids are available for every foreign key.
  const userResults = await provisionUsers(sdk, blueprint.users, ownerUserId, log);
  const idMap = { SCHOOL: schoolId };
  for (const [localId, r] of Object.entries(userResults)) idMap[localId] = r.id;
  const placeholders = Object.values(userResults).filter((r) => !r.provisioned && !r.existing);
  if (placeholders.length) {
    warnings.push(`${placeholders.length} fictitious users could not be created via the SDK and use placeholder ids. Create them in Base44 (invite with the listed emails), then re-link or re-seed. See docs/test-data-report.md.`);
  }

  // Apply ops in declared (dependency-safe) order.
  const byEntity = {};
  let created = 0;
  for (const op of blueprint.ops) {
    const data = resolveRefs(op.data, idMap, `${op.entity}#${op.localId}`);
    try {
      const rec = await sdk.entities[op.entity].create(data);
      idMap[op.localId] = rec?.id ?? idMap[op.localId];
      byEntity[op.entity] = (byEntity[op.entity] || 0) + 1;
      created += 1;
    } catch (e) {
      warnings.push(`Failed to create ${op.entity} (${op.localId}): ${e?.message || e}`);
      log(`✗ ${op.entity} ${op.localId}: ${e?.message || e}`);
    }
  }

  // Derived scopes the platform must place on User.data for RLS to enforce
  // teacher/parent isolation — surfaced so the operator can apply them.
  const localScopes = deriveScopes(blueprint);
  const scopes = {};
  for (const [localUserId, sc] of Object.entries(localScopes)) {
    scopes[localUserId] = {
      user: userResults[localUserId] || null,
      role: sc.role,
      school_id: schoolId,
      assigned_classroom_ids: sc.assigned_classroom_ids.map((l) => idMap[l]).filter(Boolean),
      assigned_student_ids: sc.assigned_student_ids.map((l) => idMap[l]).filter(Boolean),
      linked_student_ids: sc.linked_student_ids.map((l) => idMap[l]).filter(Boolean),
      linked_student_classroom_ids: sc.linked_student_classroom_ids.map((l) => idMap[l]).filter(Boolean),
    };
  }

  log(`Done. Created ${created} records across ${Object.keys(byEntity).length} entities.`);
  return { created, byEntity, users: userResults, scopes, warnings, idMap };
}
