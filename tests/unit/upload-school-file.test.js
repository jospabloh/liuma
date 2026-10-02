import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PURPOSES,
  EXTENSIONS,
  MAX_REQUEST_BYTES,
  checkFile,
  decideUploader,
  detectFileType,
  effectiveLicenseIsReadOnly as uploadReadOnly,
  extensionType,
  profileProblem as uploadProblemOf,
  accountDeletedAt as uploadDeletedAt,
  safeFileName,
  selectCurrentProfile as uploadSelect,
  uploadedUrl,
  claimRank,
  uploadWithinDailyLimit,
  DAILY_UPLOAD_LIMIT,
  QUOTA_READ_LIMIT,
  UPLOAD_AUDIT_TARGET,
  uploadDayKey,
  mexicoDayKey,
} from '../../base44/functions/uploadSchoolFile/_upload.ts';
import { makeFakeMongoDb } from '../fixtures/fake-mongo-db.js';
import { selectCurrentProfile as readSelect, profileProblem as readProblem } from '../../base44/functions/schoolRead/_scope.ts';
import { PRIVACY_NOTICE_VERSION, SERVICE_TERMS_VERSION } from '../../src/lib/consent/privacyNotice.js';
import { effectiveLicenseIsReadOnly as writeReadOnly } from '../../base44/functions/guardedEntityWrite/_policy.ts';
import { UPLOAD_PURPOSES, UPLOAD_EXTENSIONS, uploadProblem, typedFileName, withTypedName } from '../../src/lib/uploads/uploadRules.js';
import { uploadSchoolFile, UploadRejectedError } from '../../src/lib/uploads/uploadSchoolFile.js';
import { humanizeError } from '../../src/lib/errorMessages.js';
import { completeOnboardingTenantCreation, mapOnboardingError } from '../../src/lib/onboardingTenantCreation.js';
import { createOnboardingBackend, FULL_CONSENT } from '../fixtures/onboarding-backend.js';

// v1.9.0 (server-minor). Three screens called base44.integrations.Core.UploadFile
// from the browser: any signed-in account could push any file, of any size and
// type, to public storage. uploadSchoolFile now decides who may upload, for
// what, and checks the bytes — not just the name.

const ROOT = new URL('../../', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, ROOT), 'utf8');
const MB = 1024 * 1024;

const bytes = (...parts) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? Array.from(p, (c) => c.charCodeAt(0)) : p)));
const SAMPLES = {
  pdf: bytes('%PDF-1.7\n', '1 0 obj'),
  png: bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'IHDR'),
  jpeg: bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF'),
  gif: bytes('GIF89a', [1, 0, 1, 0]),
  webp: bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '),
  doc: bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 'x'),
  docx: bytes([0x50, 0x4b, 0x03, 0x04], '....[Content_Types].xml....word/document.xml'),
};

test('the type comes from the bytes: every allowed signature, and a plain zip is not a .docx', () => {
  for (const [type, sample] of Object.entries(SAMPLES)) assert.equal(detectFileType(sample), type, type);
  assert.equal(detectFileType(bytes([0x50, 0x4b, 0x03, 0x04], 'xl/workbook.xml')), null, 'an .xlsx is not a Word file');
  assert.equal(detectFileType(bytes('<!doctype html><script>')), null);
  assert.equal(detectFileType(bytes('%PD')), null, 'a truncated signature is nothing');
  assert.equal(extensionType('Menú.PDF'), 'pdf');
  assert.equal(extensionType('foto.JPG'), 'jpeg');
  assert.equal(extensionType('archivo'), null);
  assert.equal(extensionType('x.pdf.exe'), null, 'only the last extension counts');
});

test('a page renamed .pdf, a PNG renamed .pdf and an image as a document are refused', () => {
  const html = checkFile('official_document', { name: 'menu.pdf', size: 20, bytes: bytes('<html><script>alert(1)</script>') });
  assert.deepEqual(html, { ok: false, status: 415, code: 'FILE_CONTENT_MISMATCH' });
  const png = checkFile('official_document', { name: 'menu.pdf', size: 12, bytes: SAMPLES.png });
  assert.equal(png.code, 'FILE_CONTENT_MISMATCH');
  const img = checkFile('official_document', { name: 'menu.png', size: 12, bytes: SAMPLES.png });
  assert.equal(img.code, 'FILE_TYPE_NOT_ALLOWED', 'Documentos only takes PDFs');
  const svg = checkFile('school_logo', { name: 'logo.svg', size: 30, bytes: bytes('<svg onload="x()">') });
  assert.equal(svg.code, 'FILE_TYPE_NOT_ALLOWED', 'SVG can carry script: not a logo format here');
});

