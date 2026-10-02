import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeFakeMongoDb } from '../fixtures/fake-mongo-db.js';
// The real function code, loaded as-is (Node 22 strips the TS types).
import {
  ANONYMIZE,
  ANONYMIZED_NAME,
  CONFIRMATION_WORD as SERVER_WORD,
  PURGE_DAYS as SERVER_PURGE_DAYS,
  confirmationMatches as serverConfirms,
  previewDeletion,
  runAccountDeletion,
  soleAdminSchoolIds,
} from '../../base44/functions/deleteMyAccount/_deletion.ts';
import { consentStatus, profileConsentIsCurrent as serverStampIsCurrent } from '../../base44/functions/myConsent/_consent.ts';
import { ACTION_TIER } from '../../base44/functions/recordAuditEvent/_policy.ts';
import {
  ACCOUNT_DELETION_PAGE,
  ACCOUNT_DELETION_PATH,
  ACCOUNT_DELETION_TITLE,
  CONFIRMATION_WORD,
  accountDeletedAt,
  confirmationMatches,
  deletedItems,
  deletionErrorMessage,
  keptItems,
} from '../../src/lib/account/accountDeletion.js';
import { ACCOUNT_DELETION_LABEL, PRIVACY_NOTICE, SERVICE_TERMS, PURGE_DAYS, RETENTION_TABLE } from '../../src/lib/legal/legalDocs.js';
import { runOnboardingProvision } from '../../src/lib/authorization/onboardingProvision.js';
import { getDestinations, ROLES } from '../../src/components/nav/navRegistry.js';
import { ROUTE_ACCESS } from '../../src/lib/authorization/routeAccess.js';

// "Eliminar mi cuenta y mis datos" (v1.9.0). The owner's request: a person who
// declines the new legal texts is sent to "la página de borrar cuenta y sus
// datos en la zona de peligro, con la posibilidad de retractarse o confirmar".
// The legal texts promise exactly what is deleted and what the school keeps;
// these tests run the real deletion (deleteMyAccount/_deletion.ts) against an
// in-memory database and pin each promise, and pin who can NOT do it.

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, ROOT), 'utf8');
const readJsonc = (rel) => JSON.parse(read(rel).replace(/^\s*\/\/.*$/gm, ''));
const NOW = new Date('2026-10-02T18:00:00.000Z');

const USERS = {
  parent: { id: 'u-parent', email: 'Mama@Ejemplo.mx', full_name: 'Mamá' },
  otherParent: { id: 'u-other', email: 'otro@ejemplo.mx' },
  teacher: { id: 'u-teacher', email: 'maestra@ejemplo.mx' },
  admin: { id: 'u-admin', email: 'dir@ejemplo.mx' },
  admin2: { id: 'u-admin2', email: 'dir2@ejemplo.mx' },
  owner: { id: 'u-owner', role: 'admin', email: 'owner@liuma.mx' },
};

const profile = (id, userId, role, status = 'ACTIVE', schoolId = 'sA', extra = {}) => ({
  id, user_id: userId, school_id: schoolId, app_role: role, status, onboarding_completed: true, created_date: '2026-09-01T00:00:00Z',
  consent_notice_version: '2026-10-02', consent_terms_version: '2026-10-02', ...extra,
});

