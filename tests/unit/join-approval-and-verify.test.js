import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeLoginError, needsEmailVerification } from '../../src/lib/errorMessages.js';
import { APPROVABLE_ROLES, defaultApprovalRole } from '../../src/lib/members/approvalRoles.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const httpError = (status, data) => Object.assign(new Error(`Request failed with status code ${status}`), { status, data });

// ---------------------------------------------------- A: e-mail code ----

test('an unverified e-mail is recognised wherever the SDK puts the message', () => {
  assert.equal(needsEmailVerification(new Error('Please verify your email before logging in')), true);
  assert.equal(needsEmailVerification(httpError(403, { detail: 'Enter the verification code we sent you' })), true);
  const axiosLike = Object.assign(new Error('Request failed'), { response: { status: 403, data: { message: 'Email not verified' } } });
  assert.equal(needsEmailVerification(axiosLike), true);
  assert.equal(needsEmailVerification(httpError(401, { detail: 'Invalid credentials' })), false);
  assert.equal(needsEmailVerification(null), false);
});

test('describeLoginError sends an unverified user to the code step, not to "bad password"', () => {
  const failure = describeLoginError(httpError(403, { message: 'Please verify your email' }));
  assert.equal(failure.kind, 'unverified');
  assert.match(failure.message, /código/);
  assert.equal(describeLoginError(httpError(401)).kind, 'credentials');
});

test('Login falls to the verify step with a resend, and the code step logs in afterwards', () => {
  const src = read('src/pages/Login.jsx');
  assert.match(src, /failure\.kind === 'unverified'[\s\S]*?setMode\("verify"\)[\s\S]*?base44\.auth\.resendOtp\(email\.trim\(\)\)/);
  assert.match(src, /base44\.auth\.verifyOtp\(\{ email: email\.trim\(\), otpCode: code\.trim\(\) \}\)/);
  // After a good code it signs in with the password still typed.
  assert.match(src, /verifyOtp[\s\S]*?loginViaEmailPassword\(email\.trim\(\), password\)/);
  assert.match(src, /handleResend[\s\S]*?resendOtp/);
  // Register goes to the code step.
  assert.match(src, /auth\.register\([\s\S]*?setMode\("verify"\)/);
  assert.doesNotMatch(src, /—/);
});

// ------------------------------------------- B: join needs approval ----

test('joining with a code only ever provisions a PENDING profile', () => {
  const src = read('base44/functions/provisionOnboardingProfile/entry.ts');
  assert.match(src, /let status = 'PENDING';/);
  // ACTIVE is only assigned inside the ADMIN (founder) branch.
  const active = [...src.matchAll(/status = 'ACTIVE'/g)];
  assert.equal(active.length, 1);
  assert.ok(src.indexOf("status = 'ACTIVE'") > src.indexOf("if (role === 'ADMIN') {\n      const schoolAdmins"));
  assert.match(src, /!isFounder \|\| otherActiveAdminExists/);
  // An existing profile never has app_role/status rewritten.
  // (Plus the consent stamp, v1.9.0 — never app_role or status.)
  assert.match(src, /UserProfile\.update\(existing\.id, \{ phone, onboarding_completed: true, \.\.\.consentStamp \}\)/);
  assert.doesNotMatch(src.match(/const consentStamp = \{[\s\S]*?\};/)[0], /app_role|status/);
});

test('UserProfile is service-role only to create and update', () => {
  const rls = read('base44/entities/UserProfile.jsonc').slice(read('base44/entities/UserProfile.jsonc').lastIndexOf('"rls"'));
  assert.match(rls, /"create": \{\s*"user_condition": \{\s*"role": "admin"/);
  assert.match(rls, /"update": \{\s*"user_condition": \{\s*"role": "admin"/);
});

test('the approving ADMIN picks the role from an allowlist; the applicant\'s pick is only a request', () => {
  const src = read('base44/functions/approveProfile/entry.ts');
  assert.match(src, /const APP_ROLES = \['ADMIN', 'TEACHER', 'PARENT'\];/);
  assert.match(src, /INVALID_ROLE/);
  assert.match(src, /patch\.app_role = finalRole/);
  assert.match(src, /requested_role: target\.app_role/);
  assert.match(src, /assigned_role:/);
  // A rejection never rewrites app_role; status never comes from the body.
  assert.match(src, /decision\.status === 'ACTIVE' && finalRole && finalRole !== target\.app_role/);
  assert.doesNotMatch(src, /body\?\.status/);
  // Still ADMIN of the TARGET's stored school, PENDING only, never self.
  assert.match(src, /\{ user_id: user\.id, school_id: target\.school_id \}/);
  assert.match(src, /NOT_PENDING/);
  assert.match(src, /SELF_APPROVAL/);
  // Handing out ADMIN stays behind governRoleChange.
  assert.match(src, /finalRole === 'ADMIN' && decision\.status === 'ACTIVE' && !isPlatformOwner/);
});

test('Aprobaciones lets the admin choose the role and sends it', () => {
  const page = read('src/pages/Aprobaciones.jsx');
  assert.match(page, /APPROVABLE_ROLES\.map/);
  assert.match(page, /role: actionType === 'approve' \? chosenRole : undefined/);
  assert.deepEqual(APPROVABLE_ROLES, ['TEACHER', 'PARENT']);
  assert.equal(defaultApprovalRole('TEACHER'), 'TEACHER');
  assert.equal(defaultApprovalRole('ADMIN'), 'PARENT');
  assert.equal(defaultApprovalRole(undefined), 'PARENT');
});

test('a PENDING profile reads and writes nothing, and sees the waiting screen', () => {
  for (const f of ['base44/functions/schoolRead/_scope.ts', 'base44/functions/guardedEntityWrite/_policy.ts']) {
    assert.match(read(f), /profile\.status !== 'ACTIVE'\) return 'INACTIVE_PROFILE'/);
  }
  const home = read('src/pages/Home.jsx');
  assert.match(home, /userProfile\.status === 'PENDING'\) \{\s*return <PendingApproval \/>/);
  assert.match(read('src/components/ui/PendingApproval.jsx'), /Solicitud enviada/);
});

// Por qué importa: el QA en vivo (2026-10-01) vio que el admin aprobaba como
// Maestro y el perfil se quedaba Padre (el rol que PIDIÓ el solicitante). La
// causa fue una copia desplegada atrasada de approveProfile, no el código de
// main; este test fija el contrato para que el rol elegido nunca vuelva a
// perderse: el rol final sale de `body.role` ANTES que del rol pedido, se
// escribe en UserProfile.app_role y la respuesta lo devuelve (`appRole`), que
// es lo que el QA en vivo compara contra la llamada.
test('the role the approving admin chose is the one written and returned', () => {
  const src = read('base44/functions/approveProfile/entry.ts');
  assert.match(src, /const finalRole = decision\.status === 'ACTIVE' && rawRole \? String\(rawRole\) : String\(target\.app_role \|\| ''\);/);
  assert.match(src, /patch\.app_role = finalRole/);
  assert.match(src, /UserProfile\.update\(target\.id, patch\)/);
  assert.match(src, /appRole: decision\.status === 'ACTIVE' \? finalRole : target\.app_role/);
});

test('a PENDING or SUSPENDED profile gets no navigation rail (no FAMILIA menu beside the waiting screen)', () => {
  const nav = read('src/components/nav/NavContext.jsx');
  assert.match(nav, /profile\?\.status === 'PENDING' \|\| profile\?\.status === 'SUSPENDED'/);
  assert.match(nav, /const role = inactive \? null : profile\?\.app_role \|\| null;/);
});
