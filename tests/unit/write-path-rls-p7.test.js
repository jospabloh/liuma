import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('../../', import.meta.url);

function readJsonc(rel) {
  const raw = fs.readFileSync(new URL(rel, ROOT), 'utf8');
  return JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
}

const PLATFORM_ONLY = { user_condition: { role: 'admin' } };

// P7 (2026-09-29). Each of these entities had a direct-SDK write rule that
// only checked "this record is attributed to you" — never the school, the
// role, the student link, or the billing gate. Their writes now go through a
// backend function (service role), and the RLS rule is the platform/service
// role alone. If one of these ever goes back to an "$or: [self, admin]"
// shape, the function's checks become advisory again.
const SERVICE_ROLE_WRITES = {
  Notice: ['create', 'update'], // guardedEntityWrite
  Homework: ['create', 'update'],
  Attendance: ['create', 'update'],
  DiaryEntry: ['create', 'update'],
  EmergencyContact: ['create', 'update', 'delete'], // guardedFamilyWrite
  AbsenceNotification: ['create', 'update'],
  EventResponse: ['create', 'update'],
  UniformOrder: ['create', 'update'],
  SupportTicketMessage: ['create'], // postTicketMessage
  AuditLog: ['create'], // recordAuditEvent + server functions
  // provisionOnboardingProfile; update since the P10 review (schoolRead scopes a
  // school by this row, so it must not rest on per-field locks) — the welcome
  // flag goes through markWelcomeShown.
  UserProfile: ['create', 'update'],
};

for (const [entity, ops] of Object.entries(SERVICE_ROLE_WRITES)) {
  test(`${entity} ${ops.join('/')} is service-role only`, () => {
    const schema = readJsonc(`base44/entities/${entity}.jsonc`);
    for (const op of ops) assert.deepEqual(schema.rls[op], PLATFORM_ONLY, `${entity}.rls.${op}`);
  });
}

test('UserProfile fields that decide access are locked to the service role', () => {
  // status: a PENDING user self-approving. school_id: an ADMIN of school A
  // moving into school B and exporting it. user_id: handing a profile to
  // someone else. is_super_admin: unlocking the owner UI on oneself.
  const schema = readJsonc('base44/entities/UserProfile.jsonc');
  for (const field of ['user_id', 'school_id', 'status', 'onboarding_completed', 'app_role', 'is_super_admin']) {
    assert.deepEqual(schema.properties[field]?.rls?.write, PLATFORM_ONLY, `UserProfile.${field}`);
  }
  // No per-field lock on what a user legitimately edits (through a function:
  // the entity-level update is service-role only since the P10 review).
  for (const field of ['phone', 'photo_url', 'welcome_message_shown']) {
    assert.equal(schema.properties[field]?.rls, undefined, `UserProfile.${field} should stay self-writable`);
  }
});

test('User declares no required fields (both are write:false, nobody could ever provide them)', () => {
  const schema = readJsonc('base44/entities/User.jsonc');
  assert.deepEqual(schema.required, []);
});

// The client must not call the direct SDK writes RLS now refuses: each would
// fail at runtime for every non-owner user.
function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

// Known, documented exceptions — each already failed for everyone but the
// platform owner BEFORE P7 (their old rule was "parent_id is you", or the
// Notice had no author_id), so P7 changes nothing for them. They belong to
// other packages; keep this list shrinking, never growing.
const KNOWN_EXCEPTIONS = [
  // School-side review screens: need the tenant read/write model (P10).
  'src/pages/GestionAusencias.jsx: AbsenceNotification.update',
  'src/pages/GestionPedidosAdmin.jsx: UniformOrder.update',
  // Approving another user's profile (status): a school ADMIN could never
  // update someone else's UserProfile under the own-row rule, and status is
  // now field-locked. P8's approveProfile function replaces this call.
  'src/pages/Aprobaciones.jsx: UserProfile.update',
  // In-app per-user notice (scope 'USER', no author): replaced by P8's
  // server-side fan-out.
  'src/lib/notifications/service.js: Notice.create',
];

test('no client code writes the locked entities directly', () => {
  const srcDir = new URL('src/', ROOT).pathname;
  const pattern = /entities\.(Notice|Homework|Attendance|DiaryEntry|EmergencyContact|AbsenceNotification|EventResponse|UniformOrder|SupportTicketMessage|AuditLog|UserProfile)\.(create|update|delete|bulkCreate)\(/g;
  const found = [];
  for (const file of walk(srcDir)) {
    if (file.includes(`${path.sep}testData${path.sep}`)) continue; // seeding tool, runs as the owner
    // P6's testable mirror of provisionOnboardingProfile/entry.ts: it receives
    // the SERVICE-ROLE entities as a parameter and is imported only by tests,
    // never by the client bundle.
    if (file.endsWith(`authorization${path.sep}onboardingProvision.js`)) continue;
    const rel = path.relative(new URL('.', ROOT).pathname, file);
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(pattern)) {
      const hit = `${rel}: ${m[1]}.${m[2]}`;
      if (!KNOWN_EXCEPTIONS.includes(hit)) found.push(hit);
    }
  }
  assert.deepEqual(found, []);
});