function world({ withSecondAdmin = false, pendingSecondAdmin = false } = {}) {
  const sent = [];
  const tables = {
    User: [
      { id: 'u-parent', email: 'Mama@Ejemplo.mx', display_name: 'Mamá Pérez' },
      { id: 'u-other', email: 'otro@ejemplo.mx' },
      { id: 'u-teacher', email: 'maestra@ejemplo.mx' },
      { id: 'u-admin', email: 'dir@ejemplo.mx' },
    ],
    School: [{ id: 'sA', name: 'Colegio A' }, { id: 'sB', name: 'Colegio B' }],
    UserProfile: [
      profile('p-parent', 'u-parent', 'PARENT'),
      profile('p-other', 'u-other', 'PARENT'),
      profile('p-teacher', 'u-teacher', 'TEACHER'),
      profile('p-admin', 'u-admin', 'ADMIN', 'ACTIVE', 'sA', { pending_notification_recipients: ['dir@ejemplo.mx'] }),
      profile('p-adminB', 'u-adminB', 'ADMIN', 'ACTIVE', 'sB'),
      ...(withSecondAdmin ? [profile('p-admin2', 'u-admin2', 'ADMIN')] : []),
      ...(pendingSecondAdmin ? [profile('p-admin2', 'u-admin2', 'ADMIN', 'PENDING')] : []),
      // A newcomer whose approval notice reached the parent's address? No —
      // the director's: pending_notification_recipients holds ADMIN e-mails.
      profile('p-new', 'u-new', 'TEACHER', 'PENDING', 'sA', { pending_notification_recipients: ['dir@ejemplo.mx', 'dir2@ejemplo.mx'] }),
    ],
    ParentProfile: [{ id: 'pp1', user_id: 'u-parent', school_id: 'sA', address: 'Calle 1', work_phone: '449' }, { id: 'pp2', user_id: 'u-other', school_id: 'sA', address: 'Calle 2' }],
    ParentStudent: [
      { id: 'ps1', school_id: 'sA', parent_id: 'u-parent', student_id: 'st1', status: 'ACTIVE' },
      { id: 'ps2', school_id: 'sA', parent_id: 'u-other', student_id: 'st1', status: 'ACTIVE' },
    ],
    TeacherClassroom: [
      { id: 'tc1', school_id: 'sA', teacher_id: 'u-teacher', classroom_id: 'c1', is_active: true },
      { id: 'tc2', school_id: 'sA', teacher_id: 'u-x', classroom_id: 'c1', is_active: true },
    ],
    AbsenceNotification: [
      { id: 'ab-pending', school_id: 'sA', parent_id: 'u-parent', parent_name: 'Mamá Pérez', status: 'PENDING' },
      { id: 'ab-approved', school_id: 'sA', parent_id: 'u-parent', parent_name: 'Mamá Pérez', status: 'APPROVED' },
      { id: 'ab-other', school_id: 'sA', parent_id: 'u-other', parent_name: 'Otro', status: 'PENDING' },
    ],
    UniformOrder: [
      { id: 'uo-pending', school_id: 'sA', parent_id: 'u-parent', parent_name: 'Mamá Pérez', status: 'PENDING' },
      { id: 'uo-delivered', school_id: 'sA', parent_id: 'u-parent', parent_name: 'Mamá Pérez', status: 'DELIVERED' },
    ],
    EventResponse: [{ id: 'er1', school_id: 'sA', parent_id: 'u-parent', parent_name: 'Mamá Pérez', response: 'YES' }],
    ChargeItem: [{ id: 'ch1', school_id: 'sA', student_id: 'st1', amount: 1350, amount_paid: 400, status: 'PARTIAL' }],
    PaymentRecord: [{ id: 'pr1', school_id: 'sA', charge_item_id: 'ch1', amount: 400, recorded_by: 'u-admin' }],
    DiaryEntry: [
      { id: 'd1', school_id: 'sA', teacher_id: 'u-teacher', teacher_name: 'Maestra Ana', notified_parent_emails: ['mama@ejemplo.mx', 'otro@ejemplo.mx'] },
      { id: 'd2', school_id: 'sA', teacher_id: 'u-x', teacher_name: 'Otra maestra', notified_parent_emails: ['otro@ejemplo.mx'] },
    ],
    Homework: [{ id: 'h1', school_id: 'sA', teacher_id: 'u-teacher', teacher_name: 'Maestra Ana' }],
    Notice: [{ id: 'n1', school_id: 'sA', author_id: 'u-teacher', author_name: 'Maestra Ana' }, { id: 'n2', school_id: 'sA', author_id: 'u-admin', author_name: 'Directora' }],
    Attendance: [{ id: 'at1', school_id: 'sA', recorded_by: 'u-teacher', recorded_by_name: 'Maestra Ana' }],
    OfficialDocument: [{ id: 'od1', school_id: 'sA', uploaded_by: 'u-admin', uploaded_by_name: 'Directora' }],
    SupportTicket: [
      { id: 't1', school_id: 'sA', requester_user_id: 'u-parent', requester_name: 'Mamá Pérez', escalation_notified_recipients: ['SCHOOL_ADMIN:dir@ejemplo.mx'] },
    ],
    NoticeDelivery: [{ id: 'nd1', school_id: 'sA', recipient_user_id: 'u-parent' }, { id: 'nd2', school_id: 'sA', recipient_user_id: 'u-other' }],
    NoticeRead: [{ id: 'nr1', user_id: 'u-parent', notice_id: 'n1' }],
    PermissionOverride: [{ id: 'po1', school_id: 'sA', user_profile_id: 'p-teacher', resource: 'Notice', action: 'write', effect: 'deny' }],
    PendingChange: [
      { id: 'pc-open', school_id: 'sA', target_profile_id: 'p-teacher', status: 'PENDING_SECOND_ADMIN_APPROVAL' },
      { id: 'pc-done', school_id: 'sA', target_profile_id: 'p-teacher', status: 'APPROVED' },
    ],
    AppSession: [{ id: 'as1', user_email: 'Mama@Ejemplo.mx', user_name: 'Mamá' }],
    ConsentRecord: [
      { id: 'cr-old', user_id: 'u-parent', school_id: 'sA', notice_version: '2026-09-29-borrador', terms_version: '2026-09-29-borrador', accepted_general: true, accepted_sensitive_minor_data: true, accepted_at: '2026-09-30T10:00:00.000Z' },
      { id: 'cr-new', user_id: 'u-parent', school_id: 'sA', event: 'ACCEPTED', notice_version: '2026-10-02', terms_version: '2026-10-02', accepted_general: true, accepted_sensitive_minor_data: true, accepted_at: '2026-10-02T09:00:00.000Z' },
    ],
    AuditLog: [],
  };
  const integrations = { Core: { SendEmail: async (msg) => { sent.push(msg); } } };
  const db = makeFakeMongoDb(tables, { integrations });
  return { db, tables, sent };
}

