import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeFakeMongoDb } from '../fixtures/fake-mongo-db.js';
import { makeFakeDb } from '../fixtures/fake-entity-db.js';
// The real function code, loaded as-is (Node 22 strips the TS types).
import {
  acceptConsent,
  consentStatus,
  currentAcceptance,
  profileConsentIsCurrent as consentFnIsCurrent,
  selectCurrentProfile as consentSelect,
} from '../../base44/functions/myConsent/_consent.ts';
import { profileProblem as readProblem, profileConsentIsCurrent as readIsCurrent, selectCurrentProfile as readSelect } from '../../base44/functions/schoolRead/_scope.ts';
import { profileProblem as writeProblem, profileConsentIsCurrent as writeIsCurrent, consentExempt } from '../../base44/functions/guardedEntityWrite/_policy.ts';
import { profileConsentIsCurrent as familyIsCurrent } from '../../base44/functions/guardedFamilyWrite/_policy.ts';
import { runSchoolWrite } from '../../base44/functions/guardedEntityWrite/_schoolWrite.ts';
import { answerSchoolRead } from '../../base44/functions/schoolRead/_answer.ts';
import { PRIVACY_NOTICE_VERSION, SERVICE_TERMS_VERSION, profileConsentIsCurrent } from '../../src/lib/consent/privacyNotice.js';
import { decideConsentGate } from '../../src/lib/consent/consentGate.js';
import { ACCOUNT_DELETION_PATH } from '../../src/lib/account/accountDeletion.js';

// Mandatory consent for existing users (owner decision 2026-10-02): "si no lo
// tienen lo tienen que firmar obligatoriamente; si declina se le dirige a la
// página de borrar cuenta y sus datos, con la posibilidad de retractarse o
// confirmar". Six of the ten production profiles had no ConsentRecord and the
// other four had accepted the 2026-09-29 DRAFT, so every one of them must
// accept again — and nobody may keep using LIUMA without doing so, in the UI
// or by calling the functions directly.

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, ROOT), 'utf8');
const NOW = new Date('2026-10-02T18:00:00.000Z');
const CURRENT = { consent_notice_version: PRIVACY_NOTICE_VERSION, consent_terms_version: SERVICE_TERMS_VERSION };
const DRAFT = { consent_notice_version: '2026-09-29-borrador', consent_terms_version: '2026-09-29-borrador' };

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

// ── One version, everywhere ─────────────────────────────────────────────────

test('every server copy of the consent versions is the client\'s', () => {
  const files = walk(new URL('base44/functions/', ROOT).pathname);
  let seen = 0;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/const (?:CONSENT_NOTICE_VERSION|PRIVACY_NOTICE_VERSION) = '([^']+)'/g)) {
      assert.equal(m[1], PRIVACY_NOTICE_VERSION, `${file}: notice version`);
      seen += 1;
    }
    for (const m of src.matchAll(/const (?:CONSENT_TERMS_VERSION|TERMS_VERSION) = '([^']+)'/g)) {
      assert.equal(m[1], SERVICE_TERMS_VERSION, `${file}: terms version`);
    }
  }
  // provisionOnboardingProfile, myConsent, 3 × _scope, guardedEntityWrite,
  // guardedFamilyWrite, listSchoolMembers, approveProfile, governRoleChange.
  assert.ok(seen >= 10, `found ${seen} copies`);
});

