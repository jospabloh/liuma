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

});

// Audit F10 (2026-09-29): the tenant read branch keyed on
// {{user.data.school_id}} + data.app_role, fields no User has — so it never
// matched and every school user read null. It was dead, and a dead rule that
// LOOKS like tenant access is how the next change turns it into a live leak.
// Tenant reads go through getMySubscription (service role, school re-derived
// from the caller's own ACTIVE profile) instead.
test('SchoolSubscription read is platform-only; tenants read through getMySubscription', () => {
  const schema = readJsonc('base44/entities/SchoolSubscription.jsonc');
  assert.deepEqual(schema.rls.read, { user_condition: { role: 'admin' } });

  const fn = read('base44/functions/getMySubscription/entry.ts');
  assert.match(fn, /asServiceRole/);
  assert.match(fn, /UserProfile\.filter\(\{ user_id: user\.id \}\)/, 'school comes from the caller\'s own profiles');
  assert.doesNotMatch(fn, /req\.json\(\)/, 'the request body is never read — nothing in it can pick the school');
  assert.match(fn, /profile\.status !== 'ACTIVE'/, 'only an ACTIVE profile reads its school license');

  const hook = read('src/hooks/useSubscription.js');
  assert.match(hook, /invokeFunction\(base44, 'getMySubscription'/);
  assert.doesNotMatch(hook, /entities\.SchoolSubscription/);
  assert.doesNotMatch(read('src/pages/Home.jsx'), /entities\.SchoolSubscription/);
});

test('getMySubscription gives non-admins only status, tier and trial end', () => {
  const fn = read('base44/functions/getMySubscription/entry.ts');
  assert.match(fn, /const MEMBER_FIELDS = \['subscription_status', 'license_tier', 'trial_end_date'\];/);
  assert.match(fn, /INTERNAL_FIELDS = \['activation_notes', 'notes', 'last_payment_notes'/);
  // join_code only in the ADMIN branch
  assert.match(fn, /\.\.\.\(isAdmin \? \{ join_code:/);
});

// The welcome flag moved off the billing entity onto the user's own profile so
// the subscription can stay owner-write-only.
test('welcome flag lives on the user\'s own UserProfile', () => {
  const profile = readJsonc('base44/entities/UserProfile.jsonc');
  assert.ok(profile.properties.welcome_message_shown, 'UserProfile declares welcome_message_shown');

  const home = read('src/pages/Home.jsx');
  // Home marks the welcome shown on the user's own profile, not the
  // subscription — through markWelcomeShown, since UserProfile.update is
  // service-role only (P10 review).
  assert.match(home, /invokeFunction\(base44, 'markWelcomeShown', \{ profileId: userProfile\.id \}\)/);
  assert.doesNotMatch(home, /UserProfile\.update\(/);
  const fn = read('base44/functions/markWelcomeShown/entry.ts');
  assert.match(fn, /String\(profile\.user_id \|\| ''\) !== String\(user\.id\)/);
  assert.match(fn, /UserProfile\.update\(profileId, \{ welcome_message_shown: true \}\)/);
  assert.doesNotMatch(home, /SchoolSubscription\.update\([^)]*welcome_message_shown/);
});
