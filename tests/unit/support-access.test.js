import test from 'node:test';
import assert from 'node:assert/strict';

import { canReadEntity, canWriteEntity } from '../../src/lib/authorization/policy.js';
import { canAccessRoute } from '../../src/lib/authorization/routeAccess.js';
import {
  LUMI_INTENTS,
  CAPABILITY_RULES,
  buildCapabilityRequest,
  evaluateCapabilityAccess,
} from '../../src/lib/lumi/capabilities.js';
import { isPlatformOwner } from '../../src/lib/support/owner.js';

// --- Entity policy --------------------------------------------------------

test('every in-school role can read and open support tickets', () => {
  for (const role of ['ADMIN', 'TEACHER', 'PARENT']) {
    assert.equal(canReadEntity(role, 'SupportTicket'), true, `${role} read ticket`);
    assert.equal(canWriteEntity(role, 'SupportTicket'), true, `${role} write ticket`);
    assert.equal(canReadEntity(role, 'SupportTicketMessage'), true, `${role} read message`);
    assert.equal(canWriteEntity(role, 'SupportTicketMessage'), true, `${role} write message`);
  }
});

// --- Route access ---------------------------------------------------------

test('the support page is reachable by all roles', () => {
  for (const role of ['ADMIN', 'TEACHER', 'PARENT']) {
    assert.equal(canAccessRoute({ role, routeName: 'Soporte' }), true);
  }
});

test('the management console is admin-only', () => {
  assert.equal(canAccessRoute({ role: 'ADMIN', routeName: 'SoporteAdmin' }), true);
  assert.equal(canAccessRoute({ role: 'TEACHER', routeName: 'SoporteAdmin' }), false);
  assert.equal(canAccessRoute({ role: 'PARENT', routeName: 'SoporteAdmin' }), false);
});

// --- Lumi L0 deflection capability ----------------------------------------

test('a support capability rule is registered for Lumi', () => {
  const rule = CAPABILITY_RULES[LUMI_INTENTS.SUPPORT_REQUEST];
  assert.ok(rule, 'SUPPORT_REQUEST rule exists');
  assert.equal(rule.entity, 'SupportTicket');
  assert.deepEqual(rule.allowed_roles, ['ADMIN', 'TEACHER', 'PARENT']);
});

test('a scoped parent is allowed to request support via Lumi', () => {
  const request = buildCapabilityRequest({
    intent: LUMI_INTENTS.SUPPORT_REQUEST,
    prompt: 'No puedo entrar a la app',
    userProfile: { app_role: 'PARENT', school_id: 'school-1', linked_students: [] },
  });
  const access = evaluateCapabilityAccess({ intent: LUMI_INTENTS.SUPPORT_REQUEST, request });
  assert.equal(access.allowed, true);
});

test('a request without tenant scope is denied a safe message', () => {
  const request = buildCapabilityRequest({
    intent: LUMI_INTENTS.SUPPORT_REQUEST,
    prompt: 'Ayuda',
    userProfile: { app_role: 'PARENT', school_id: null },
  });
  const access = evaluateCapabilityAccess({ intent: LUMI_INTENTS.SUPPORT_REQUEST, request });
  assert.equal(access.allowed, false);
  assert.ok(access.denial.safe_message);
});

// --- Platform-owner detection (cross-tenant support queue) -----------------

test('is_super_admin profile is recognized as the platform owner', () => {
  assert.equal(isPlatformOwner({ userProfile: { is_super_admin: true } }), true);
});

test('Base44 User.role admin is the fallback owner signal when is_super_admin is absent', () => {
  assert.equal(isPlatformOwner({ userProfile: { app_role: 'ADMIN' }, user: { role: 'admin' } }), true);
});

test('a regular school director is not the platform owner', () => {
  assert.equal(isPlatformOwner({ userProfile: { app_role: 'ADMIN' }, user: { role: 'user' } }), false);
  assert.equal(isPlatformOwner({ userProfile: {}, user: {} }), false);
  assert.equal(isPlatformOwner({}), false);
});