test('the client and every server copy agree on what "current" means', () => {
  const cases = [
    [null, false],
    [{}, false],
    [{ ...DRAFT }, false],
    [{ consent_notice_version: PRIVACY_NOTICE_VERSION }, false],
    [{ consent_notice_version: '', consent_terms_version: '' }, false],
    [{ ...CURRENT }, true],
  ];
  for (const [profile, expected] of cases) {
    for (const [name, fn] of [['client', profileConsentIsCurrent], ['schoolRead', readIsCurrent], ['guardedEntityWrite', writeIsCurrent], ['guardedFamilyWrite', familyIsCurrent], ['myConsent', consentFnIsCurrent]]) {
      assert.equal(fn(profile), expected, `${name} on ${JSON.stringify(profile)}`);
    }
  }
  // The same school the screens read from decides whose consent counts.
  const profiles = [
    { id: 'old', status: 'ACTIVE', onboarding_completed: true, created_date: '2026-01-01' },
    { id: 'new', status: 'ACTIVE', onboarding_completed: true, created_date: '2026-09-01' },
  ];
  assert.equal(consentSelect(profiles).id, readSelect(profiles).id);
  assert.equal(consentSelect([...profiles].reverse()).id, readSelect(profiles).id);
});

// ── The server refuses without it ───────────────────────────────────────────