test('size, emptiness and purpose are checked before anything is stored', () => {
  assert.equal(checkFile('official_document', { name: 'a.pdf', size: 10 * MB + 1, bytes: SAMPLES.pdf }).code, 'FILE_TOO_LARGE');
  assert.equal(checkFile('school_logo', { name: 'a.png', size: 5 * MB + 1, bytes: SAMPLES.png }).code, 'FILE_TOO_LARGE');
  assert.equal(checkFile('official_document', { name: 'a.pdf', size: 0, bytes: new Uint8Array() }).code, 'FILE_MISSING');
  assert.equal(checkFile('avatar', { name: 'a.png', size: 12, bytes: SAMPLES.png }).code, 'UPLOAD_PURPOSE_INVALID');
  assert.ok(MAX_REQUEST_BYTES > Math.max(...Object.values(PURPOSES).map((p) => p.maxBytes)));
});

test('an accepted file is stored under a clean name, typed by what it IS', () => {
  const ok = checkFile('setup_document', { name: 'C:\\Users\\Dir\\Reglamento escolar (versión final)!.DOCX', size: 60, bytes: SAMPLES.docx });
  assert.equal(ok.ok, true);
  assert.equal(ok.type, 'docx');
  assert.equal(ok.mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(ok.name, 'Reglamento-escolar-version-final.docx');
  assert.equal(safeFileName('foto.jpeg', 'jpeg'), 'foto.jpg');
  assert.equal(safeFileName('../../etc/passwd.png', 'png'), 'passwd.png');
  assert.equal(safeFileName('###.pdf', 'pdf'), 'archivo.pdf');
  assert.ok(!/\s/.test(safeFileName('a  b\tc.pdf', 'pdf')), 'no whitespace reaches the URL');
});

// Every fixture profile has accepted the current texts (v1.9.0 consent gate);
// the cases that matter override it.
const CURRENT_CONSENT = { consent_notice_version: PRIVACY_NOTICE_VERSION, consent_terms_version: SERVICE_TERMS_VERSION };
const P = (over) => ({ id: 'p', user_id: 'u', school_id: 'sA', app_role: 'ADMIN', status: 'ACTIVE', onboarding_completed: true, created_date: '2026-09-01T00:00:00Z', ...CURRENT_CONSENT, ...over });
const NO_CONSENT = { consent_notice_version: undefined, consent_terms_version: undefined };

test('who: documents are an ACTIVE ADMIN\'s; the logo is for someone founding a school', () => {
  assert.deepEqual(decideUploader({ purpose: 'official_document', isPlatformOwner: false, profiles: [P()] }), { ok: true, schoolId: 'sA', checkLicense: true });
  assert.equal(decideUploader({ purpose: 'official_document', isPlatformOwner: false, profiles: [P({ app_role: 'TEACHER' })] }).code, 'FORBIDDEN');
  assert.equal(decideUploader({ purpose: 'setup_document', isPlatformOwner: false, profiles: [P({ app_role: 'PARENT' })] }).code, 'FORBIDDEN');
  assert.equal(decideUploader({ purpose: 'official_document', isPlatformOwner: false, profiles: [P({ status: 'PENDING' })] }).code, 'INACTIVE_PROFILE');
  assert.equal(decideUploader({ purpose: 'official_document', isPlatformOwner: false, profiles: [] }).code, 'NO_PROFILE');
  // Integration (consent × server-minor): an ADMIN who has not accepted the
  // current Aviso/Términos cannot upload either — same rule as schoolRead.
  assert.equal(decideUploader({ purpose: 'official_document', isPlatformOwner: false, profiles: [P(NO_CONSENT)] }).code, 'CONSENT_REQUIRED');
  assert.equal(decideUploader({ purpose: 'setup_document', isPlatformOwner: false, profiles: [P({ consent_notice_version: '2026-09-29-borrador', consent_terms_version: '2026-09-29-borrador' })] }).code, 'CONSENT_REQUIRED');
  assert.equal(decideUploader({ purpose: 'school_logo', isPlatformOwner: false, profiles: [P(NO_CONSENT)] }).code, 'CONSENT_REQUIRED');
  assert.equal(decideUploader({ purpose: 'school_logo', isPlatformOwner: false, profiles: [P({ ...NO_CONSENT, app_role: 'TEACHER' })] }).code, 'NOT_ONBOARDING');

  // The logo: nobody's profile yet (the only state in which a school is founded)…
  assert.deepEqual(decideUploader({ purpose: 'school_logo', isPlatformOwner: false, profiles: [] }), { ok: true, schoolId: null, checkLicense: false });
  // …but a member waiting for approval, a teacher or a parent cannot use it as free storage.
  for (const p of [P({ status: 'PENDING', app_role: 'TEACHER' }), P({ app_role: 'TEACHER' }), P({ app_role: 'PARENT' })]) {
    assert.equal(decideUploader({ purpose: 'school_logo', isPlatformOwner: false, profiles: [p] }).code, 'NOT_ONBOARDING');
  }
  assert.equal(decideUploader({ purpose: 'school_logo', isPlatformOwner: false, profiles: [P()] }).ok, true);
  assert.deepEqual(decideUploader({ purpose: 'official_document', isPlatformOwner: true, profiles: [] }), { ok: true, schoolId: null, checkLicense: false });
});

test('the upload function picks "my school" and reads the license by the same rules as everything else', () => {
  const sets = [
    [P({ id: 'a', created_date: '2026-09-02' }), P({ id: 'b', status: 'PENDING', created_date: '2026-09-03' })],
    [P({ id: 'a', onboarding_completed: false }), P({ id: 'b', created_date: '2026-08-01' })],
    [P({ status: 'SUSPENDED' })],
    [P({ app_role: 'OWNER' })],
    [P(NO_CONSENT)],
    [P({ id: 'a', ...NO_CONSENT, created_date: '2026-09-02' }), P({ id: 'b', created_date: '2026-08-01' })],
    [],
  ];
  for (const set of sets) {
    assert.deepEqual(uploadSelect(set), readSelect(set));
    assert.deepEqual(uploadSelect([...set].reverse()), readSelect(set));
    assert.equal(uploadProblemOf(uploadSelect(set)), readProblem(readSelect(set)));
  }
  const now = new Date('2026-10-02T12:00:00Z');
  const subs = [null, { subscription_status: 'active' }, { subscription_status: 'view_only' }, { subscription_status: 'trial', trial_end_date: '2026-10-01T00:00:00Z' },
    { subscription_status: 'trial', trial_end_date: '2026-11-01T00:00:00Z' }, { subscription_status: 'trial' }, { subscription_status: 'suspended', license_tier: 'founder' },
    { subscription_status: 'active', license_tier: 'founder' }];
  for (const sub of subs) assert.equal(uploadReadOnly(sub, now), writeReadOnly(sub, now), JSON.stringify(sub));
});

test('the daily cap counts Mexico\'s day, and zone-less Base44 dates as UTC', () => {
  const now = new Date('2026-10-02T15:00:00Z'); // 09:00 in Mexico
  const rows = [
    { id: 'a', created_date: '2026-10-02T06:30:00' }, // 00:30 Mexico, today
    { id: 'b', created_date: '2026-10-02T05:59:00Z' }, // 23:59 yesterday in Mexico
    { id: 'c', created_date: '2026-10-02T14:00:00.000Z' },
    { id: 'd', created_date: 'not a date' },
  ];
  // Yesterday's row and the unreadable one do not count ahead of today's.
  assert.equal(claimRank(rows, 'a', now), 0);
  assert.equal(claimRank(rows, 'c', now), 1);
  assert.equal(claimRank(rows, 'b', now), -1);
  // Same instant: the id decides, the same way for every reader.
  const tie = [{ id: 'y', created_date: '2026-10-02T14:00:00Z' }, { id: 'x', created_date: '2026-10-02T14:00:00Z' }];
  assert.equal(claimRank(tie, 'x', now), 0);
  assert.equal(claimRank([...tie].reverse(), 'x', now), 0);
});

// The cap, race-free (Codex review of PR #197): the first version read the
// count, uploaded, and only then wrote the counter — best-effort. Concurrent
// requests all saw 59 and all uploaded, and a failing AuditLog never counted.
const QUOTA_NOW = new Date('2026-10-02T18:00:00Z'); // 12:00 in Mexico
const UPLOADER = { id: 'u-dir', email: 'dir@ejemplo.mx' };
function quotaWorld(alreadyToday) {
  const AuditLog = Array.from({ length: alreadyToday }, (_, i) => ({
    id: `old-${String(i).padStart(3, '0')}`,
    user_id: UPLOADER.id,
    target_type: UPLOAD_AUDIT_TARGET,
    target_id: uploadDayKey(UPLOADER.id, QUOTA_NOW),
    created_date: `2026-10-02T07:${String(i % 60).padStart(2, '0')}:00.000Z`,
  }));
  return { AuditLog };
}
const runQuota = (db, upload) => uploadWithinDailyLimit({
  sr: db, user: UPLOADER, schoolId: 'sA', purpose: 'official_document', fileType: 'pdf', size: 10, now: QUOTA_NOW, upload,
});

test('the daily cap holds under concurrency: with one slot left, five simultaneous uploads store exactly one file', async () => {
  const tables = quotaWorld(DAILY_UPLOAD_LIMIT - 1);
  const db = makeFakeMongoDb(tables);
  let stored = 0;
  const upload = async () => { stored += 1; return `https://cdn.base44.app/f/${stored}.pdf`; };
  const results = await Promise.all(Array.from({ length: 5 }, () => runQuota(db, upload)));
  assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.body.code)));
  assert.equal(stored, 1, 'only the request inside the cap reached the storage');
  for (const r of results.filter((x) => x.status !== 200)) assert.equal(r.body.code, 'UPLOAD_DAILY_LIMIT');
  assert.equal(tables.AuditLog.length, DAILY_UPLOAD_LIMIT, 'refused claims are released; the stored one stays as the record');
  const record = tables.AuditLog.find((r) => r.details?.state === 'stored');
  assert.equal(record.details.file_url, 'https://cdn.base44.app/f/1.pdf');
  // Next one: refused, nothing stored.
  assert.equal((await runQuota(db, upload)).body.code, 'UPLOAD_DAILY_LIMIT');
  assert.equal(stored, 1);
});

