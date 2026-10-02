// _upload.ts — the rules of uploadSchoolFile, import-free so node --test runs
// them (Node 22 strips the types).
//
// WHY THIS EXISTS (v1.9.0, server-minor). Three screens called
// base44.integrations.Core.UploadFile straight from the browser — the
// onboarding logo, Documentos (official PDFs) and the setup guide's
// attachments. Any signed-in account, of any school or none, could push any
// file of any size and type to the app's public storage and get back a public
// URL: an .html page served from our storage domain, a 200 MB video, a file
// claiming to be a PDF that is not. The same Base44 scan item that moved
// SendEmail/InvokeLLM out of the browser (credits) applies to storage.
//
// What the server decides now, in this order:
//   1. WHY: `purpose` is one of PURPOSES; nothing else uploads.
//   2. WHO: the caller's role, re-derived from their own UserProfile rows
//      (selectCurrentProfile — the same rule schoolRead and guardedEntityWrite
//      use, tested for equality). Documents are a school ADMIN's; the logo is
//      for someone founding a school (no profile yet), or an ADMIN.
//   3. WHAT: extension AND magic bytes must name the same allowed type, and the
//      size must fit the purpose. The stored file is re-wrapped with a clean
//      name and the MIME type of what the bytes ARE, never what the browser
//      claimed.
//   4. HOW MUCH: a per-user daily cap, counted in AuditLog (durable, unlike an
//      in-memory bucket — uploads are rare enough to afford the read).

export type FileType = 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'doc' | 'docx';
export type Who = 'onboarding' | 'admin';

export type PurposeRule = {
  types: FileType[];
  maxBytes: number;
  who: Who;
  /** Whether the school's license must allow writes (a document is a write). */
  needsWritableLicense: boolean;
};

const MB = 1024 * 1024;

// MIRRORED BY src/lib/uploads/uploadRules.js (the form's early warning);
// tests/unit/upload-school-file.test.js fails if they differ.
export const PURPOSES: Record<string, PurposeRule> = {
  // Onboarding.jsx: the founding director's school logo (accept="image/*").
  school_logo: { types: ['png', 'jpeg', 'webp', 'gif'], maxBytes: 5 * MB, who: 'onboarding', needsWritableLicense: false },
  // GestionDocumentos.jsx: menus, comunicados, minutas, catálogo (PDF only).
  official_document: { types: ['pdf'], maxBytes: 10 * MB, who: 'admin', needsWritableLicense: true },
  // ConfiguracionInicial.jsx: a setup step's attachment (.pdf,.doc,.docx,.jpg,.png).
  setup_document: { types: ['pdf', 'doc', 'docx', 'jpeg', 'png'], maxBytes: 10 * MB, who: 'admin', needsWritableLicense: true },
};

/** Uploads per user per Mexico day, across purposes. */
export const DAILY_UPLOAD_LIMIT = 60;

/** The largest request body the function will even parse (largest file + form overhead). */
export const MAX_REQUEST_BYTES = 10 * MB + 64 * 1024;

export const EXTENSIONS: Record<string, FileType> = {
  pdf: 'pdf', png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp', doc: 'doc', docx: 'docx',
};

export const MIME_TYPES: Record<FileType, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

function ascii(text: string): number[] {
  return Array.from(text, (c) => c.charCodeAt(0));
}

function contains(bytes: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i + needle.length <= bytes.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * What the bytes ARE, from their signature — or null. A .docx is a ZIP whose
 * central directory names `word/document.xml` (names are stored uncompressed),
 * so a renamed .zip or .xlsx is not taken for one.
 */
export function detectFileType(bytes: Uint8Array): FileType | null {
  if (startsWith(bytes, ascii('%PDF-'))) return 'pdf';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'gif';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'webp';
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'doc';
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && contains(bytes, ascii('word/document.xml'))) return 'docx';
  return null;
}

/** The type a file NAME claims, from its last extension — or null. */
export function extensionType(name: string): FileType | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(name || '').trim());
  if (!match) return null;
  return EXTENSIONS[match[1].toLowerCase()] ?? null;
}

const CANONICAL_EXTENSION: Record<FileType, string> = {
  pdf: 'pdf', png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp', doc: 'doc', docx: 'docx',
};