const del = (db, user, body = { confirm: 'ELIMINAR' }) =>
  runAccountDeletion({ sr: db, user, body, now: NOW, userAgent: 'test-agent' });

test('a parent deletes their account: access closed, account data gone, school records kept without the name', async () => {
  const { db, tables, sent } = world();
  const before = structuredClone({ ChargeItem: tables.ChargeItem, PaymentRecord: tables.PaymentRecord });
  const r = await del(db, USERS.parent);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);

  // Access: no profile, links revoked, session closed, User marked AND removed.
  assert.equal(tables.UserProfile.some((p) => p.user_id === 'u-parent'), false);
  assert.equal(tables.ParentStudent.find((l) => l.id === 'ps1').status, 'REVOKED');
  assert.equal(tables.AppSession[0].revoked_by, 'account_deleted');
  assert.equal(tables.User.some((u) => u.id === 'u-parent'), false);
  assert.equal(r.body.userRemoved, true);

  // Account data.
  assert.equal(tables.ParentProfile.some((p) => p.user_id === 'u-parent'), false);
  assert.equal(tables.NoticeDelivery.some((d) => d.recipient_user_id === 'u-parent'), false);
  assert.equal(tables.NoticeRead.length, 0);
  // The address wherever a server wrote it (case-insensitively), and nobody else's.
  assert.deepEqual(tables.DiaryEntry.find((d) => d.id === 'd1').notified_parent_emails, ['otro@ejemplo.mx']);
  assert.deepEqual(tables.DiaryEntry.find((d) => d.id === 'd2').notified_parent_emails, ['otro@ejemplo.mx']);

  // Requests the school had not attended: gone. Attended ones: kept, anonymous.
  assert.equal(tables.AbsenceNotification.some((a) => a.id === 'ab-pending'), false);
  assert.equal(tables.UniformOrder.some((a) => a.id === 'uo-pending'), false);
  assert.equal(tables.AbsenceNotification.find((a) => a.id === 'ab-approved').parent_name, ANONYMIZED_NAME);
  assert.equal(tables.UniformOrder.find((a) => a.id === 'uo-delivered').parent_name, ANONYMIZED_NAME);
  assert.equal(tables.EventResponse[0].parent_name, ANONYMIZED_NAME);
  assert.equal(tables.SupportTicket[0].requester_name, ANONYMIZED_NAME);

  // Fiscal and patrimonial records are never touched.
  assert.deepEqual({ ChargeItem: tables.ChargeItem, PaymentRecord: tables.PaymentRecord }, before);

  // Nobody else's data moved.
  assert.equal(tables.ParentStudent.find((l) => l.id === 'ps2').status, 'ACTIVE');
  assert.equal(tables.AbsenceNotification.find((a) => a.id === 'ab-other').status, 'PENDING');
  assert.ok(tables.ParentProfile.some((p) => p.user_id === 'u-other'));
  assert.ok(tables.NoticeDelivery.some((d) => d.recipient_user_id === 'u-other'));
  assert.ok(tables.UserProfile.some((p) => p.user_id === 'u-other'));

  // ACACIA hears about the manual steps (Lumi, trash), by user id.
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'soporte@acaciaco.com.mx');
  assert.match(sent[0].body, /u-parent/);
  assert.match(sent[0].body, /Lumi/);
  assert.doesNotMatch(sent[0].body, /Mama@Ejemplo\.mx/i, 'the e-mail to ACACIA carries the id, not the address');
});

test('evidence first: the withdrawal is recorded before anything is deleted, and consent records are never deleted', async () => {
  const { db, tables } = world();
  await del(db, USERS.parent);
  // Access falls before anything else: the server gates read the stamp, so
  // clearing it is the first write (Codex review of PR #197). Then the
  // evidence, then the stamp again (see the race test below), then deletions.
  const [stampWrite, firstWrite, againWrite] = db.writes;
  assert.deepEqual([stampWrite.entity, stampWrite.op], ['UserProfile', 'updateMany']);
  assert.equal(stampWrite.data.$set.consent_notice_version, '');
  assert.deepEqual([againWrite.entity, againWrite.op], ['UserProfile', 'updateMany']);
  assert.equal(againWrite.data.$set.consent_notice_version, '');
  const firstDeletion = db.writes.findIndex((w) => /delete/i.test(w.op));
  assert.ok(firstDeletion > 1, 'nothing is deleted before the withdrawal is recorded');
  assert.equal(firstWrite.entity, 'ConsentRecord');
  assert.equal(firstWrite.op, 'create');
  assert.equal(firstWrite.data.event, 'WITHDRAWN');
  assert.equal(firstWrite.data.user_id, 'u-parent');
  assert.equal(firstWrite.data.school_id, 'sA');
  assert.equal(firstWrite.data.source, 'account_deletion');
  assert.equal(firstWrite.data.notice_version, '2026-10-02', 'names the version being withdrawn');
  assert.ok(tables.ConsentRecord.find((c) => c.id === 'cr-old'));
  assert.ok(tables.ConsentRecord.find((c) => c.id === 'cr-new'));
  assert.equal(db.writes.some((w) => w.entity === 'ConsentRecord' && w.op !== 'create'), false);
  const actions = tables.AuditLog.map((a) => a.action);
  assert.deepEqual(actions, ['PRIVACY_CONSENT_WITHDRAWN', 'ACCOUNT_DELETED']);
  const deleted = tables.AuditLog.find((a) => a.action === 'ACCOUNT_DELETED');
  assert.ok(deleted.details.manual_steps.some((s) => /Lumi/.test(s)));
});

