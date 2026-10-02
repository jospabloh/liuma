import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Codex review of PR #197 (round 3) kept finding compensating writes that
// were assumed to succeed and bounded steps that reported the remainder as
// done. The behavioural tests live next to each feature
// (account-deletion, upload-school-file, student-quota-server,
// payments-concurrency); these pin the two Deno-only paths that node cannot
// run (Deno.serve), by source.

const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

test('a duplicate absence that cannot be deleted is retried, then REJECTED (not live), and only then unresolved', () => {
  const src = read('base44/functions/guardedFamilyWrite/entry.ts');
  const block = src.slice(src.indexOf('if (absenceRaceLoser('), src.indexOf("return bad(409, 'ABSENCE_DUPLICATE'"));
  assert.match(block, /for \(let i = 0; i < 2; i \+= 1\)/, 'retried');
  assert.match(block, /AbsenceNotification\.delete\(id\)/);
  assert.match(block, /AbsenceNotification\.update\(id, \{ status: 'REJECTED'/, 'falls back to a state that is not live');
  assert.ok(block.indexOf("'ABSENCE_CONFLICT_UNRESOLVED'") > block.indexOf("status: 'REJECTED'"), 'unresolved only after both');
  // REJECTED is what checkAbsenceRequest lets a family send again for.
  assert.match(read('base44/entities/AbsenceNotification.jsonc'), /"REJECTED"/);
});

test('a bulk send cut at MAX_RECIPIENTS reports the whole list as its total, never the slice', () => {
  const src = read('base44/functions/sendBulkNotification/entry.ts');
  assert.match(src, /total: plan\.recipients\.length, reached: 0/);
  assert.match(src, /notAttempted: plan\.recipients\.length - recipients\.length/);
  assert.doesNotMatch(src, /total: recipients\.length/);
});