test('without the current consent, every read and write path says CONSENT_REQUIRED', async () => {
  const active = { status: 'ACTIVE', school_id: 'sA', app_role: 'ADMIN' };
  assert.equal(readProblem({ ...active }), 'CONSENT_REQUIRED');
  assert.equal(readProblem({ ...active, ...DRAFT }), 'CONSENT_REQUIRED');
  assert.equal(writeProblem({ ...active }), 'CONSENT_REQUIRED');
  assert.equal(readProblem({ ...active, ...CURRENT }), null);
  assert.equal(writeProblem({ ...active, ...CURRENT }), null);
  // The older problems still come first: a PENDING profile is INACTIVE.
  assert.equal(readProblem({ ...active, status: 'PENDING' }), 'INACTIVE_PROFILE');

  // schoolRead, end to end.
  const profiles = [{ id: 'p1', user_id: 'u1', onboarding_completed: true, ...active, ...DRAFT }];
  const answer = await answerSchoolRead(makeFakeDb({ Student: [] }), 'u1', profiles, { entity: 'Student', filter: {} });
  assert.equal(answer.status, 403);
  assert.equal(answer.body.code, 'CONSENT_REQUIRED');

  // The functions that check their own caller.
  const family = read('base44/functions/guardedFamilyWrite/entry.ts');
  assert.match(family, /if \(!profileConsentIsCurrent\(profile\)\) return bad\(403, 'CONSENT_REQUIRED'/);
  for (const fn of ['listSchoolMembers', 'approveProfile', 'governRoleChange']) {
    assert.match(read(`base44/functions/${fn}/entry.ts`), /if \(!profileConsentIsCurrent\(callerProfile\)\) return bad\(403, 'CONSENT_REQUIRED'/, fn);
  }
  // Lumi gets the reason in Spanish.
  for (const fn of ['lumiQuery', 'lumiWrite']) {
    assert.match(read(`base44/functions/${fn}/_lumiCore.ts`), /CONSENT_REQUIRED: 'Antes de seguir, acepta/);
  }
});

test('deliberately NOT gated: the school export and support tickets', async () => {
  // The export is the school's data leaving with it (Términos § 6) and the
  // sole director who declines needs it before asking for the school's
  // deletion; a ticket is how they ask.
  assert.doesNotMatch(read('base44/functions/exportSchoolData/entry.ts'), /CONSENT_REQUIRED/);
  assert.equal(consentExempt('SupportTicket', 'create'), true);
  assert.equal(consentExempt('SupportTicket', 'update'), false);
  assert.equal(consentExempt('Classroom', 'create'), false);

  const db = makeFakeDb({
    UserProfile: [{ id: 'p-admin', user_id: 'u-admin', school_id: 'sA', app_role: 'ADMIN', status: 'ACTIVE', onboarding_completed: true, consent_notice_version: undefined }],
    SchoolSubscription: [{ id: 'sub', school_id: 'sA', subscription_status: 'active', license_tier: 'growth' }],
    SupportTicket: [],
    Classroom: [],
  });
  const user = { id: 'u-admin', email: 'dir@a.mx', full_name: 'Directora' };
  const ticket = await runSchoolWrite({ sr: { entities: db.entities }, user, now: NOW, body: { entity: 'SupportTicket', operation: 'create', data: { ticket_number: 'T-1', subject: 'Solicitud de eliminación de la escuela', category: 'ACCOUNT' } } });
  assert.equal(ticket.status, 200, JSON.stringify(ticket.body));
  const classroom = await runSchoolWrite({ sr: { entities: db.entities }, user, now: NOW, body: { entity: 'Classroom', operation: 'create', data: { name: '1A' } } });
  assert.equal(classroom.status, 403);
  assert.equal(classroom.body.code, 'CONSENT_REQUIRED');
});

// ── myConsent ───────────────────────────────────────────────────────────────

const parent = { id: 'u-parent', email: 'mama@ejemplo.mx' };
const profileRow = (extra = {}) => ({ id: 'p-parent', user_id: 'u-parent', school_id: 'sA', app_role: 'PARENT', status: 'ACTIVE', onboarding_completed: true, created_date: '2026-09-01', ...extra });

test('status: who must accept, and who must not be asked', async () => {
  // No profile: onboarding records its own consent.
  let r = await consentStatus(makeFakeMongoDb({ UserProfile: [] }), parent);
  assert.deepEqual([r.body.required, r.body.hasProfile], [false, false]);
  // Stamped with the current versions: no further reads.
  let db = makeFakeMongoDb({ UserProfile: [profileRow(CURRENT)], ConsentRecord: [] });
  r = await consentStatus(db, parent);
  assert.equal(r.body.required, false);
  assert.equal(db.calls.some((c) => c.entity === 'ConsentRecord'), false);
  // Signed up before v1.9.0 with no record at all (6 of 10 in production).
  r = await consentStatus(makeFakeMongoDb({ UserProfile: [profileRow()], ConsentRecord: [] }), parent);
  assert.equal(r.body.required, true);
  assert.equal(r.body.role, 'PARENT');
  // Accepted the draft (the other 4): must accept again.
  r = await consentStatus(makeFakeMongoDb({
    UserProfile: [profileRow(DRAFT)],
    ConsentRecord: [{ user_id: 'u-parent', school_id: 'sA', notice_version: '2026-09-29-borrador', terms_version: '2026-09-29-borrador', accepted_general: true, accepted_sensitive_minor_data: true, accepted_at: '2026-10-01T18:49:56.845Z' }],
  }), parent);
  assert.equal(r.body.required, true);
  assert.equal(r.body.acceptedVersion, '2026-09-29-borrador');
  // A current acceptance in another school does not count for this one.
  r = await consentStatus(makeFakeMongoDb({
    UserProfile: [profileRow()],
    ConsentRecord: [{ user_id: 'u-parent', school_id: 'sB', event: 'ACCEPTED', notice_version: PRIVACY_NOTICE_VERSION, terms_version: SERVICE_TERMS_VERSION, accepted_general: true, accepted_sensitive_minor_data: true, accepted_at: '2026-10-02T10:00:00Z' }],
  }), parent);
  assert.equal(r.body.required, true);
});

test('status repairs a missing stamp only from real evidence of the current versions', async () => {
  const tables = {
    UserProfile: [profileRow()],
    ConsentRecord: [{ id: 'c1', user_id: 'u-parent', school_id: 'sA', event: 'ACCEPTED', notice_version: PRIVACY_NOTICE_VERSION, terms_version: SERVICE_TERMS_VERSION, accepted_general: true, accepted_sensitive_minor_data: true, accepted_at: '2026-10-02T10:00:00.000Z' }],
  };
  const r = await consentStatus(makeFakeMongoDb(tables), parent);
  assert.equal(r.body.required, false);
  assert.equal(r.body.repaired, true);
  assert.equal(tables.UserProfile[0].consent_notice_version, PRIVACY_NOTICE_VERSION);
  assert.equal(tables.UserProfile[0].consent_accepted_at, '2026-10-02T10:00:00.000Z');
  // A withdrawal after it wins; a half acceptance never counts.
  assert.equal(currentAcceptance([...tables.ConsentRecord, { school_id: 'sA', event: 'WITHDRAWN', withdrawn_at: '2026-10-02T11:00:00Z' }], 'sA'), null);
  assert.equal(currentAcceptance([{ ...tables.ConsentRecord[0], accepted_sensitive_minor_data: false }], 'sA'), null);
});

test('accept: both acceptances, the versions this server publishes, evidence before the stamp', async () => {
  const body = { general: true, sensitive: true, noticeVersion: PRIVACY_NOTICE_VERSION, termsVersion: SERVICE_TERMS_VERSION };

  let db = makeFakeMongoDb({ UserProfile: [profileRow()], ConsentRecord: [] });
  let r = await acceptConsent(db, parent, { ...body, sensitive: false }, NOW, 'ua');
  assert.deepEqual([r.status, r.body.code], [400, 'CONSENT_REQUIRED']);
  r = await acceptConsent(db, parent, { ...body, noticeVersion: '2026-09-29-borrador' }, NOW, 'ua');
  assert.deepEqual([r.status, r.body.code], [409, 'CONSENT_VERSION_MISMATCH']);
  r = await acceptConsent(db, parent, { ...body, termsVersion: undefined }, NOW, 'ua');
  assert.deepEqual([r.status, r.body.code], [409, 'CONSENT_VERSION_MISMATCH']);
  assert.equal(db.writes.length, 0);

  const tables = { UserProfile: [profileRow(DRAFT)], ConsentRecord: [], AuditLog: [] };
  db = makeFakeMongoDb(tables);
  // Body fields naming another user or school are ignored.
  r = await acceptConsent(db, parent, { ...body, user_id: 'u-other', school_id: 'sB', schoolId: 'sB' }, NOW, 'Mozilla/5.0');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.required, false);
  assert.deepEqual(db.writes.map((w) => `${w.entity}.${w.op}`), ['ConsentRecord.create', 'UserProfile.update', 'AuditLog.create']);
  const record = tables.ConsentRecord[0];
  assert.deepEqual(
    [record.user_id, record.school_id, record.app_role, record.event, record.source, record.notice_version, record.terms_version, record.accepted_at, record.user_agent],
    ['u-parent', 'sA', 'PARENT', 'ACCEPTED', 'reacceptance', PRIVACY_NOTICE_VERSION, SERVICE_TERMS_VERSION, NOW.toISOString(), 'Mozilla/5.0'],
  );
  assert.deepEqual(record.accepted_scopes, ['general_privacy_notice', 'sensitive_minor_data']);
  assert.equal(tables.UserProfile[0].consent_notice_version, PRIVACY_NOTICE_VERSION);
  assert.equal(tables.UserProfile[0].consent_terms_version, SERVICE_TERMS_VERSION);
  assert.equal(tables.AuditLog[0].action, 'PRIVACY_CONSENT_ACCEPTED');

  // A double click records once.
  r = await acceptConsent(db, parent, body, NOW, 'ua');
  assert.equal(r.body.already, true);
  assert.equal(tables.ConsentRecord.length, 1);

  // No record, no stamp.
  const failing = { UserProfile: [profileRow()], ConsentRecord: [] };
  await assert.rejects(() => acceptConsent(makeFakeMongoDb(failing, { failOn: { entity: 'ConsentRecord', op: 'create' } }), parent, body, NOW, 'ua'));
  assert.equal(failing.UserProfile[0].consent_notice_version, undefined);

  // Onboarding first; a deleted account never re-accepts.
  r = await acceptConsent(makeFakeMongoDb({ UserProfile: [] }), parent, body, NOW, 'ua');
  assert.deepEqual([r.status, r.body.code], [409, 'NO_PROFILE']);
  r = await acceptConsent(makeFakeMongoDb({ UserProfile: [profileRow()] }), { ...parent, account_deleted_at: '2026-10-02T00:00:00Z' }, body, NOW, 'ua');
  assert.deepEqual([r.status, r.body.code], [410, 'ACCOUNT_DELETED']);
});

test('new signups are stamped by onboarding, so they never see the consent screen twice', () => {
  const fn = read('base44/functions/provisionOnboardingProfile/entry.ts');
  assert.match(fn, /consent_notice_version: PRIVACY_NOTICE_VERSION,\s*consent_terms_version: TERMS_VERSION,/);
  assert.match(fn, /\.\.\.consentStamp,\s*\}\);/);
  // The stamp lands only after the ConsentRecord that proves it.
  assert.ok(fn.indexOf('ConsentRecord.create') < fn.indexOf('...consentStamp'));
  // Only the server writes the stamp.
  const schema = JSON.parse(read('base44/entities/UserProfile.jsonc').replace(/^\s*\/\/.*$/gm, ''));
  for (const field of ['consent_notice_version', 'consent_terms_version', 'consent_accepted_at']) {
    assert.deepEqual(schema.properties[field].rls.write, { user_condition: { role: 'admin' } }, field);
  }
  assert.deepEqual(schema.rls.update, { user_condition: { role: 'admin' } });
});

