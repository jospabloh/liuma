import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { indexMembers, memberEmail, memberName, UNKNOWN_EMAIL, UNKNOWN_NAME } from '../../src/lib/members/memberDirectory.js';
import {
  ACTION_LABELS,
  CHANGE_STATUS_LABELS,
  EFFECT_LABELS,
  OVERRIDE_RESOURCES,
  POLICY_ACTIONS,
  PRECEDENCE_LABELS,
  RESOURCE_LABELS,
  ROLE_LABELS,
} from '../../src/lib/authorization/permissionLabels.js';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// Sales-readiness audit F09 (2026-09-29): UserProfile has no name or email,
// and a client-side User.list() returns only the caller's own row — so every
// director saw "Sin nombre / Sin correo" for the people they were approving,
// and every emergency alert was mailed to `undefined`. None of this package's
// screens may go back to reading User from the browser.
const DIRECTORY_CONSUMERS = [
  'src/pages/Aprobaciones.jsx',
  'src/pages/GestionSalon.jsx',
  'src/pages/GestionAlumno.jsx',
  'src/pages/PermisosRoles.jsx',
  'src/pages/AlertaEmergencia.jsx',
  'src/lib/events/reminders.js',
];

test('no client User.list() left in the member-directory / notification screens', () => {
  for (const file of DIRECTORY_CONSUMERS) {
    assert.doesNotMatch(read(file), /entities\.User\.(list|filter)\(/, `${file} still reads User from the client`);
  }
  for (const file of DIRECTORY_CONSUMERS.slice(0, 4)) {
    assert.match(read(file), /useSchoolMembers\(userProfile\?\.school_id\)/, `${file} should use the member directory`);
  }
});

test('memberName prefers the name, then the email, never a row of identical blanks', () => {
  const index = indexMembers([
    { id: 'u1', full_name: 'Ana López', email: 'ana@x.mx' },
    { id: 'u2', full_name: '  ', email: 'beto@x.mx' },
    null,
    { full_name: 'no id' },
  ]);
  assert.equal(memberName(index, 'u1'), 'Ana López');
  assert.equal(memberName(index, 'u2'), 'beto@x.mx');
  assert.equal(memberName(index, 'missing'), UNKNOWN_NAME);
  assert.equal(memberEmail(index, 'u1'), 'ana@x.mx');
  assert.equal(memberEmail(index, 'missing'), UNKNOWN_EMAIL);
  assert.equal(memberName(indexMembers(null), 'u1'), UNKNOWN_NAME);
});

test('listSchoolMembers: caller must be an ACTIVE ADMIN/TEACHER of that school, and gets id/name/email only', () => {
  const source = read('base44/functions/listSchoolMembers/entry.ts');
  assert.match(source, /const DIRECTORY_ROLES = \['ADMIN', 'TEACHER'\];/);
  assert.match(source, /sr\.entities\.UserProfile\.filter\(\s*\{ user_id: user\.id, school_id: schoolId \}/);
  assert.match(source, /p\.status === 'ACTIVE' && DIRECTORY_ROLES\.includes/);
  // A teacher does not see who is pending approval.
  assert.match(source, /callerRole === 'ADMIN'\s*\? schoolProfiles\s*: schoolProfiles\.filter\(\(p\) => p\.status === 'ACTIVE'\)/);
  // Only these three fields leave the server.
  assert.match(source, /\(\{ id: String\(u\.id\), full_name: String\(u\.full_name \|\| ''\), email: String\(u\.email \|\| ''\) \}\)/);
});

test('approveProfile checks the ADMIN against the TARGET\'s stored school, PENDING only, never self', () => {
  const source = read('base44/functions/approveProfile/entry.ts');
  assert.match(source, /sr\.entities\.UserProfile\.get\(profileId\)/);
  assert.match(source, /\{ user_id: user\.id, school_id: target\.school_id \}/);
  assert.match(source, /p\.app_role === 'ADMIN' && p\.status === 'ACTIVE'/);
  assert.match(source, /if \(target\.status !== 'PENDING'\) return bad\(409, 'NOT_PENDING'/);
  assert.match(source, /if \(target\.user_id === user\.id\) return bad\(403, 'SELF_APPROVAL'/);
  assert.doesNotMatch(source, /body\?\.status/);
  // One director cannot activate an ADMIN through the approval queue.
  assert.match(source, /target\.app_role === 'ADMIN' && decision\.status === 'ACTIVE' && !isPlatformOwner/);

  const page = read('src/pages/Aprobaciones.jsx');
  assert.match(page, /functions\.invoke\('approveProfile', \{ profileId, decision \}\)/);
  assert.doesNotMatch(page, /UserProfile\.update\(/);
});

test('GestionSalon shows teacher assignment controls to ADMIN only', () => {
  const source = read('src/pages/GestionSalon.jsx');
  assert.match(source, /const canManageTeachers = userProfile\?\.app_role === 'ADMIN';/);
  assert.match(source, /\{canManageTeachers && \(\s*<Button[\s\S]*?Asignar/);
  assert.match(source, /\{canManageTeachers && \(\s*<Button[\s\S]*?Remover/);
  assert.match(source, /open=\{canManageTeachers && showTeacherForm\}/);
});

// Sales-readiness audit F20: "Permisos y Roles" showed customers developer
// notes, English keys and a template grid that saved nothing.
test('PermisosRoles has no developer text, no fake template grid, no raw English keys', () => {
  // What a customer can SEE: comments stripped (they may explain history).
  const source = read('src/pages/PermisosRoles.jsx')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of [/CLAUDE\.md/, /Module 7/, /maker-checker/i, /High-risk/, /Danger Zone/, /DEFAULT_TEMPLATE/, /handleTogglePermission/, /AI_CAPABILITIES/, />deny</, />allow</, />PARENT</, />TEACHER</, />ADMIN</, /override de permisos/i, /rollback controlado/i]) {
    assert.doesNotMatch(source, forbidden, `PermisosRoles.jsx still contains ${forbidden}`);
  }
  assert.match(source, /resourceLabel\(resource\)/);
  assert.match(source, /actionLabel\(action\)/);
  assert.match(source, /changeStatusLabel\(change\.status\)/);
});

test('every value PermisosRoles can render has a Spanish label', () => {
  for (const r of OVERRIDE_RESOURCES) assert.ok(RESOURCE_LABELS[r], `no label for resource ${r}`);
  for (const a of POLICY_ACTIONS) assert.ok(ACTION_LABELS[a], `no label for action ${a}`);
  for (const e of ['deny', 'allow']) assert.ok(EFFECT_LABELS[e]);
  for (const role of ['ADMIN', 'TEACHER', 'PARENT']) assert.ok(ROLE_LABELS[role]);
  for (const s of ['PENDING_ADMIN_APPROVAL', 'PENDING_SECOND_ADMIN_APPROVAL', 'APPROVED', 'REJECTED']) assert.ok(CHANGE_STATUS_LABELS[s]);
  for (const p of ['explicit_allow', 'explicit_deny', 'default_deny', 'override_allow', 'override_deny', 'owner_override']) assert.ok(PRECEDENCE_LABELS[p]);
  // The override form's resources are exactly the entities guardedEntityWrite gates.
  // POLICY_WRITE moved to the sibling _policy.ts in P7 (write-path hardening).
  const guarded = read('base44/functions/guardedEntityWrite/_policy.ts');
  for (const r of OVERRIDE_RESOURCES) assert.match(guarded, new RegExp(`\\n  ${r}: \\[`), `${r} is not in guardedEntityWrite's POLICY_WRITE`);
});
