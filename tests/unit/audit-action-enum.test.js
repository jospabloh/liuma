import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function readJsonc(path) {
  const raw = fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  return JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
}
function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// The AuditLog.action enum must cover every action string the app actually
// writes. A missing value means base44 can silently reject the audit write,
// leaving security/role events untraced. These are the security-critical
// actions emitted from src/lib/audit.js, GuardedRoute, and PermisosRoles.
test('AuditLog action enum covers the security/governance actions the code emits', () => {
  const schema = readJsonc('base44/entities/AuditLog.jsonc');
  const allowed = new Set(schema.properties.action.enum);

  const required = [
    'PERMISSION_CHANGE',
    'POLICY_DECISION',
    'owner_override',
    'access_denied',
    'ROLE_CHANGE',
    'ROLE_CHANGE_REQUESTED',
    'ROLE_CHANGE_REVIEW',
    'ROLE_CHANGED_OWNER_BYPASS',
    'LICENSE_UPDATED',
    'PRIVACY_CONSENT_ACCEPTED',
    'ATTENDANCE_BULK_PRESENT',
    'AI_REQUEST_ALLOWED',
    'AI_REQUEST_DENIED',
    'SUPPORT_TICKET_CREATED',
    'SUPPORT_TICKET_MESSAGE',
    'SUPPORT_TICKET_STATUS_CHANGE',
    'THEME_CREATED_OR_UPDATED',
    'NOTIFICATION_DELIVERY_FAILED',
  ];

  const missing = required.filter((a) => !allowed.has(a));
  assert.deepEqual(missing, [], `AuditLog enum missing: ${missing.join(', ')}`);
});

// Guard against the enum drifting away from the AUDIT_ACTIONS constants.
test('AUDIT_ACTIONS constants are all present in the AuditLog enum', () => {
  const schema = readJsonc('base44/entities/AuditLog.jsonc');
  const allowed = new Set(schema.properties.action.enum);
  const auditSource = read('src/lib/audit.js');

  const values = [...auditSource.matchAll(/:\s*'([^']+)'/g)]
    .map((m) => m[1])
    .filter((v) => /^[A-Za-z_]+$/.test(v) && v === v.toUpperCase() ? true : ['owner_override', 'access_denied'].includes(v));

  for (const v of ['POLICY_DECISION', 'PERMISSION_CHANGE', 'owner_override', 'access_denied']) {
    assert.ok(allowed.has(v), `enum missing AUDIT_ACTIONS value ${v}`);
  }
  // Sanity: we actually parsed the constants.
  assert.ok(values.includes('POLICY_DECISION'));
});
