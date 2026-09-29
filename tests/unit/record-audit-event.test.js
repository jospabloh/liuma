import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ACTION_TIER, decideAuditWrite, boundDetails } from '../../base44/functions/recordAuditEvent/_policy.ts';

function readJsonc(path) {
  const raw = fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  return JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
}

// P7 (2026-09-29, finding SEC-15): AuditLog create RLS was "data.user_id is
// you", so anyone could file 'USER_APPROVED' or 'ROLE_CHANGE' under any
// school — an audit trail anyone can write to proves nothing. Client rows
// now go through recordAuditEvent, which requires a profile in the school
// and a role that can actually perform the action.

const active = (app_role) => [{ app_role, status: 'ACTIVE' }];

test('a caller with no profile in the school cannot write to its log', () => {
  const d = decideAuditWrite({ action: 'SUPPORT_TICKET_CREATED', isPlatformOwner: false, profiles: [] });
  assert.equal(d.ok, false);
  assert.equal(d.code, 'NO_PROFILE');
});

test('a parent cannot log an admin decision; the admin can', () => {
  assert.equal(decideAuditWrite({ action: 'USER_APPROVED', isPlatformOwner: false, profiles: active('PARENT') }).code, 'ROLE_NOT_ALLOWED');
  assert.equal(decideAuditWrite({ action: 'ROLE_CHANGE', isPlatformOwner: false, profiles: active('TEACHER') }).ok, false);
  assert.equal(decideAuditWrite({ action: 'USER_APPROVED', isPlatformOwner: false, profiles: active('ADMIN') }).ok, true);
  assert.equal(decideAuditWrite({ action: 'NOTICE_SENT', isPlatformOwner: false, profiles: active('TEACHER') }).ok, true);
  assert.equal(decideAuditWrite({ action: 'NOTICE_SENT', isPlatformOwner: false, profiles: active('PARENT') }).ok, false);
});

test('a PENDING user can record their own onboarding consent but nothing that needs approval', () => {
  const pending = [{ app_role: 'TEACHER', status: 'PENDING' }];
  assert.equal(decideAuditWrite({ action: 'PRIVACY_CONSENT_ACCEPTED', isPlatformOwner: false, profiles: pending }).ok, true);
  assert.equal(decideAuditWrite({ action: 'AI_REQUEST_ALLOWED', isPlatformOwner: false, profiles: pending }).code, 'NO_ACTIVE_PROFILE');
});

test('the server\'s own RECORD_* rows can never come from a client, not even the platform owner', () => {
  for (const action of ['RECORD_CREATED', 'RECORD_UPDATED', 'RECORD_DELETED']) {
    assert.equal(decideAuditWrite({ action, isPlatformOwner: true, profiles: [] }).code, 'SERVER_ONLY_ACTION');
  }
  assert.equal(decideAuditWrite({ action: 'MADE_UP', isPlatformOwner: true, profiles: [] }).code, 'UNKNOWN_ACTION');
});

test('every AuditLog action has a tier, and every tier names a real action', () => {
  // A new enum value without a tier would be refused as UNKNOWN_ACTION at
  // runtime; a tier without an enum value would be refused by Base44.
  const schema = readJsonc('base44/entities/AuditLog.jsonc');
  const enumValues = new Set(schema.properties.action.enum);
  assert.deepEqual([...enumValues].filter((a) => !(a in ACTION_TIER)), []);
  assert.deepEqual(Object.keys(ACTION_TIER).filter((a) => !enumValues.has(a)), []);
});

test('details are bounded so the log is not free storage', () => {
  assert.deepEqual(boundDetails({ a: 1 }), { a: 1 });
  assert.equal(boundDetails({ big: 'x'.repeat(20000) }).truncated, true);
  assert.equal(boundDetails(null), null);
});
