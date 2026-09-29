// provisionOnboardingProfile/entry.ts is a hand-kept copy of
// src/lib/authorization/onboardingProvision.js#runOnboardingProvision (Deno
// cannot import src/). The behaviour is tested on the JS copy
// (onboarding-tenant-creation.test.js); this file pins the load-bearing lines
// of the server copy and the schema it depends on, so the two cannot drift
// silently. Every assertion here is a bug that shipped once (audit F03/F26/F37).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TRIAL_DURATION_DAYS, PLAN_LIMITS } from '../../src/lib/license/licenseModel.js';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const fn = read('base44/functions/provisionOnboardingProfile/entry.ts');
// Code only: the file's comments explain what was removed and name it.
const client = read('src/lib/onboardingTenantCreation.js').replace(/^\s*\/\/.*$/gm, '');

test('the founder is stamped from the authenticated user, and School stores the field', () => {
  assert.match(fn, /created_by_user_id: user\.id,/);
  assert.match(fn, /isFounder = Boolean\(school!\.created_by_user_id\) && school!\.created_by_user_id === user\.id/);
  const school = JSON.parse(read('base44/entities/School.jsonc'));
  // The schema used to drop these, so the founder check always failed and the
  // chosen branding vanished.
  for (const f of ['created_by_user_id', 'join_code', 'theme_settings', 'is_demo']) {
    assert.ok(school.properties[f], `School.${f} must be declared`);
  }
  for (const f of ['created_by_user_id', 'join_code', 'is_demo']) {
    assert.equal(school.properties[f].rls?.write, false, `School.${f} is server-only`);
  }
});

test('the server creates the trial with its own clock and the client copy\'s numbers', () => {
  assert.match(fn, new RegExp(`const TRIAL_DURATION_DAYS = ${TRIAL_DURATION_DAYS};`));
  assert.match(fn, new RegExp(`const START_STUDENT_LIMIT = ${PLAN_LIMITS.start};`));
  assert.match(fn, /const now = new Date\(\);/);
  assert.match(fn, /SchoolSubscription\.create\(buildTrialSubscription\(schoolId, now\)\)/);
});

test('join codes are resolved on the server, and the consent record lands before the profile', () => {
  assert.match(fn, /resolveSchoolByCode\(sr, body\?\.joinCode\)/);
  assert.doesNotMatch(fn, /body\?\.schoolId/, 'the school is never taken from the request');
  const consentAt = fn.indexOf('ConsentRecord.create(');
  const profileAt = fn.indexOf('UserProfile.create(');
  assert.ok(consentAt > 0 && profileAt > consentAt, 'ConsentRecord must be written before the profile (the commit point)');
});

test('the browser no longer writes platform-only entities or the phantom bootstrap', () => {
  for (const pattern of [
    /entities\.School\.(create|filter)/,
    /entities\.SchoolSubscription\./,
    /entities\.ConsentRecord/,
    /entities\.(Role|PermissionTemplate|AccessBinding)/,
    /ensureTenantBootstrapRecords/,
  ]) {
    assert.doesNotMatch(client, pattern);
  }
  assert.match(client, /functions\.invoke\('provisionOnboardingProfile'/);
});

test('onboarding UI: Spanish labels, inline errors, labelled inputs', () => {
  const ui = read('src/components/onboarding/Onboarding.jsx');
  assert.doesNotMatch(ui, /\balert\(/, 'errors are shown inline, not in alert()');
  assert.doesNotMatch(ui, /<Label>/, 'every Label is tied to its input with htmlFor');
  assert.doesNotMatch(ui, /className="capitalize">\{role\}/, 'palette slots are not shown as English keys');
  assert.match(ui, /primary: 'Principal'/);
  assert.match(ui, /role="alert"/);
  assert.match(ui, /¿Dónde está el código\?/);
});
