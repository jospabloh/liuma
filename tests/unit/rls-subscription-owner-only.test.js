import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}
function readJsonc(path) {
  return JSON.parse(read(path).replace(/^\s*\/\/.*$/gm, ''));
}

// SECURITY (audit finding C4): a school admin could self-activate their own
// SchoolSubscription (set status/tier/expiry) and bypass the paywall and the
// read-only write-guard. Licensing is owner-controlled, so subscription writes
// are now restricted to the base44 platform owner (role: admin). Tenant admins
// keep READ access only.
test('SchoolSubscription write RLS is owner-only (no tenant app_role branch)', () => {
  const schema = readJsonc('base44/entities/SchoolSubscription.jsonc');

  for (const op of ['update', 'delete']) {
    const rule = JSON.stringify(schema.rls[op]);
    assert.match(rule, /"role":"admin"/, `${op} should grant the platform owner`);
    assert.doesNotMatch(rule, /app_role/, `${op} must not grant tenant admins`);
    assert.doesNotMatch(rule, /school_id/, `${op} must not be scoped to a tenant`);
  }

  // Tenant admins must still be able to READ their own subscription.
  assert.match(JSON.stringify(schema.rls.read), /app_role/);
});

// The welcome flag moved off the billing entity onto the user's own profile so
// the subscription can stay owner-write-only.
test('welcome flag lives on the self-writable UserProfile', () => {
  const profile = readJsonc('base44/entities/UserProfile.jsonc');
  assert.ok(profile.properties.welcome_message_shown, 'UserProfile declares welcome_message_shown');

  const home = read('src/pages/Home.jsx');
  // Home marks the welcome shown by writing the user's own profile, not the subscription.
  assert.match(home, /UserProfile\.update\(userProfile\.id,\s*\{\s*welcome_message_shown:\s*true/);
  assert.doesNotMatch(home, /SchoolSubscription\.update\([^)]*welcome_message_shown/);
});
