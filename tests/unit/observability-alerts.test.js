import test from 'node:test';
import assert from 'node:assert/strict';
import { getAlertRule } from '../../src/lib/observability/alertRules.js';

test('owner-denied alert groups repeated denials by actor, route, tenant, and reason so lockouts page before rollout expands', () => {
  const rule = getAlertRule('owner-denied-repeated');

  assert.equal(rule.signal, 'logs.access_denied');
  assert.deepEqual(rule.condition.where, { owner_denied: true });
  assert.deepEqual(rule.condition.groupBy, ['tenant_id', 'actor', 'route', 'owner_reason']);
  assert.equal(rule.condition.threshold, 3);
  assert.equal(rule.condition.windowMinutes, 10);
  assert.equal(rule.severity, 'high');
});

test('tenant-creation alert fires on sustained failure rate with enough attempts to catch onboarding blockers', () => {
  const rule = getAlertRule('tenant-creation-failure-rate');

  assert.equal(rule.signal, 'logs.tenant_creation_failed');
  assert.equal(rule.condition.thresholdPercent, 20);
  assert.equal(rule.condition.minimumAttempts, 5);
  assert.equal(rule.condition.windowMinutes, 10);
  assert.equal(rule.severity, 'blocker');
});