test('the slot is reserved BEFORE storing; no reservation, no upload (fail closed)', async () => {
  const tables = quotaWorld(0);
  let stored = 0;
  const upload = async () => { stored += 1; return 'https://cdn.base44.app/f/x.pdf'; };
  // The claim cannot be written: nothing is stored.
  const r = await runQuota(makeFakeMongoDb(tables, { failOn: { entity: 'AuditLog', op: 'create', message: 'enum value not deployed' } }), upload);
  assert.deepEqual([r.status, r.body.code], [503, 'UPLOAD_QUOTA_UNAVAILABLE']);
  const limited = await runQuota(makeFakeMongoDb(tables, { failOn: { entity: 'AuditLog', op: 'create', message: 'Rate limit exceeded', status: 429 } }), upload);
  assert.deepEqual([limited.status, limited.body.code], [429, 'RATE_LIMITED']);
  // The re-count cannot be read: the claim is released, nothing is stored.
  const blind = await runQuota(makeFakeMongoDb(tables, { failOn: { entity: 'AuditLog', op: 'filter', message: 'boom' } }), upload);
  assert.deepEqual([blind.status, blind.body.code], [503, 'UPLOAD_QUOTA_UNAVAILABLE']);
  assert.equal(stored, 0);
  assert.equal(tables.AuditLog.length, 0);
  assert.match(humanizeError(Object.assign(new Error('x'), { data: { code: 'UPLOAD_QUOTA_UNAVAILABLE' } })), /No se pudo preparar la subida/);
});

