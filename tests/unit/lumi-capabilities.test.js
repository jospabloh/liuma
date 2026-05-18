import test from 'node:test';
import assert from 'node:assert/strict';
import { LUMI_INTENTS, buildCapabilityRequest, evaluateCapabilityAccess, buildDeniedCapabilityResponse } from '../../src/lib/lumi/capabilities.js';
import { isLumiBubbleExcluded } from '../../src/lib/lumi/bubble-visibility.js';

test('denies unauthorized capability by role', () => {
  const request = buildCapabilityRequest({
    intent: LUMI_INTENTS.PAYMENT_REMINDERS,
    prompt: 'Pagos',
    userProfile: { app_role: 'TEACHER', school_id: 'school-a' },
  });
  const decision = evaluateCapabilityAccess({ intent: LUMI_INTENTS.PAYMENT_REMINDERS, request });
  assert.equal(decision.allowed, false);
});

test('enforces tenant scope for capability request', () => {
  const request = buildCapabilityRequest({
    intent: LUMI_INTENTS.ATTENDANCE_STATUS,
    prompt: 'Asistencia',
    userProfile: { app_role: 'ADMIN' },
  });
  const decision = evaluateCapabilityAccess({ intent: LUMI_INTENTS.ATTENDANCE_STATUS, request });
  assert.equal(decision.allowed, false);
  assert.equal(decision.denial.reason_code, 'missing_scope');
});

test('allows capability with valid scope', () => {
  const request = buildCapabilityRequest({
    intent: LUMI_INTENTS.HOMEWORK_LOOKUP,
    prompt: 'Tarea',
    userProfile: { app_role: 'PARENT', school_id: 'school-a', linked_students: [{ id: 'stu-1' }] },
    inputs: { student_id: 'stu-1' },
  });
  const decision = evaluateCapabilityAccess({ intent: LUMI_INTENTS.HOMEWORK_LOOKUP, request });
  assert.equal(decision.allowed, true);
});

test('hides bubble in reserved routes', () => {
  assert.equal(isLumiBubbleExcluded('/licenses'), true);
  assert.equal(isLumiBubbleExcluded('/trial/setup'), true);
  assert.equal(isLumiBubbleExcluded('/Home'), false);
});


test('returns safe alternative guidance for denied responses', () => {
  const denied = buildDeniedCapabilityResponse({
    intent: LUMI_INTENTS.PAYMENT_REMINDERS,
    denial: { safe_message: 'No autorizado.' },
  });
  assert.equal(typeof denied.safe_alternative, 'string');
  assert.equal(denied.safe_alternative.length > 0, true);
});
