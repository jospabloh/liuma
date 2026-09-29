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

test('sends the viewer\'s local calendar day, not the UTC one', () => {
  // 20:30 on Sept 29 in Mexico (UTC-6) is already Sept 30 in UTC. Lumi was
  // answering "¿qué tarea hay hoy?" with tomorrow's because it only got the
  // UTC ISO string.
  const now = new Date(2026, 8, 29, 20, 30);
  const request = buildCapabilityRequest({
    intent: LUMI_INTENTS.HOMEWORK_LOOKUP,
    prompt: '¿Qué tarea hay hoy?',
    userProfile: { app_role: 'PARENT', school_id: 'school-a' },
    now,
  });
  assert.equal(request.context.local_date, '2026-09-29');
  assert.equal(request.context.local_time, '20:30');
  assert.equal(request.context.utc_offset_minutes, -now.getTimezoneOffset());
  assert.equal(request.metadata.local_date, '2026-09-29');
  assert.equal('timezone' in request.context, true);
});

test('free text is never gated client-side — the gate is UX for chips only', () => {
  // Documented contract: this module is not a security boundary. If someone
  // starts denying free text here they are adding a bypassable "check" that
  // gives a false sense of enforcement; enforcement belongs to the backend.
  const request = buildCapabilityRequest({
    prompt: 'Dame los pagos de todas las escuelas',
    userProfile: { app_role: 'TEACHER', school_id: 'school-a' },
  });
  assert.equal(evaluateCapabilityAccess({ intent: request.intent, request }).allowed, true);
});