test('a failed upload gives its slot back; a failed URL note does not undo the count', async () => {
  const tables = quotaWorld(DAILY_UPLOAD_LIMIT - 1);
  const failed = await runQuota(makeFakeMongoDb(tables, { idPrefix: 'a' }), async () => { throw new Error('storage down'); });
  assert.deepEqual([failed.status, failed.body.code], [502, 'UPLOAD_FAILED']);
  const empty = await runQuota(makeFakeMongoDb(tables, { idPrefix: 'b' }), async () => '');
  assert.equal(empty.body.code, 'UPLOAD_FAILED');
  assert.equal(tables.AuditLog.length, DAILY_UPLOAD_LIMIT - 1, 'both claims released');
  // The last slot still works, even when adding the URL to the claim fails:
  // the claim already counts.
  const ok = await runQuota(makeFakeMongoDb(tables, { idPrefix: 'c', failOn: { entity: 'AuditLog', op: 'update', message: 'boom' } }), async () => 'https://cdn.base44.app/f/z.pdf');
  assert.equal(ok.status, 200);
  assert.equal(tables.AuditLog.length, DAILY_UPLOAD_LIMIT);
  assert.equal((await runQuota(makeFakeMongoDb(tables, { idPrefix: 'd' }), async () => 'https://cdn.base44.app/f/w.pdf')).body.code, 'UPLOAD_DAILY_LIMIT');
});

