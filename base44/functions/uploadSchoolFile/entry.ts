// uploadSchoolFile — the only way a file reaches the app's storage (v1.9.0).
//
// Replaces three browser calls to base44.integrations.Core.UploadFile
// (Onboarding's logo, GestionDocumentos, ConfiguracionInicial): see
// ./_upload.ts for why and for every rule. This file is only the Deno/SDK
// half — authenticate, parse the multipart body, read the caller's own
// profile rows and license, upload with the service role, audit.
//
// Request: multipart/form-data (what base44.functions.invoke sends when a
// value is a File) with `purpose` and `file`. The client wrapper is
// src/lib/uploads/uploadSchoolFile.js.
// Response: { ok: true, file_url, content_type, size } or
//           { ok: false, code, error } — codes mapped to Spanish in
//           src/lib/errorMessages.js.
//
// NOT VERIFIED LIVE: that the service-role Core.UploadFile accepts the
// re-wrapped File from inside a function the way the browser SDK does (both
// go through the same SDK FormData path; the integration is documented for
// backend functions). A failure there answers 502 UPLOAD_FAILED — the screen
// says so and nothing is half-saved, since the record is only written after
// the URL comes back.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';
import { withDeletionGuard } from './_deletionGuard.ts';
import {
  type Profile,
  accountDeletedAt,
  checkFile,
  decideUploader,
  effectiveLicenseIsReadOnly,
  uploadedUrl,
  uploadWithinDailyLimit,
  MAX_REQUEST_BYTES,
  UPLOAD_AUDIT_TARGET,
} from './_upload.ts';

function fail(status: number, code: string): Response {
  return Response.json({ ok: false, code, error: code }, { status });
}

Deno.serve(withDeletionGuard(async (req, guarded) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return fail(401, 'UNAUTHENTICATED');
    // Same 410 as provisionOnboardingProfile and myConsent (v1.9.0 consent).
    if (accountDeletedAt(user)) return fail(410, 'ACCOUNT_DELETED');
    // A deletion of this account started or finished (deleteMyAccount): no
    // access here, whatever consent stamp a race may have left behind.
    // auth.me() returns the User's custom fields, so this costs no read.
    if (accountDeletionBlocked(user)) return Response.json({ ok: false, code: 'ACCOUNT_DELETION_IN_PROGRESS', error: 'ACCOUNT_DELETION_IN_PROGRESS' }, { status: 403 });

    // Refuse an oversized body before parsing it into memory.
    const length = Number(req.headers.get('content-length') || '0');
    if (length > MAX_REQUEST_BYTES) return fail(413, 'FILE_TOO_LARGE');

    const form = await req.formData().catch(() => null);
    if (!form) return fail(400, 'FILE_MISSING');
    const purpose = String(form.get('purpose') || '');
    const file = form.get('file');
    if (!(file instanceof File)) return fail(400, 'FILE_MISSING');

    // Every write checked against a concurrent deletion (./_deletionGuard.ts).
    const sr = guarded(base44.asServiceRole, String(user.id));
    // The caller's OWN rows, pinned to user.id (never a school from the body).
    const profiles: Profile[] = await sr.entities.UserProfile.filter({ user_id: user.id }, '-created_date', 50);
    const mine = (profiles || []).filter((p) => String(p.user_id || '') === String(user.id));
    const who = decideUploader({ purpose, isPlatformOwner: user.role === 'admin', profiles: mine });
    if (!who.ok) return fail(who.status, who.code);

    if (who.checkLicense && who.schoolId) {
      const subs = await sr.entities.SchoolSubscription.filter({ school_id: who.schoolId }, '-created_date', 1);
      if (effectiveLicenseIsReadOnly((subs || [])[0] || null, new Date())) return fail(403, 'WRITE_BLOCKED');
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = checkFile(purpose, { name: file.name, size: file.size, bytes });
    if (!checked.ok) return fail(checked.status, checked.code);

    // Stored under a clean name, typed by what the bytes are.
    const clean = new File([bytes], checked.name, { type: checked.mime });
    const store = async () => uploadedUrl(await sr.integrations.Core.UploadFile({ file: clean }));

    let url = '';
    if (user.role === 'admin') {
      // The platform owner has no cap; the record is still kept (best-effort).
      try { url = await store(); } catch (e) { console.error('uploadSchoolFile upload failed', (e as Error)?.message); }
      if (!url) return fail(502, 'UPLOAD_FAILED');
      await sr.entities.AuditLog.create({
        school_id: who.schoolId || 'onboarding',
        user_id: user.id,
        user_email: user.email || '',
        action: 'RECORD_CREATED',
        target_type: UPLOAD_AUDIT_TARGET,
        target_id: purpose,
        details: { purpose, file_type: checked.type, size: bytes.length, state: 'stored', file_url: url },
      }).catch((e: Error) => console.error('uploadSchoolFile audit failed', e?.message));
    } else {
      // The slot is reserved BEFORE the file is stored, and no reservation
      // means no upload — see uploadWithinDailyLimit in ./_upload.ts.
      const result = await uploadWithinDailyLimit({
        sr,
        user,
        schoolId: who.schoolId,
        purpose,
        fileType: checked.type,
        size: bytes.length,
        now: new Date(),
        upload: store,
      });
      if (result.status !== 200) return fail(result.status, String(result.body.code));
      url = String(result.body.file_url);
    }

    return Response.json({ ok: true, file_url: url, content_type: checked.mime, size: bytes.length });
  } catch (e) {
    console.error('uploadSchoolFile failed', (e as Error)?.message);
    return fail(500, 'INTERNAL');
  }
}));

// MIRRORS myConsent/_consent.ts#accountDeletionStartedAt/accountDeletedAt.
// Identical in every consent-gated function; tests/unit/account-deletion.test.js
// checks the copies and where each one is called.
function accountDeletionBlocked(user: unknown): boolean {
  const u = (user ?? {}) as {
    account_deletion_started_at?: unknown;
    account_deleted_at?: unknown;
    data?: { account_deletion_started_at?: unknown; account_deleted_at?: unknown } | null;
  };
  const started = u.account_deletion_started_at ?? u.data?.account_deletion_started_at;
  const deleted = u.account_deleted_at ?? u.data?.account_deleted_at;
  return (typeof started === 'string' && started !== '') || (typeof deleted === 'string' && deleted !== '');
}
