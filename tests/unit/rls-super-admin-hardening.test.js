import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function readJsonc(path) {
  const raw = fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  return JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
}

function collectConditions(node, acc = []) {
  if (Array.isArray(node)) {
    node.forEach((n) => collectConditions(n, acc));
  } else if (node && typeof node === 'object') {
    acc.push(node);
    Object.values(node).forEach((v) => collectConditions(v, acc));
  }
  return acc;
}

// SECURITY (audit finding C3): `is_super_admin` is a free, self-grantable field
// on UserProfile. Any school admin can set it on their own profile (UserProfile
// update RLS allows admins to write profiles in their school), so it must not
// grant access in RLS. Cross-tenant access for the real ACACIA platform owner
// flows through the base44 account role (`role: admin`), which tenant admins
// cannot self-assign.
const TENANT_FACING_ENTITIES = [
  'base44/entities/SchoolSubscription.jsonc',
  'base44/entities/School.jsonc',
];

for (const path of TENANT_FACING_ENTITIES) {
  test(`${path} RLS does not trust the self-grantable is_super_admin flag`, () => {
    const raw = fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(raw, /is_super_admin/, `${path} RLS still references is_super_admin`);
  });

  test(`${path} still grants the real platform owner via role: admin`, () => {
    const schema = readJsonc(path);
    const conditions = collectConditions(schema.rls);
    const grantsPlatformOwner = conditions.some(
      (c) => c.role === 'admin' || (c.user_condition && c.user_condition.role === 'admin'),
    );
    assert.ok(grantsPlatformOwner, `${path} no longer grants the platform owner (role: admin)`);
  });
}