test('the count reads only TODAY\'s claims: a long history never locks the cap; a full page of today refuses', async () => {
  assert.equal(mexicoDayKey(new Date('2026-10-02T05:59:00Z')), '2026-10-01', '23:59 in Mexico is still yesterday');
  assert.equal(uploadDayKey('u-1', QUOTA_NOW), 'upload:u-1:2026-10-02');
  // 600 uploads over the 10 previous days, none today: allowed (the first
  // version read the newest 500 rows of ALL history and refused forever).
  const history = { AuditLog: Array.from({ length: 600 }, (_, i) => {
    const day = new Date(Date.UTC(2026, 8, 22 + Math.floor(i / 60), 18, i % 60));
    return { id: `h-${String(i).padStart(4, '0')}`, user_id: UPLOADER.id, target_type: UPLOAD_AUDIT_TARGET, target_id: uploadDayKey(UPLOADER.id, day), created_date: day.toISOString() };
  }) };
  let stored = 0;
  const upload = async () => { stored += 1; return 'https://cdn.base44.app/f/q.pdf'; };
  const ok = await runQuota(makeFakeMongoDb(history), upload);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(stored, 1);
  // 60 today: refused, nothing stored.
  const full = quotaWorld(DAILY_UPLOAD_LIMIT);
  full.AuditLog.push(...history.AuditLog);
  assert.equal((await runQuota(makeFakeMongoDb(full), upload)).body.code, 'UPLOAD_DAILY_LIMIT');
  assert.equal(stored, 1);
  // A page of today's own claims that cannot be seen whole: fail closed.
  const burst = quotaWorld(QUOTA_READ_LIMIT);
  assert.equal((await runQuota(makeFakeMongoDb(burst), upload)).body.code, 'UPLOAD_DAILY_LIMIT');
  assert.equal(stored, 1);
});

test('only an http(s) URL back from Core.UploadFile counts as stored, in either SDK response shape', () => {
  assert.equal(uploadedUrl({ file_url: 'https://cdn.base44.app/f/x.pdf' }), 'https://cdn.base44.app/f/x.pdf');
  assert.equal(uploadedUrl({ data: { file_url: 'https://cdn.base44.app/f/y.pdf' } }), 'https://cdn.base44.app/f/y.pdf');
  assert.equal(uploadedUrl({ file_url: 'javascript:alert(1)' }), '');
  assert.equal(uploadedUrl({}), '');
});

test('the browser table is the server table', () => {
  assert.deepEqual(Object.keys(UPLOAD_PURPOSES).sort(), Object.keys(PURPOSES).sort());
  for (const [purpose, rule] of Object.entries(PURPOSES)) {
    assert.deepEqual(UPLOAD_PURPOSES[purpose].types, rule.types, purpose);
    assert.equal(UPLOAD_PURPOSES[purpose].maxBytes, rule.maxBytes, purpose);
  }
  assert.deepEqual(UPLOAD_EXTENSIONS, EXTENSIONS);
});

test('the browser warns in Spanish before uploading a file the server would refuse', () => {
  assert.equal(uploadProblem('official_document', { name: 'a.pdf', size: 100 }), null);
  assert.match(uploadProblem('official_document', { name: 'a.docx', size: 100 }), /debe ser PDF/);
  assert.match(uploadProblem('setup_document', { name: 'a.exe', size: 100 }), /PDF, Word \(\.doc\), Word \(\.docx\), JPG o PNG/);
  assert.match(uploadProblem('school_logo', { name: 'a.png', size: 6 * MB }), /más de 5 MB/);
  assert.match(uploadProblem('school_logo', { name: 'a.png', size: 0 }), /vacío/);
});