// ── The gate ────────────────────────────────────────────────────────────────

test('the gate: blocks a profile without the current consent, and never flashes the app first', () => {
  const user = { id: 'u1' };
  const profile = { id: 'p1', status: 'ACTIVE' };
  const gate = (args) => decideConsentGate({ user, profile, ...args });
  assert.equal(decideConsentGate({ user: null }), 'pass', 'auth is AuthenticatedApp\'s job');
  assert.equal(gate({ profileLoading: true }), 'loading');
  assert.equal(decideConsentGate({ user, profile: undefined }), 'pass', 'no profile yet: onboarding records consent');
  assert.equal(gate({ profileFailed: true }), 'pass', 'pages show their own load error; the server refuses data anyway');
  assert.equal(decideConsentGate({ user, profile: { ...profile, ...CURRENT } }), 'pass');
  // Without the stamp the app never renders until the server answers.
  assert.equal(gate({}), 'loading');
  assert.equal(gate({ statusLoading: true }), 'loading');
  assert.equal(gate({ statusFailed: true }), 'status_error');
  assert.equal(gate({ status: { required: true } }), 'consent');
  assert.equal(gate({ status: { required: true }, pathname: '/Home' }), 'consent');
  assert.equal(gate({ status: { required: true }, pathname: '/PagosAdmin' }), 'consent');
  // "No acepto" leads to the deletion page, which stays reachable.
  assert.equal(gate({ status: { required: true }, pathname: ACCOUNT_DELETION_PATH }), 'deletion_page');
  assert.equal(gate({ status: { required: true }, pathname: `${ACCOUNT_DELETION_PATH}/` }), 'deletion_page');
  assert.equal(gate({ status: { required: false, repaired: true } }), 'pass');
  assert.equal(gate({ status: { accountDeleted: true } }), 'deleted');
  assert.equal(decideConsentGate({ user: { id: 'u1', account_deleted_at: '2026-10-02' }, profile }), 'deleted');
  // PENDING people accepted (or not) the draft too: they are gated as well.
  assert.equal(decideConsentGate({ user, profile: { id: 'p', status: 'PENDING' }, status: { required: true } }), 'consent');
});

