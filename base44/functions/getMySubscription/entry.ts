// getMySubscription — the caller's own school license (+ school header), read
// with the service role.
//
// WHY THIS EXISTS (audit F10, 2026-09-29)
// useSubscription used to read SchoolSubscription straight from the browser.
// Its only tenant read branch depended on {{user.data.school_id}} and
// data.app_role on the built-in User — fields nobody has (the school and role
// live in UserProfile) — so every school user got null: no trial countdown, no
// read-only lock, no license screen. Tenant reads now go through the service
// role, with the school RE-DERIVED from the caller's own ACTIVE UserProfile —
// never from the request body (owner decision, 2026-09-29). The body is
// ignored entirely.
//
// What each role gets:
//   ADMIN          → the subscription minus ACACIA-internal notes, and the
//                    school's join_code (generated here if the school predates
//                    it, so every admin can share a short code).
//   TEACHER/PARENT → status, tier and trial_end_date only.
//   everyone       → `effective` (the one read-only rule, below) and the
//                    school's name / logo / theme.
//
// `effective` MIRRORS src/lib/license/licenseModel.js#resolveEffectiveLicense
// and guardedEntityWrite/entry.ts#effectiveLicense: a missing row or an expired
// trial is READ-ONLY (fail closed). tests/unit/license-lifecycle.test.js checks
// the copies. Profile selection MIRRORS src/lib/tenantSelection.js
// #selectCurrentUserProfile (newest ACTIVE && onboarding_completed).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';

const READ_ONLY_STATUSES = ['view_only', 'suspended', 'inactive', 'canceled'];
const FOUNDER_TIER = 'founder';
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 8;
// ACACIA-internal bookkeeping a school admin has no business reading.
const INTERNAL_FIELDS = ['activation_notes', 'notes', 'last_payment_notes', 'activated_by_admin', 'last_payment_confirmed_by'];
const MEMBER_FIELDS = ['subscription_status', 'license_tier', 'trial_end_date'];

type Profile = { id: string; user_id?: string; school_id?: string; app_role?: string; status?: string; onboarding_completed?: boolean; created_date?: string };
type Sub = Record<string, unknown> & { subscription_status?: string; license_tier?: string; trial_end_date?: string; license_expires_at?: string };

function bad(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, code, error: message }, { status });
}

function effectiveLicense(sub: Sub | null, now: Date) {
  if (!sub) return { status: 'missing', isReadOnly: true, reason: 'missing' };
  const status = String(sub.subscription_status || 'trial');
  if (READ_ONLY_STATUSES.includes(status)) return { status, isReadOnly: true, reason: status };
  if (sub.license_tier === FOUNDER_TIER) return { status, isReadOnly: false, reason: 'founder' };
  if (status === 'trial') {
    const end = Date.parse(String(sub.trial_end_date || ''));
    if (Number.isNaN(end)) return { status: 'view_only', isReadOnly: true, reason: 'trial_without_end' };
    if (end <= now.getTime()) return { status: 'view_only', isReadOnly: true, reason: 'trial_expired' };
    return { status, isReadOnly: false, reason: 'trial' };
  }
  const expires = Date.parse(String(sub.license_expires_at || ''));
  if (!Number.isNaN(expires) && expires <= now.getTime()) return { status, isReadOnly: false, reason: 'active_overdue' };
  return { status, isReadOnly: false, reason: status };
}

function selectCurrentProfile(profiles: Profile[]): Profile | null {
  const sorted = [...profiles].sort((a, b) => String(b.created_date || '').localeCompare(String(a.created_date || '')));
  return sorted.find((p) => p.status === 'ACTIVE' && p.onboarding_completed) || sorted[0] || null;
}

function generateJoinCode(): string {
  const limit = 256 - (256 % JOIN_CODE_ALPHABET.length);
  let out = '';
  while (out.length < JOIN_CODE_LENGTH) {
    const bytes = new Uint8Array(JOIN_CODE_LENGTH * 2);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < limit) out += JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length];
      if (out.length === JOIN_CODE_LENGTH) break;
    }
  }
  return out;
}

// deno-lint-ignore no-explicit-any
async function ensureJoinCode(sr: any, school: { id: string; join_code?: string }): Promise<string | null> {
  if (school.join_code) return school.join_code;
  for (let i = 0; i < 6; i += 1) {
    const code = generateJoinCode();
    const clash = await sr.entities.School.filter({ join_code: code });
    if (!clash?.length) {
      await sr.entities.School.update(school.id, { join_code: code });
      return code;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return bad(401, 'UNAUTHENTICATED', 'Unauthorized');

    const sr = base44.asServiceRole;
    const profiles: Profile[] = await sr.entities.UserProfile.filter({ user_id: user.id });
    const profile = selectCurrentProfile(profiles);
    const isPlatformOwner = user.role === 'admin';

    if (!profile || profile.status !== 'ACTIVE') {
      // The platform owner often has no school profile; nothing to report.
      if (isPlatformOwner) return Response.json({ ok: true, platformOwner: true, subscription: null, effective: null, school: null });
      return bad(403, 'NO_ACTIVE_PROFILE', 'No active profile');
    }

    const schoolId = String(profile.school_id || '');
    const now = new Date();
    const subs: Sub[] = await sr.entities.SchoolSubscription.filter({ school_id: schoolId }, '-created_date', 1);
    const sub = subs?.[0] || null;
    const effective = effectiveLicense(sub, now);
    const isAdmin = profile.app_role === 'ADMIN';

    let subscription: Record<string, unknown> | null = null;
    if (sub) {
      if (isAdmin) {
        subscription = { ...sub };
        for (const f of INTERNAL_FIELDS) delete subscription[f];
      } else {
        subscription = { school_id: schoolId };
        for (const f of MEMBER_FIELDS) subscription[f] = sub[f] ?? null;
      }
    }

    const schoolRecord = await sr.entities.School.get(schoolId).catch(() => null);
    const school = schoolRecord
      ? {
          id: schoolRecord.id,
          name: schoolRecord.name || '',
          logo_url: schoolRecord.logo_url || null,
          theme_settings: schoolRecord.theme_settings || null,
          ...(isAdmin ? { join_code: await ensureJoinCode(sr, schoolRecord) } : {}),
        }
      : null;

    return Response.json({
      ok: true,
      platformOwner: isPlatformOwner,
      role: profile.app_role,
      schoolId,
      subscription,
      effective,
      school,
    });
  } catch (e) {
    return Response.json({ ok: false, code: 'INTERNAL', error: (e as Error).message }, { status: 500 });
  }
});