test('a file whose name has no extension goes up named after what the browser says it is', async () => {
  // A phone gallery or a cloud picker can hand over "IMG_2041" or "documento".
  // The server goes by extension + bytes, so without this a real PDF read as
  // "El archivo debe ser PDF" — while isPdfFile (by MIME) had just said yes.
  assert.equal(typedFileName({ name: 'documento', type: 'application/pdf' }), 'documento.pdf');
  assert.equal(typedFileName({ name: 'IMG_2041', type: 'image/jpeg' }), 'IMG_2041.jpg');
  assert.equal(typedFileName({ name: 'a.pdf', type: 'image/png' }), 'a.pdf', 'a known extension is never rewritten');
  assert.equal(typedFileName({ name: 'notas', type: 'text/html' }), 'notas', 'an unlisted MIME type adds nothing');
  assert.equal(uploadProblem('official_document', { name: 'documento', type: 'application/pdf', size: 10 }), null);
  assert.match(uploadProblem('official_document', { name: 'documento', size: 10 }), /debe ser PDF/);

  const original = new File([SAMPLES.pdf], 'documento', { type: 'application/pdf' });
  const renamed = withTypedName(original);
  assert.equal(renamed.name, 'documento.pdf');
  assert.equal(renamed.size, original.size, 'same bytes');
  const named = new File([SAMPLES.pdf], 'a.pdf', { type: 'application/pdf' });
  assert.equal(withTypedName(named), named, 'nothing to fix: the same object');

  const calls = [];
  const client = { functions: { async invoke(name, payload) { calls.push(payload); return { data: { ok: true, file_url: 'https://cdn.test/d.pdf' }, status: 200, headers: {} }; } } };
  await uploadSchoolFile(client, { purpose: 'official_document', file: original });
  assert.equal(calls[0].file.name, 'documento.pdf');
  // And the server accepts exactly that name for those bytes.
  const bytes = new Uint8Array(await calls[0].file.arrayBuffer());
  assert.equal(checkFile('official_document', { name: calls[0].file.name, size: bytes.length, bytes }).ok, true);
});

test('uploadSchoolFile (client) sends purpose + File to the function and returns the URL; never Core.UploadFile', async () => {
  const calls = [];
  const client = {
    integrations: { Core: { UploadFile: async () => { throw new Error('must not be called'); } } },
    functions: {
      async invoke(name, payload) {
        calls.push({ name, payload });
        return { data: { ok: true, file_url: 'https://cdn.test/a.pdf' }, status: 200, headers: {} };
      },
    },
  };
  const file = new File([SAMPLES.pdf], 'Menú.pdf', { type: 'application/pdf' });
  assert.equal(await uploadSchoolFile(client, { purpose: 'official_document', file }), 'https://cdn.test/a.pdf');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'uploadSchoolFile');
  assert.equal(calls[0].payload.purpose, 'official_document');
  assert.ok(calls[0].payload.file instanceof File, 'a File value makes the SDK send multipart/form-data');

  await assert.rejects(
    uploadSchoolFile(client, { purpose: 'official_document', file: new File([SAMPLES.png], 'x.png') }),
    (e) => e instanceof UploadRejectedError && humanizeError(e) === 'El archivo debe ser PDF.',
  );
  assert.equal(calls.length, 1, 'a certain refusal never reaches the network');

  const refusing = { functions: { async invoke() { throw Object.assign(new Error('415'), { response: { status: 415, data: { ok: false, code: 'FILE_CONTENT_MISMATCH' } } }); } } };
  await assert.rejects(uploadSchoolFile(refusing, { purpose: 'official_document', file }), (e) => /no corresponde a su extensión/.test(humanizeError(e)));
  const empty = { functions: { async invoke() { return { data: { ok: true }, status: 200 }; } } };
  await assert.rejects(uploadSchoolFile(empty, { purpose: 'official_document', file }), (e) => humanizeError(e) === 'No se pudo guardar el archivo. Inténtalo de nuevo en un momento.');
});