test('the gate wraps every authenticated screen; the legal pages stay outside it', () => {
  const app = read('src/App.jsx');
  assert.match(app, /<ConsentGate>\s*<Routes>/);
  // Public legal routes are matched by App before AuthenticatedApp renders.
  assert.ok(app.indexOf('PUBLIC_LEGAL_DOCS.map') < app.indexOf('<Route path="*" element={<AuthenticatedApp />} />'));
  const gate = read('src/components/consent/ConsentGate.jsx');
  assert.match(gate, /<EliminarCuenta gated \/>/);
  assert.match(gate, /declinePath=\{ACCOUNT_DELETION_PATH\}/);
});

test('the consent screen: both documents, both acceptances, Aceptar / No acepto, mobile and dark mode', () => {
  const screen = read('src/components/consent/ConsentScreen.jsx');
  assert.match(screen, /href=\{PRIVACY_NOTICE_PATH\}/);
  assert.match(screen, /href=\{SERVICE_TERMS_PATH\}/);
  assert.match(screen, /sensitiveConsentLabel\(role\)/);
  assert.match(screen, />\s*No acepto\s*</);
  assert.match(screen, /'Aceptar'/);
  assert.match(screen, /disabled=\{saving \|\| !consentIsComplete\(consent\)\}/);
  assert.match(screen, /onClick=\{\(\) => navigate\(declinePath\)\}/);
  assert.ok((screen.match(/min-h-11/g) || []).length >= 4, '44px targets');
  assert.doesNotMatch(screen, /bg-white(?!\/)|text-black|bg-slate-50\b/, 'theme tokens, not light-only colors');
  // The versions sent are the ones this bundle displayed.
  const api = read('src/lib/consent/consentApi.js');
  assert.match(api, /noticeVersion: PRIVACY_NOTICE_VERSION,\s*termsVersion: SERVICE_TERMS_VERSION/);
});

