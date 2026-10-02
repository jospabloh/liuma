import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeFakeDb } from '../fixtures/fake-entity-db.js';
import {
  CONFIRMATION_AUDIT_TARGET,
  CONFIRMATION_TTL_SECONDS,
  checkConfirmationCode,
  claimConfirmationCode,
  confirmationCode,
  errorMessage,
  releaseConfirmationCode,
} from '../../base44/functions/lumiWrite/_lumiCore.ts';

// v1.9.0 (server-minor). lumiWrite's confirmation code was a digest of
// (who, what, which student, which day): a safeguard against the model
// skipping the preview, but not single-use. Repeating a commit the same day
// re-applied it — and replaying "Juan ausente" after the teacher had fixed
// Juan to "presente" in Asistencia silently undid the fix. Codes now expire
// after 10 minutes and commit once.

const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const T0 = 1_790_000_000; // seconds
const parts = { userId: 'u-teacher', kind: 'attendance', studentId: 's1', data: { status: 'absent', date: '2026-10-02' } };

test('a fresh code for exactly this write is accepted; anything else needs a new preview', async () => {
  const code = await confirmationCode({ ...parts, issuedAt: T0 });
  assert.equal(await checkConfirmationCode(code, parts, T0 + 5), 'ok');
  assert.equal(await checkConfirmationCode(code, { ...parts, studentId: 's2' }, T0 + 5), 'NEEDS_CONFIRMATION', 'another student');
  assert.equal(await checkConfirmationCode(code, { ...parts, data: { ...parts.data, status: 'present' } }, T0 + 5), 'NEEDS_CONFIRMATION', 'other data');
  assert.equal(await checkConfirmationCode(code, { ...parts, userId: 'u-other' }, T0 + 5), 'NEEDS_CONFIRMATION', 'another user');
  assert.equal(await checkConfirmationCode(code, { ...parts, kind: 'diary' }, T0 + 5), 'NEEDS_CONFIRMATION', 'another kind');
  for (const junk of [undefined, '', 'abc', code.toUpperCase(), `${code}x`]) {
    assert.equal(await checkConfirmationCode(junk, parts, T0 + 5), 'NEEDS_CONFIRMATION', String(junk));
  }
});

test('the code expires after 10 minutes, and its time cannot be edited to look fresh', async () => {
  const code = await confirmationCode({ ...parts, issuedAt: T0 });
  assert.equal(CONFIRMATION_TTL_SECONDS, 600);
  assert.equal(await checkConfirmationCode(code, parts, T0 + 600), 'ok');
  assert.equal(await checkConfirmationCode(code, parts, T0 + 601), 'CODE_EXPIRED');
  // Moving the stamp forward breaks the digest: not "expired", simply not a code.
  const [, digest] = code.split('-');
  const forged = `${(T0 + 590).toString(36)}-${digest}`;
  assert.equal(await checkConfirmationCode(forged, parts, T0 + 700), 'NEEDS_CONFIRMATION');
  // A code stamped well in the future is not one this server issued.
  const future = await confirmationCode({ ...parts, issuedAt: T0 + 3600 });
  assert.equal(await checkConfirmationCode(future, parts, T0), 'NEEDS_CONFIRMATION');
});

const claimArgs = (code) => ({ code, userId: 'u-teacher', userEmail: 't@a.mx', schoolId: 'sA', kind: 'attendance', studentId: 's1' });

test('a code commits once: the second commit is CODE_USED', async () => {
  const db = makeFakeDb({ AuditLog: [] });
  const code = await confirmationCode({ ...parts, issuedAt: T0 });
  const first = await claimConfirmationCode(db, claimArgs(code));
  assert.ok(first, 'the first commit claims the code');
  assert.equal(await claimConfirmationCode(db, claimArgs(code)), null, 'the second is refused');
  const rows = await db.entities.AuditLog.filter({ target_type: CONFIRMATION_AUDIT_TARGET, target_id: code });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].school_id, 'sA');
  assert.equal(rows[0].action, 'AI_REQUEST_ALLOWED');
});

test('two commits racing with the same code: exactly one gets through', async () => {
  const db = makeFakeDb({ AuditLog: [] });
  const code = await confirmationCode({ ...parts, issuedAt: T0 });
  const results = await Promise.all([claimConfirmationCode(db, claimArgs(code)), claimConfirmationCode(db, claimArgs(code))]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(db.writes.filter((w) => w.entity === 'AuditLog' && w.op === 'create').length, 2, 'both passed the first look — a real race');
  const rows = await db.entities.AuditLog.filter({ target_type: CONFIRMATION_AUDIT_TARGET, target_id: code });
  assert.equal(rows.length, 1, 'the loser removes its own claim');
});

test('a commit whose write failed gives the code back, so a retry works', async () => {
  const db = makeFakeDb({ AuditLog: [] });
  const code = await confirmationCode({ ...parts, issuedAt: T0 });
  const claim = await claimConfirmationCode(db, claimArgs(code));
  await releaseConfirmationCode(db, claim);
  assert.ok(await claimConfirmationCode(db, claimArgs(code)));
});

test('another user\'s claim of the same string does not burn mine (claims are per user)', async () => {
  const db = makeFakeDb({ AuditLog: [] });
  const code = await confirmationCode({ ...parts, issuedAt: T0 });
  assert.ok(await claimConfirmationCode(db, { ...claimArgs(code), userId: 'u-someone' }));
  assert.ok(await claimConfirmationCode(db, claimArgs(code)));
});

test('Lumi gets a Spanish reason it can relay for both refusals', () => {
  assert.match(errorMessage('CODE_USED'), /ya se registró con esta confirmación/);
  assert.match(errorMessage('CODE_EXPIRED'), /caducó \(dura 10 minutos\)/);
  for (const code of ['CODE_USED', 'CODE_EXPIRED']) assert.match(errorMessage(code), /resumen/, 'it says what to do next');
  const agent = JSON.parse(read('base44/agents/lumi.jsonc').replace(/^\s*\/\/.*$/gm, ''));
  assert.match(agent.instructions, /El código sirve una sola vez y caduca a los 10 minutos/);
});

test('lumiWrite: check → claim → write, and every failed write releases the claim', () => {
  const src = read('base44/functions/lumiWrite/entry.ts');
  const check = src.indexOf('await checkConfirmationCode(');
  const claim = src.indexOf('await claimConfirmationCode(');
  const write = src.indexOf("functions.invoke('guardedEntityWrite'");
  assert.ok(check > 0 && check < claim && claim < write, 'the code is checked and claimed before anything is written');
  assert.equal((src.match(/await releaseConfirmationCode\(sr, claimId\)/g) || []).length, 2, 'both failure paths release');
  assert.match(src, /confirmation_expires_in_minutes: CONFIRMATION_TTL_SECONDS \/ 60/);
  assert.doesNotMatch(src, /day: today/, 'the old per-day code is gone');
});

test('_lumiCore.ts is still byte-identical in lumiQuery and lumiWrite', () => {
  assert.equal(read('base44/functions/lumiQuery/_lumiCore.ts'), read('base44/functions/lumiWrite/_lumiCore.ts'));
});