test('onboarding: the logo goes through uploadSchoolFile, and a refused logo creates nothing and says why', async () => {
  const founder = { id: 'u-founder', email: 'f@example.com', full_name: 'F' };
  const formData = { role: 'ADMIN', newSchoolName: 'Colegio Nuevo', phone: '' };
  const base = { notificationService: { sendByEvent: async () => {} }, logAuditEvent: async () => {}, user: founder, formData, themePreview: null, consent: FULL_CONSENT };

  const good = createOnboardingBackend({}, founder);
  await completeOnboardingTenantCreation({ ...base, base44: good.client, logoFile: new File([SAMPLES.png], 'logo.png', { type: 'image/png' }) });
  assert.deepEqual(good.invokeCalls.map((c) => c.name), ['uploadSchoolFile', 'provisionOnboardingProfile']);
  assert.equal(good.invokeCalls[0].body.purpose, 'school_logo');
  assert.equal(good.invokeCalls[1].body.newSchool.logo_url, 'https://cdn.test/logo.png');

  const bad = createOnboardingBackend({}, founder);
  const big = new File([new Uint8Array(5 * MB + 1)], 'logo.png', { type: 'image/png' });
  let caught = null;
  await completeOnboardingTenantCreation({ ...base, base44: bad.client, logoFile: big }).catch((e) => { caught = e; });
  assert.ok(caught, 'a refused logo stops onboarding');
  assert.equal(bad.invokeCalls.length, 0, 'no school was provisioned');
  const mapped = mapOnboardingError(caught);
  assert.equal(mapped.code, 'logo_upload_failed');
  assert.match(mapped.message, /No pudimos subir el logo: el archivo pesa más de 5 MB.*sin logo/);
});

test('no screen calls Core.UploadFile (or any Core integration) from the browser any more', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(new URL(dir, ROOT), { withFileTypes: true })) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) walk(`${rel}/`);
      else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
        const src = read(rel).replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        if (/integrations\s*\.\s*Core\s*\.\s*\w+\s*\(/.test(src)) offenders.push(rel);
      }
    }
  };
  walk('src/');
  assert.deepEqual(offenders, []);
});

test('entry.ts: size gate before parsing, WHO before reading the bytes, profiles pinned to the caller', () => {
  const src = read('base44/functions/uploadSchoolFile/entry.ts');
  const order = ['content-length', 'req.formData()', 'decideUploader(', 'effectiveLicenseIsReadOnly(', 'file.arrayBuffer()', 'checkFile(', 'uploadWithinDailyLimit('];
  let last = -1;
  for (const marker of order) {
    const at = src.indexOf(marker);
    assert.ok(at > last, `${marker} comes after the previous step`);
    last = at;
  }
  // Everyone but the platform owner stores ONLY through the reservation.
  assert.equal((src.match(/Core\.UploadFile\(/g) || []).length, 1, 'one storage call, wrapped');
  assert.match(src, /upload: store,/);
  assert.equal((src.match(/await store\(\)/g) || []).length, 1, 'called directly only on the owner branch');
  const ownerBranch = src.indexOf("if (user.role === 'admin') {");
  assert.ok(ownerBranch > 0 && ownerBranch < src.indexOf('await store()') && src.indexOf('await store()') < src.indexOf('} else {', ownerBranch),
    'the direct call is inside the owner branch');
  assert.match(src, /UserProfile\.filter\(\{ user_id: user\.id \}/);
  assert.match(src, /new File\(\[bytes\], checked\.name, \{ type: checked\.mime \}\)/);
  assert.doesNotMatch(src, /school_id:\s*form\.get|form\.get\('school/, 'the school never comes from the request');
});

test('a deleted account (User not yet removed) cannot upload: 410 like the onboarding', async () => {
  const { accountDeletedAt: consentDeletedAt } = await import('../../base44/functions/myConsent/_consent.ts');
  for (const u of [null, {}, { account_deleted_at: '2026-10-02T10:00:00Z' }, { data: { account_deleted_at: '2026-10-02T10:00:00Z' } }, { account_deleted_at: 7 }]) {
    assert.equal(uploadDeletedAt(u), consentDeletedAt(u), JSON.stringify(u));
  }
  const entry = fs.readFileSync(new URL('../../base44/functions/uploadSchoolFile/entry.ts', import.meta.url), 'utf8');
  const auth = entry.indexOf("fail(401, 'UNAUTHENTICATED')");
  const gate = entry.indexOf("if (accountDeletedAt(user)) return fail(410, 'ACCOUNT_DELETED')");
  const firstRead = entry.indexOf('sr.entities.');
  assert.ok(auth > 0 && gate > auth && gate < firstRead, 'checked right after auth, before any entity call');
});