/**
 * A storage-safe name: no path, no spaces or URL-hostile characters, accents
 * folded, at most 80 characters, ending in the canonical extension of what the
 * bytes are. Core.UploadFile can put the name into the public URL, and a URL
 * with spaces once blocked every later edit of a setup step (v1.8.2).
 */
export function safeFileName(name: string, type: FileType): string {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const stem = base.replace(/\.[A-Za-z0-9]+$/, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80) || 'archivo';
  return `${stem}.${CANONICAL_EXTENSION[type]}`;
}

export type FileCheck =
  | { ok: true; type: FileType; mime: string; name: string }
  | { ok: false; status: number; code: string };

/** Extension + magic bytes + size, for one purpose. */
export function checkFile(purpose: string, file: { name: string; size: number; bytes: Uint8Array }): FileCheck {
  const rule = PURPOSES[purpose];
  if (!rule) return { ok: false, status: 400, code: 'UPLOAD_PURPOSE_INVALID' };
  if (!file || !(file.size > 0) || !file.bytes || file.bytes.length === 0) return { ok: false, status: 400, code: 'FILE_MISSING' };
  if (file.size > rule.maxBytes || file.bytes.length > rule.maxBytes) return { ok: false, status: 413, code: 'FILE_TOO_LARGE' };
  const claimed = extensionType(file.name);
  if (!claimed || !rule.types.includes(claimed)) return { ok: false, status: 415, code: 'FILE_TYPE_NOT_ALLOWED' };
  const actual = detectFileType(file.bytes);
  if (actual !== claimed) return { ok: false, status: 415, code: 'FILE_CONTENT_MISMATCH' };
  return { ok: true, type: actual, mime: MIME_TYPES[actual], name: safeFileName(file.name, actual) };
}

// --- Who may upload -------------------------------------------------------------

export type Profile = {
  id?: string;
  user_id?: string;
  school_id?: string;
  app_role?: string;
  status?: string;
  onboarding_completed?: boolean;
  created_date?: string;
  consent_notice_version?: string;
  consent_terms_version?: string;
};

// MIRRORS schoolRead/_scope.ts#selectCurrentProfile and
// guardedEntityWrite/_policy.ts#selectCurrentProfile (tested for equality).
export function selectCurrentProfile(profiles: Profile[] = []): Profile | null {
  const sorted = [...(profiles || [])].sort((a, b) =>
    String(b.created_date || '').localeCompare(String(a.created_date || '')));
  const eligible = sorted.filter((p) => p.status === 'ACTIVE' && p.onboarding_completed);
  return eligible[0] || sorted[0] || null;
}

// The Aviso de Privacidad / Términos versions in force (v1.9.0). MIRRORS
// src/lib/consent/privacyNotice.js and every other copy under
// base44/functions/ — tests/unit/consent-gate.test.js fails if any differs.
export const CONSENT_NOTICE_VERSION = '2026-10-02';
export const CONSENT_TERMS_VERSION = '2026-10-02';

// MIRRORS schoolRead/_scope.ts#profileConsentIsCurrent.
export function profileConsentIsCurrent(profile: { consent_notice_version?: unknown; consent_terms_version?: unknown } | null): boolean {
  return Boolean(profile)
    && profile!.consent_notice_version === CONSENT_NOTICE_VERSION
    && profile!.consent_terms_version === CONSENT_TERMS_VERSION;
}

// MIRRORS schoolRead/_scope.ts#profileProblem (tested for equality), including
// CONSENT_REQUIRED: an ADMIN who has not accepted the current texts cannot
// upload school documents either. The founder's logo (no profile yet) is not
// affected — the onboarding records its own consent.
export function profileProblem(profile: Profile | null): string | null {
  if (!profile) return 'NO_PROFILE';
  if (profile.status !== 'ACTIVE') return 'INACTIVE_PROFILE';
  if (!profile.school_id) return 'NO_SCHOOL';
  if (!['ADMIN', 'TEACHER', 'PARENT'].includes(String(profile.app_role))) return 'INVALID_ROLE';
  if (!profileConsentIsCurrent(profile)) return 'CONSENT_REQUIRED';
  return null;
}

// MIRRORS myConsent/_consent.ts#accountDeletedAt (and
// src/lib/account/accountDeletion.js#accountDeletedAt). A deleted account
// whose User the platform would not remove has no profile left — the
// "founding" state — so without this it could still push logos to storage.
export function accountDeletedAt(user: unknown): string {
  const u = (user ?? {}) as { account_deleted_at?: unknown; data?: { account_deleted_at?: unknown } | null };
  const v = u.account_deleted_at ?? u.data?.account_deleted_at;
  return typeof v === 'string' ? v : '';
}