test('everything comes from the caller: a body naming someone else deletes only the caller', async () => {
  const { db, tables } = world();
  const r = await del(db, USERS.parent, { confirm: 'ELIMINAR', userId: 'u-other', user_id: 'u-other', profileId: 'p-other', schoolId: 'sB' });
  assert.equal(r.status, 200);
  assert.ok(tables.UserProfile.some((p) => p.user_id === 'u-other'));
  assert.ok(tables.User.some((u) => u.id === 'u-other'));
  for (const w of db.writes) {
    assert.ok(!JSON.stringify(w).includes('p-other'), `a write touched the named profile: ${JSON.stringify(w)}`);
  }
});

test('no typed confirmation, no deletion — and nothing is written', async () => {
  for (const confirm of [undefined, '', 'eliminar mi cuenta', 'BORRAR']) {
    const { db } = world();
    const r = await del(db, USERS.parent, { confirm });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'CONFIRMATION_REQUIRED');
    assert.equal(db.writes.length, 0);
  }
  // The same forgiveness on both sides of the wire.
  for (const word of ['ELIMINAR', ' eliminar ', 'Eliminar']) {
    assert.equal(serverConfirms(word), true);
    assert.equal(confirmationMatches(word), true);
  }
  assert.equal(SERVER_WORD, CONFIRMATION_WORD);
});

test('the only ACTIVE director cannot delete their account (the school would be orphaned)', async () => {
  const { db } = world();
  const r = await del(db, USERS.admin);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'SOLE_ADMIN');
  assert.deepEqual(r.body.soleAdminSchools, [{ id: 'sA', name: 'Colegio A' }]);
  assert.equal(db.writes.length, 0, 'refused before the first write');
  const preview = await previewDeletion(db, USERS.admin);
  assert.equal(preview.body.soleAdmin, true);
  // A PENDING second director does not count.
  const pending = world({ pendingSecondAdmin: true });
  assert.equal((await del(pending.db, USERS.admin)).body.code, 'SOLE_ADMIN');
  // An ACTIVE second director does: then the first may go.
  const two = world({ withSecondAdmin: true });
  const ok = await del(two.db, USERS.admin);
  assert.equal(ok.status, 200);
  assert.equal(two.tables.OfficialDocument[0].uploaded_by_name, ANONYMIZED_NAME);
  assert.equal(two.tables.Notice.find((n) => n.id === 'n2').author_name, ANONYMIZED_NAME);
  // Their address leaves the delivery keys of other profiles and tickets.
  assert.deepEqual(two.tables.UserProfile.find((p) => p.id === 'p-new').pending_notification_recipients, ['dir2@ejemplo.mx']);
  assert.deepEqual(two.tables.SupportTicket[0].escalation_notified_recipients, []);
  assert.deepEqual(soleAdminSchoolIds([profile('x', 'u', 'ADMIN')], { sA: [profile('x', 'u', 'ADMIN')] }, 'u'), ['sA']);
});

test('the platform owner cannot delete itself from the app', async () => {
  const { db } = world();
  const r = await del(db, USERS.owner);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'PLATFORM_OWNER');
  assert.equal(db.writes.length, 0);
  assert.equal((await previewDeletion(db, USERS.owner)).body.platformOwner, true);
});

test('a teacher: assignments closed, open role changes and personal exceptions gone, authored records anonymous', async () => {
  const { db, tables } = world();
  const r = await del(db, USERS.teacher);
  assert.equal(r.status, 200);
  assert.equal(tables.TeacherClassroom.find((t) => t.id === 'tc1').is_active, false);
  assert.equal(tables.TeacherClassroom.find((t) => t.id === 'tc2').is_active, true);
  for (const [entity, id] of [['DiaryEntry', 'd1'], ['Homework', 'h1'], ['Notice', 'n1'], ['Attendance', 'at1']]) {
    const row = tables[entity].find((x) => x.id === id);
    const nameField = ANONYMIZE.find(([e]) => e === entity)[2];
    assert.equal(row[nameField], ANONYMIZED_NAME, `${entity}.${nameField}`);
  }
  assert.equal(tables.DiaryEntry.find((d) => d.id === 'd2').teacher_name, 'Otra maestra');
  assert.equal(tables.PermissionOverride.length, 0);
  assert.deepEqual(tables.PendingChange.map((p) => p.id), ['pc-done'], 'decided changes stay as history');
});

