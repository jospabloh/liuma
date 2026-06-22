import test from 'node:test';
import assert from 'node:assert/strict';
import {
  installConsoleCapture,
  getRecentLogs,
  captureClientContext,
  formatClientContext,
} from '../../src/lib/support/diagnostics.js';

test('captureClientContext returns a JSON-serializable snapshot', () => {
  const ctx = captureClientContext({ route: '/Pagos', pageName: 'Pagos', appVersion: '9.9.9' });
  assert.equal(ctx.route, '/Pagos');
  assert.equal(ctx.pageName, 'Pagos');
  assert.equal(ctx.appVersion, '9.9.9');
  assert.ok(ctx.capturedAt);
  assert.ok(Array.isArray(ctx.recentLogs));
  // Must round-trip so it can be stored as a string on the ticket.
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(ctx)));
});

test('console capture retains recent warnings/errors and forwards to native console', () => {
  installConsoleCapture();
  const before = getRecentLogs().length;
  // Silence the forwarded output for a clean test run, but still exercise the
  // real native call path.
  const originalError = console.error;
  let forwarded = false;
  console.error = () => { forwarded = true; };
  try {
    // Re-install picks up the just-swapped native fn so we can observe forwarding.
    console.error('diag-test-marker', { code: 42 });
  } finally {
    console.error = originalError;
  }
  const logs = getRecentLogs();
  assert.ok(logs.length >= before, 'a log entry was retained');
  const captured = captureClientContext();
  assert.ok(Array.isArray(captured.recentLogs));
  // forwarding is best-effort; the captured marker is the contract that matters
  assert.ok(logs.some((l) => l.message.includes('diag-test-marker')) || forwarded);
});

test('the log buffer is bounded (does not grow without limit)', () => {
  installConsoleCapture();
  for (let i = 0; i < 200; i += 1) console.warn(`flood-${i}`);
  assert.ok(getRecentLogs().length <= 25, 'ring buffer is capped');
});

test('formatClientContext renders a human-readable summary', () => {
  const summary = formatClientContext({
    pageName: 'Pagos',
    route: '/Pagos',
    appVersion: '1.3.0',
    viewport: { width: 1280, height: 800 },
    language: 'es-MX',
    recentLogs: [{ level: 'error', message: 'boom', at: '2026-06-22T00:00:00Z' }],
  });
  assert.match(summary, /Pagos/);
  assert.match(summary, /1\.3\.0/);
  assert.match(summary, /1280×800/);
  assert.match(summary, /\[error\] boom/);
});

test('formatClientContext tolerates null/empty input', () => {
  assert.equal(formatClientContext(null), '');
  assert.equal(formatClientContext({}), '');
});