export type UploaderDecision =
  | { ok: true; schoolId: string | null; checkLicense: boolean }
  | { ok: false; status: number; code: string };

/**
 * May this caller upload for this purpose, and on behalf of which school?
 *   - platform owner (User.role 'admin'): always; no school, no license check.
 *   - 'admin' purposes: the caller's CURRENT profile must be an ACTIVE ADMIN.
 *   - 'onboarding' (the logo): someone with NO UserProfile at all — the only
 *     state in which provisionOnboardingProfile founds a school (any profile
 *     there is ALREADY_ONBOARDED) — or an ACTIVE ADMIN.
 */
export function decideUploader(input: { purpose: string; isPlatformOwner: boolean; profiles: Profile[] }): UploaderDecision {
  const rule = PURPOSES[input.purpose];
  if (!rule) return { ok: false, status: 400, code: 'UPLOAD_PURPOSE_INVALID' };
  if (input.isPlatformOwner) return { ok: true, schoolId: null, checkLicense: false };
  const mine = input.profiles || [];
  const profile = selectCurrentProfile(mine);
  const isActiveAdmin = !profileProblem(profile) && profile!.app_role === 'ADMIN';
  if (rule.who === 'onboarding') {
    if (mine.length === 0) return { ok: true, schoolId: null, checkLicense: false };
    if (isActiveAdmin) return { ok: true, schoolId: String(profile!.school_id), checkLicense: false };
    // A director who only lacks the current consent is told so, not that the
    // logo belongs to the director.
    if (profileProblem(profile) === 'CONSENT_REQUIRED' && profile!.app_role === 'ADMIN') {
      return { ok: false, status: 403, code: 'CONSENT_REQUIRED' };
    }
    return { ok: false, status: 403, code: 'NOT_ONBOARDING' };
  }
  const problem = profileProblem(profile);
  if (problem) return { ok: false, status: 403, code: problem };
  if (!isActiveAdmin) return { ok: false, status: 403, code: 'FORBIDDEN' };
  return { ok: true, schoolId: String(profile!.school_id), checkLicense: rule.needsWritableLicense };
}

// MIRRORS guardedEntityWrite/_policy.ts#effectiveLicenseIsReadOnly (and
// src/lib/license/licenseModel.js#resolveEffectiveLicense); tested.
export const READ_ONLY_STATUSES = ['view_only', 'suspended', 'inactive', 'canceled'];
export function effectiveLicenseIsReadOnly(
  sub: { subscription_status?: string; license_tier?: string; trial_end_date?: string } | null,
  now: Date,
): boolean {
  if (!sub) return true;
  const status = String(sub.subscription_status || 'trial');
  if (READ_ONLY_STATUSES.includes(status)) return true;
  if (sub.license_tier === 'founder') return false;
  if (status === 'trial') {
    const end = Date.parse(String(sub.trial_end_date || ''));
    return Number.isNaN(end) || end <= now.getTime();
  }
  return false;
}

// --- Daily cap --------------------------------------------------------------------

/** Start of today in Mexico (fixed UTC-6 since 2022), as an instant. */
export function mexicoDayStart(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return Date.parse(`${get('year')}-${get('month')}-${get('day')}T06:00:00.000Z`);
}

/** How many of these audit rows fall on today's Mexico day. Base44 dates may lack a zone; they are UTC. */
export function uploadsToday(rows: Array<{ created_date?: string }>, now: Date): number {
  const since = mexicoDayStart(now);
  return (rows || []).filter((r) => {
    const raw = String(r.created_date || '');
    const t = Date.parse(/([zZ]|[+-]\d\d:\d\d)$/.test(raw) ? raw : `${raw}Z`);
    return Number.isFinite(t) && t >= since;
  }).length;
}

/** AuditLog target_type for every upload (the daily cap counts these). */
export const UPLOAD_AUDIT_TARGET = 'uploadSchoolFile';

/** The URL Core.UploadFile answered, whatever shape the SDK build returns. */
export function uploadedUrl(result: unknown): string {
  // deno-lint-ignore no-explicit-any
  const r = result as any;
  const url = r?.file_url ?? r?.data?.file_url ?? '';
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}