test('a retry after a failure part-way converges and does not stack a second withdrawal', async () => {
  const { tables } = world();
  const failing = makeFakeMongoDb(tables, { failOn: { entity: 'UserProfile', op: 'deleteMany', message: 'Rate limit exceeded', status: 429 } });
  await assert.rejects(() => del(failing, USERS.parent), /Rate limit/);
  // The withdrawal landed and cleared the consent stamp: the person is not
  // left using the app on the acceptance they just withdrew.
  const stillThere = tables.UserProfile.find((p) => p.user_id === 'u-parent');
  assert.equal(stillThere.consent_notice_version, '');
  const status = await consentStatus(makeFakeMongoDb(tables), USERS.parent);
  assert.equal(status.body.required, true, 'the newest record is the withdrawal: nothing to repair from');

  const retry = makeFakeMongoDb(tables, { integrations: { Core: { SendEmail: async () => {} } } });
  const r = await del(retry, USERS.parent);
  assert.equal(r.status, 200);
  assert.equal(tables.ConsentRecord.filter((c) => c.event === 'WITHDRAWN').length, 1);
  assert.equal(tables.AuditLog.filter((a) => a.action === 'PRIVACY_CONSENT_WITHDRAWN').length, 1);
});

test('a failing audit log never strands a deletion half-started (the ConsentRecord is the evidence)', async () => {
  const { tables } = world();
  const db = makeFakeMongoDb(tables, {
    failOn: { entity: 'AuditLog', op: 'create', message: 'enum value not deployed' },
    integrations: { Core: { SendEmail: async () => {} } },
  });
  const r = await del(db, USERS.parent);
  assert.equal(r.status, 200);
  assert.equal(tables.UserProfile.some((p) => p.user_id === 'u-parent'), false);
  assert.equal(tables.ConsentRecord.filter((c) => c.event === 'WITHDRAWN').length, 1);
});