test('the legal text promises re-acceptance on the next visit, which is what the gate does', () => {
  const docs = read('src/lib/legal/legalDocs.js');
  assert.match(docs, /LIUMA te pedirá aceptar la nueva versión la siguiente vez que entres/);
  assert.match(docs, /La aceptación es obligatoria para usar el servicio/);
});

// ── Adversarial review (2026-10-02) ─────────────────────────────────────────

test('the gate waits for the USER too: no frame of the app before it knows who is signed in', () => {
  // useCurrentProfile's isLoading covers the user query; with the user still
  // loading `user` is undefined, and checking it first rendered the app (and
  // fired its reads, each answered CONSENT_REQUIRED) for a frame.
  assert.equal(decideConsentGate({ user: undefined, profileLoading: true }), 'loading');
  assert.equal(decideConsentGate({ user: null, profileLoading: false }), 'pass');
});

test('every function that mails or processes OTHER people\'s data requires the current consent', () => {
  // Not only reads: an un-consented director calling these directly would
  // e-mail families, or send a child's name to the model.
  const bulk = read('base44/functions/sendBulkNotification/entry.ts');
  assert.match(bulk, /if \(!profileConsentIsCurrent\(admin\)\) throw new HttpError\(403, 'CONSENT_REQUIRED'/, 'alert and reminders');
  assert.match(read('base44/functions/notifyParents/entry.ts'), /if \(!profileConsentIsCurrent\(profile\)\) throw \{ status: 403, code: 'CONSENT_REQUIRED'/);
  assert.match(read('base44/functions/sendNotificationEmail/entry.ts'), /if \(!profileConsentIsCurrent\(callerProfile\)\) return bad\(403, 'CONSENT_REQUIRED'/);
  const ai = read('base44/functions/aiAssist/entry.ts');
  const draft = ai.slice(ai.indexOf("task === 'diary_draft'"), ai.indexOf("task === 'support_intake'"));
  assert.match(draft, /if \(!profileConsentIsCurrent\(profile\)\) return bad\(403, 'CONSENT_REQUIRED'/);
  // The ticket rule (consentExempt): the requester's own ticket stays open;
  // STAFF standing on someone else's ticket needs consent.
  for (const fn of ['postTicketMessage', 'sendBulkNotification']) {
    assert.match(read(`base44/functions/${fn}/entry.ts`),
      /isSchoolAdmin = profiles\.some\(\(p\) => p\.app_role === 'ADMIN' && p\.status === 'ACTIVE' && profileConsentIsCurrent\(p\)\)/, fn);
  }
  const intake = ai.slice(ai.indexOf("task === 'support_intake'"));
  assert.doesNotMatch(intake.slice(0, 800), /CONSENT_REQUIRED/, 'support intake is part of asking for help');
});
