import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

// 2026-09-28: Base44's own security scan, re-run against the freshly
// redeployed code from this pass, found three real findings in the three
// service-role backend functions that write on a user's behalf. Deno isn't
// runnable in this sandbox (documented throughout CLAUDE.md), so — same
// convention as tests/unit/email-html-escaping.test.js's notifyParents
// checks — these assert the fix is present in the function's own source
// rather than exercising it at runtime.

test('guardedEntityWrite overrides attribution fields instead of trusting the client, on both create and update', () => {
  const source = read('base44/functions/guardedEntityWrite/entry.ts');
  assert.match(source, /const ATTRIBUTION_FIELDS: Record<string, \{ id: string; name\?: string \}> = \{/);
  for (const entityName of ['Attendance', 'PaymentRecord', 'DiaryEntry', 'Homework', 'Notice']) {
    assert.match(source, new RegExp(`${entityName}: \\{ id: '`), `expected an ATTRIBUTION_FIELDS entry for ${entityName}`);
  }
  // create: the field is SET from user.id/user.full_name, never read from body.data.
  assert.match(source, /data\[attribution\.id\] = user\.id;/);
  assert.match(source, /data\[attribution\.name\] = String\(user\.full_name \|\| ''\);/);
  // update: the field is DELETED from the patch, so an existing record's
  // attribution can't be reassigned to someone else after the fact.
  assert.match(source, /delete \(patch as Record<string, unknown>\)\[attribution\.id\];/);
});

test('guardedEntityWrite derives the PARENT/EVENTO ChargeItem carve-out\'s financial fields from the Event record, not the client', () => {
  const source = read('base44/functions/guardedEntityWrite/entry.ts');
  assert.match(source, /async function buildEventChargeData\(/);
  // The Event's own cost_amount, not body.data.amount, is what ends up on the record.
  assert.match(source, /amount: event\.cost_amount,/);
  assert.match(source, /status: 'PENDING',/);
  // The create handler uses buildEventChargeData's result outright instead of
  // spreading body.data when the carve-out granted access.
  assert.match(source, /const data: Record<string, unknown> = eventChargeData \?\? \{ \.\.\.\(body\.data \|\| \{\}\) \};/);
});

test('sendNotificationEmail locks new_user_pending to the caller\'s own identity and is idempotent PER RECIPIENT', () => {
  const source = read('base44/functions/sendNotificationEmail/entry.ts');
  // Only a genuinely PENDING profile may trigger it (not ACTIVE, not any role).
  assert.match(source, /const allowedStatuses = eventType === 'new_user_pending' \? \['PENDING'\] : \['ACTIVE'\];/);
  // userName/userEmail must match the authenticated caller, never free text.
  assert.match(source, /claimedName !== String\(user\.full_name \|\| ''\)/);
  assert.match(source, /claimedEmail !== String\(user\.email \|\| ''\)/);
  // roleName is derived server-side from the caller's own app_role, not templateContext.
  assert.match(source, /templateContext\.roleName = PENDING_ROLE_LABELS_ES\[String\(callerProfileRecord\?\.app_role\)\]/);
  // Idempotency keyed on the recipient email, not a single boolean/timestamp —
  // a Codex review on this fix's own PR caught that a single flag would let
  // the first successful send (to admin #1) block every other admin in the
  // same school from ever being notified.
  assert.match(source, /notifiedRecipients\.includes\(email\)/);
  assert.match(source, /pending_notification_recipients: \[\.\.\.notifiedRecipients, email\],/);
  assert.doesNotMatch(source, /pending_notification_sent_at/);
});

test('notifyParents retries only the parents a diary send actually failed for, not the whole entry', () => {
  const source = read('base44/functions/notifyParents/entry.ts');
  // Filters OUT already-notified recipients rather than gating the whole
  // record on one flag — a Codex review on this fix's own PR caught that a
  // record-level flag set after ANY successful send would permanently skip
  // retrying the parents whose send actually failed.
  assert.match(source, /const emails = allEmails\.filter\(\(e\) => !alreadyNotified\.includes\(e\)\);/);
  assert.match(source, /notified_parent_emails: \[\.\.\.alreadyNotified, \.\.\.newlyNotified\],/);
  assert.doesNotMatch(source, /if \(record\.parents_notified_at\) \{/);
});

test('the new idempotency-tracking fields are server-only (rls.write:false) and stripped from guarded client updates', () => {
  const diaryEntry = read('base44/entities/DiaryEntry.jsonc');
  assert.match(diaryEntry, /"notified_parent_emails":/);
  assert.match(diaryEntry, /"parents_notified_at":[\s\S]{0,600}?"write": false/);
  assert.match(diaryEntry, /"notified_parent_emails":[\s\S]{0,600}?"write": false/);

  const userProfile = read('base44/entities/UserProfile.jsonc');
  assert.match(userProfile, /"pending_notification_recipients":[\s\S]{0,600}?"write": false/);

  // guardedEntityWrite bypasses RLS with the service role, so the RLS lock
  // alone isn't enough — it must also strip these fields from a client
  // patch by hand (same defense-in-depth reasoning as the attribution
  // fields and school_id above them in the same function).
  const guardedEntityWrite = read('base44/functions/guardedEntityWrite/entry.ts');
  assert.match(guardedEntityWrite, /DiaryEntry: \['parents_notified_at', 'notified_parent_emails'\],/);
  assert.match(guardedEntityWrite, /for \(const field of SERVER_ONLY_UPDATE_FIELDS\[entity\] \|\| \[\]\) \{/);
});

// 2026-09-28, second scan (post-redeploy): a re-scan against the fixes
// above found a further CONFIRMED finding — school_id was tied to the
// caller's own profile, but student_id was never checked against it, so a
// record (Attendance, DiaryEntry, ...) could be created in the caller's own
// school while pointing at a student from a DIFFERENT school. notifyParents
// would then happily mail that foreign student's real parents.

test('guardedEntityWrite rejects a student_id that does not belong to the target school, on create and strips it on update', () => {
  const source = read('base44/functions/guardedEntityWrite/entry.ts');
  assert.match(source, /if \(!student \|\| String\(student\.school_id \|\| ''\) !== schoolId\) \{\s*\n\s*return bad\(400, 'STUDENT_NOT_IN_SCHOOL'/);
  assert.match(source, /delete \(patch as \{ student_id\?: unknown \}\)\.student_id;/);
});

test('notifyParents fails closed when the record\'s student is not in the record\'s own school', () => {
  const source = read('base44/functions/notifyParents/entry.ts');
  // Declared as a const arrow since deno lint (no-inner-declarations) runs in CI.
  assert.match(source, /(?:function assertStudentInSchool\(|const assertStudentInSchool = \()/);
  // Called on both the absence and diary paths, right after fetching the student.
  const calls = source.match(/assertStudentInSchool\(student, String\(record\.school_id \|\| ''\)\);/g) || [];
  assert.equal(calls.length, 2, 'expected assertStudentInSchool on both the absence and diary paths');
});