test('if Base44 refuses to remove the User, the account stays marked as deleted and ACACIA is told', async () => {
  const { tables } = world();
  const sent = [];
  const db = makeFakeMongoDb(tables, {
    failOn: { entity: 'User', op: 'delete', message: 'Forbidden', status: 403 },
    integrations: { Core: { SendEmail: async (m) => { sent.push(m); } } },
  });
  const r = await del(db, USERS.parent);
  assert.equal(r.status, 200, 'the deletion itself stands');
  assert.equal(r.body.userRemoved, false);
  assert.equal(r.body.userMarked, true);
  const marked = tables.User.find((u) => u.id === 'u-parent');
  assert.equal(marked.account_deleted_at, NOW.toISOString());
  assert.equal(marked.display_name, '');
  assert.match(sent[0].body, /Quitar al usuario u-parent/);
  // The marked account cannot come back through onboarding or consent.
  assert.equal(accountDeletedAt(marked), NOW.toISOString());
  assert.equal((await consentStatus(makeFakeMongoDb(tables), marked)).body.accountDeleted, true);
  await assert.rejects(
    () => runOnboardingProvision({ user: marked, body: { role: 'PARENT' }, sr: { entities: {} } }),
    (e) => e.code === 'ACCOUNT_DELETED' && e.status === 410,
  );
  const fn = read('base44/functions/provisionOnboardingProfile/entry.ts');
  assert.match(fn, /if \(accountDeletedAt\(user\)\) return bad\(410, 'ACCOUNT_DELETED'/);
});

// The invariants a partial failure must never break (Codex review of PR #197):
//  - withdrawn ⇒ no access: once a WITHDRAWN record exists, no profile of the
//    person carries a consent stamp the server gates would accept, and
//    myConsent does not repair one;
//  - no profile ⇒ the User is marked (or removed): otherwise the account could
//    onboard again with its data already gone.
async function assertSafeAfterPartialFailure(tables, label) {
  const withdrawn = tables.ConsentRecord.some((c) => c.user_id === 'u-parent' && c.event === 'WITHDRAWN');
  const profiles = tables.UserProfile.filter((p) => p.user_id === 'u-parent');
  if (withdrawn) {
    for (const p of profiles) {
      assert.equal(serverStampIsCurrent(p), false, `${label}: withdrawn but a profile still passes the server gates`);
    }
    const userRow = tables.User.find((u) => u.id === 'u-parent');
    if (userRow && profiles.length) {
      const status = await consentStatus(makeFakeMongoDb(tables), { ...USERS.parent, ...userRow });
      assert.notEqual(status.body.repaired, true, `${label}: myConsent repaired the stamp after a withdrawal`);
    }
  }
  if (!profiles.length) {
    const userRow = tables.User.find((u) => u.id === 'u-parent');
    assert.ok(!userRow || accountDeletedAt(userRow), `${label}: profiles gone but the User is neither marked nor removed`);
  }
}

test('a failure at ANY write leaves no access after the withdrawal and no unmarked account without profiles; a retry completes', async () => {
  // Every write a healthy run makes, as (entity, op, nth call).
  const healthy = world();
  await del(healthy.db, USERS.parent);
  const seen = {};
  const steps = healthy.db.writes.map((w) => {
    const key = `${w.entity}.${w.op}`;
    seen[key] = (seen[key] || 0) + 1;
    return { entity: w.entity, op: w.op, nth: seen[key] };
  });
  assert.ok(steps.length > 10, 'the run makes the writes this test enumerates');
  for (const step of steps) {
    for (const status of [undefined, 429]) {
      const label = `${step.entity}.${step.op}#${step.nth}${status ? ' (429)' : ''}`;
      const { tables } = world();
      const failing = makeFakeMongoDb(tables, {
        failOn: { ...step, status, message: status ? 'Rate limit exceeded' : 'boom' },
        integrations: { Core: { SendEmail: async () => {} } },
      });
      let r = null;
      try { r = await del(failing, USERS.parent); } catch { r = null; }
      if (r && r.status === 200) assert.equal(r.body.ok, true, label);
      await assertSafeAfterPartialFailure(tables, label);

      // A failed call is retried (the page offers it) on a healthy
      // connection: it converges, without a second withdrawal. A call that
      // already answered 200 has nothing left to retry.
      if (!r || r.status !== 200) {
        const userRow = tables.User.find((u) => u.id === 'u-parent');
        const caller = userRow ? { ...USERS.parent, ...userRow } : USERS.parent;
        const retry = await del(makeFakeMongoDb(tables, { integrations: { Core: { SendEmail: async () => {} } } }), caller);
        assert.equal(retry.status, 200, `${label}: retry ${JSON.stringify(retry.body)}`);
      }
      assert.equal(tables.UserProfile.some((p) => p.user_id === 'u-parent'), false, label);
      assert.equal(tables.ConsentRecord.filter((c) => c.event === 'WITHDRAWN').length, 1, label);
    }
  }
});

test('a myConsent repair racing the withdrawal cannot leave a stamp behind, even if a later step fails', async () => {
  const { tables } = world();
  const db = makeFakeMongoDb(tables, { failOn: { entity: 'UserProfile', op: 'deleteMany', message: 'Rate limit exceeded', status: 429 } });
  // A concurrent myConsent 'status' call read the (still newest) acceptance
  // after the first clear and writes its repair just before the WITHDRAWN
  // record lands.
  const create = db.entities.ConsentRecord.create;
  db.entities.ConsentRecord.create = async (data) => {
    for (const p of tables.UserProfile.filter((x) => x.user_id === 'u-parent')) {
      Object.assign(p, { consent_notice_version: '2026-10-02', consent_terms_version: '2026-10-02' });
    }
    return create(data);
  };
  await assert.rejects(() => del(db, USERS.parent), /Rate limit/);
  const p = tables.UserProfile.find((x) => x.user_id === 'u-parent');
  assert.ok(p, 'the failure came before the profiles were deleted');
  assert.equal(serverStampIsCurrent(p), false, 'the second clear removed the raced repair');
});

test('if the User can be neither marked nor removed, the profiles stay and the call fails in Spanish — a retry finishes it', async () => {
  const { tables } = world();
  const sent = [];
  const db = makeFakeMongoDb(tables, {
    failOn: [
      { entity: 'User', op: 'update', message: 'Forbidden', status: 403 },
      { entity: 'User', op: 'delete', message: 'Forbidden', status: 403 },
    ],
    integrations: { Core: { SendEmail: async (m) => { sent.push(m); } } },
  });
  const r = await del(db, USERS.parent);
  assert.equal(r.status, 503);
  assert.equal(r.body.ok, false, 'never reported as done');
  assert.equal(r.body.code, 'ACCOUNT_NOT_MARKED');
  // Profiles kept (so the account cannot onboard as a fresh one with its data
  // gone), but already without access.
  const kept = tables.UserProfile.filter((p) => p.user_id === 'u-parent');
  assert.equal(kept.length, 1);
  assert.equal(serverStampIsCurrent(kept[0]), false);
  assert.equal(tables.ParentStudent.find((l) => l.id === 'ps1').status, 'REVOKED');
  assert.equal(db.writes.some((w) => w.entity === 'User'), false);
  assert.equal(sent.length, 0, 'ACACIA is not told a deletion happened that did not');
  assert.match(deletionErrorMessage('ACCOUNT_NOT_MARKED'), /vuelve a intentarlo/);
  assert.notEqual(deletionErrorMessage('ACCOUNT_NOT_MARKED'), deletionErrorMessage('SOMETHING_ELSE'));

  const retry = await del(makeFakeMongoDb(tables, { integrations: { Core: { SendEmail: async () => {} } } }), USERS.parent);
  assert.equal(retry.status, 200);
  assert.equal(tables.User.some((u) => u.id === 'u-parent'), false);
  assert.equal(tables.UserProfile.some((p) => p.user_id === 'u-parent'), false);
});

test('a marked account cannot onboard or join again, by role or by school code', async () => {
  const marked = { id: 'u-gone', email: 'x@y.mx', account_deleted_at: NOW.toISOString() };
  for (const body of [{ role: 'PARENT' }, { role: 'TEACHER', joinCode: 'ABCD-EFGH' }, { role: 'ADMIN', schoolName: 'Nueva' }]) {
    await assert.rejects(
      () => runOnboardingProvision({ user: marked, body, sr: { entities: {} } }),
      (e) => e.code === 'ACCOUNT_DELETED' && e.status === 410,
    );
  }
  // The function refuses before it reads the body, so no branch (found a
  // school, join by code) runs for a marked User.
  const fn = read('base44/functions/provisionOnboardingProfile/entry.ts');
  const serve = fn.indexOf('Deno.serve');
  const refuse = fn.indexOf("if (accountDeletedAt(user)) return bad(410, 'ACCOUNT_DELETED'", serve);
  assert.ok(refuse > serve, 'the refusal is inside the handler');
  assert.ok(refuse < fn.indexOf('req.json()', serve), 'and before the body is read');
});

test('every entity and field the deletion writes exists in the schemas', () => {
  for (const [entity, idField, nameField] of ANONYMIZE) {
    const props = readJsonc(`base44/entities/${entity}.jsonc`).properties;
    assert.ok(idField in props, `${entity}.${idField}`);
    assert.ok(nameField in props, `${entity}.${nameField}`);
  }
  const p = (e) => readJsonc(`base44/entities/${e}.jsonc`).properties;
  assert.ok(p('ParentStudent').status.enum.includes('REVOKED'));
  assert.ok('is_active' in p('TeacherClassroom'));
  assert.ok('revoked_at' in p('AppSession') && 'revoked_by' in p('AppSession'));
  assert.ok(p('AbsenceNotification').status.enum.includes('PENDING'));
  assert.ok(p('UniformOrder').status.enum.includes('PENDING'));
  assert.ok('notified_parent_emails' in p('DiaryEntry'));
  assert.ok('pending_notification_recipients' in p('UserProfile'));
  assert.ok('escalation_notified_recipients' in p('SupportTicket'));
  const user = p('User');
  assert.equal(user.account_deleted_at.rls.write, false, 'only the service role marks an account deleted');
  const consent = readJsonc('base44/entities/ConsentRecord.jsonc');
  assert.deepEqual(consent.properties.event.enum, ['ACCEPTED', 'WITHDRAWN']);
  assert.ok('withdrawn_at' in consent.properties);
  assert.equal(consent.required.includes('accepted_at'), false, 'a withdrawal has no acceptance time');
  // Append-only evidence: still nobody but the service role writes, nobody deletes.
  for (const op of ['create', 'update', 'delete']) {
    assert.deepEqual(consent.rls[op], { user_condition: { role: '__service_role_only__' } });
  }
  // The audit actions it writes are in the enum and nobody else may claim them.
  const actions = readJsonc('base44/entities/AuditLog.jsonc').properties.action.enum;
  for (const a of ['PRIVACY_CONSENT_WITHDRAWN', 'ACCOUNT_DELETED']) {
    assert.ok(actions.includes(a), a);
    assert.equal(ACTION_TIER[a], 'SERVER', `${a} is server-only in recordAuditEvent`);
  }
});

// ── The legal text, the page and the function say the same thing ───────────

const aviso = PRIVACY_NOTICE.sections.map((s) => [s.heading, ...(s.paragraphs || []), ...(s.items || []), s.closing || ''].join('\n')).join('\n');
const terminos = SERVICE_TERMS.sections.map((s) => [s.heading, ...(s.paragraphs || []), ...(s.items || [])].join('\n')).join('\n');

test('the page is the option the legal texts name, reachable by every role', () => {
  assert.equal(ACCOUNT_DELETION_TITLE, ACCOUNT_DELETION_LABEL);
  assert.ok(aviso.includes(`"${ACCOUNT_DELETION_LABEL}"`));
  assert.ok(terminos.includes(`"${ACCOUNT_DELETION_LABEL}"`));
  for (const role of [ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT]) {
    assert.ok(getDestinations(role).some((d) => d.page === ACCOUNT_DELETION_PAGE), `${role} menu`);
    assert.ok(ROUTE_ACCESS[ACCOUNT_DELETION_PAGE].includes(role), `${role} route`);
  }
  assert.equal(ACCOUNT_DELETION_PATH, '/EliminarCuenta');
  assert.match(read('src/pages.config.js'), /"EliminarCuenta": EliminarCuenta/);
  // The danger zone of Permisos y Roles leads there too.
  assert.match(read('src/pages/PermisosRoles.jsx'), /<Link to=\{ACCOUNT_DELETION_PATH\}>/);
});

test('what the page promises matches the legal text and what the function does', () => {
  const s10 = PRIVACY_NOTICE.sections.find((s) => s.id === 'revocacion').paragraphs.join('\n');
  assert.match(s10, /tu acceso se cierra de inmediato/);
  assert.match(s10, new RegExp(`dentro de ${PURGE_DAYS} días`));
  assert.match(s10, /asistencia, bitácora, cargos y pagos/);
  assert.match(s10, /sin tu nombre/);
  assert.match(s10, /ausencias y pedidos de uniforme/);
  assert.match(s10, /única persona de la dirección/);
  assert.equal(SERVER_PURGE_DAYS, PURGE_DAYS);

  const parent = deletedItems('PARENT').join('\n');
  assert.match(parent, /de inmediato/);
  assert.match(parent, new RegExp(`${PURGE_DAYS} días`));
  assert.match(parent, /vínculos con tus hijos/);
  assert.match(parent, /ausencias y pedidos de uniforme pendientes/);
  assert.match(keptItems('PARENT').join('\n'), /asistencia, bitácora, cargos y pagos/);
  assert.match(keptItems('TEACHER').join('\n'), /sin tu nombre/);
  assert.match(deletedItems('TEACHER').join('\n'), /asignaciones de salón/);
  for (const role of ['PARENT', 'TEACHER', 'ADMIN']) {
    const kept = keptItems(role).join('\n');
    assert.match(kept, /constancia de tu consentimiento y de su retiro/);
    assert.match(kept, /Lumi/);
  }
  assert.match(deletionErrorMessage('SOLE_ADMIN'), /única persona/);
  assert.match(deletionErrorMessage('WHATEVER'), /soporte@acaciaco\.com\.mx/);
});

test('no text promises what code cannot do: Lumi conversations are requested from Base44, not "deleted"', () => {
  // Neither the SDK's agents module nor Base44's platform API can delete an
  // agent conversation (checked 2026-10-02). The texts used to say they were
  // deleted with the account.
  const everything = aviso + terminos + RETENTION_TABLE.map((r) => r.data + r.period).join('\n') + keptItems('PARENT').join('\n');
  assert.doesNotMatch(everything, /conversaciones con Lumi se suprimen/);
  assert.doesNotMatch(everything, /se suprimen con ella/);
  assert.match(aviso, /ACACIA solicita a Base44 su supresión/);
  const lumiRow = RETENTION_TABLE.find((r) => /Lumi/.test(r.data));
  assert.equal(lumiRow.days, null, 'the period depends on Base44, so no number is promised');
  const agents = read('node_modules/@base44/sdk/dist/modules/agents.js');
  assert.doesNotMatch(agents, /axios\.delete/, 'if the SDK gains a delete, use it in deleteMyAccount and restore the promise');
});

test('the page: typed confirmation, a way back, and the sole-director path without consent', () => {
  const page = read('src/pages/EliminarCuenta.jsx');
  assert.match(page, /disabled=\{deleting \|\| !confirmationMatches\(confirmText\)\}/);
  assert.match(page, /Volver y aceptar/);
  assert.match(page, /'Cancelar'/);
  assert.match(page, /createSupportTicket\(\{/);
  assert.match(page, /SUPPORT_CATEGORIES\.ACCOUNT/);
  assert.match(page, /downloadSchoolExport/);
  assert.match(page, /sessionStorage\.setItem\(ACCOUNT_DELETED_FLAG_KEY/);
  assert.match(page, /logout\(\)/);
  assert.doesNotMatch(page, /base44\.entities\./, 'the page writes nothing itself');
  // 44px targets on every action, and dark-mode tokens rather than white.
  assert.ok((page.match(/min-h-11/g) || []).length >= 6);
  assert.doesNotMatch(page, /bg-white(?!\/)/);
  // A support ticket is the one write a not-yet-consenting caller may make.
  const policy = read('base44/functions/guardedEntityWrite/_policy.ts');
  assert.match(policy, /return entity === 'SupportTicket' && operation === 'create';/);
  // The login screen confirms the deletion once the session is gone.
  assert.match(read('src/pages/Login.jsx'), /sessionStorage\.getItem\(ACCOUNT_DELETED_FLAG_KEY\)/);
});

// ── Adversarial review (2026-10-02) ─────────────────────────────────────────

test('every signed-in person can reach the deletion page, whatever their profile status', async () => {
  // The texts promise the option "de tu cuenta" to every user. Before the
  // review a PENDING person (already consented at onboarding) was denied the
  // route (INACTIVE_PROFILE) and had no link to it.
  const { getRouteAccessDecision, OWN_ACCOUNT_ROUTES } = await import('../../src/lib/authorization/routeAccess.js');
  assert.deepEqual(OWN_ACCOUNT_ROUTES, ['EliminarCuenta']);
  for (const profileStatus of ['PENDING', 'SUSPENDED', 'ACTIVE']) {
    for (const role of ['ADMIN', 'TEACHER', 'PARENT']) {
      assert.equal(getRouteAccessDecision({ role, routeName: 'EliminarCuenta', profileStatus }).allowed, true, `${role}/${profileStatus}`);
    }
  }
  // No profile yet (onboarding): no role, no status.
  assert.equal(getRouteAccessDecision({ routeName: 'EliminarCuenta' }).allowed, true, 'mid-onboarding');
  // …and only that route: a PENDING profile still sees nothing else.
  assert.equal(getRouteAccessDecision({ role: 'ADMIN', routeName: 'PagosAdmin', profileStatus: 'PENDING' }).allowed, false);
  const fs = await import('node:fs');
  const src = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
  assert.match(src('src/components/ui/PendingApproval.jsx'), /<DeleteAccountLink \/>/);
  const home = src('src/pages/Home.jsx');
  assert.equal((home.match(/<DeleteAccountLink \/>/g) || []).length, 2, 'suspended + onboarding');
  assert.match(src('src/components/account/DeleteAccountLink.jsx'), /min-h-11/);
});

test('someone with no role yet is not told about records "you published as staff"', () => {
  assert.equal(keptItems(null).some((i) => /personal de la escuela/.test(i)), false);
  assert.equal(keptItems('ADMIN').some((i) => /personal de la escuela/.test(i)), true);
});
