// approveProfile — the one sanctioned way to approve or reject a PENDING
// UserProfile (Aprobaciones.jsx).
//
// WHY THIS EXISTS (sales-readiness audit, package P8, 2026-09-29).
// Aprobaciones used to call `UserProfile.update(profileId, { status })`
// straight from the browser. Nothing on that path checked that the approver
// was an ADMIN of the TARGET's school: the page filtered its own list by the
// caller's school, but the write itself took any profile id. And under the
// deployed RLS a school ADMIN can't update someone else's profile at all
// (UserProfile update is own-row OR platform owner), so the button simply
// failed for the people it exists for.
//
// Authority model, in order:
//   1. Caller must be authenticated.
//   2. The target profile is re-read with the service role; its school comes
//      from the STORED row, never from the request.
//   3. The caller must hold an ACTIVE ADMIN profile in that same school
//      (platform owner — user.role === 'admin' — bypasses, same convention
//      as every other function here).
//   4. The target must currently be PENDING. This is an approval queue, not
//      a general status editor: reactivating a SUSPENDED user or suspending
//      an ACTIVE one is a different decision and does not go through here.
//   5. Nobody approves their own profile, even an ADMIN of the school with a
//      second, pending profile — self-activation is exactly what an approval
//      step exists to prevent.
// The write and its AuditLog row both happen with the service role.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';

const DECISIONS: Record<string, { status: string; action: string }> = {
  approve: { status: 'ACTIVE', action: 'USER_APPROVED' },
  reject: { status: 'SUSPENDED', action: 'USER_SUSPENDED' },
};

type Profile = { id: string; user_id?: string; school_id?: string; app_role?: string; status?: string };

function bad(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, code, error: message }, { status });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return bad(401, 'UNAUTHENTICATED', 'Unauthorized');

    const body = await req.json().catch(() => ({}));
    const profileId = String(body?.profileId || '');
    const decision = DECISIONS[String(body?.decision || '')];
    if (!profileId) return bad(400, 'MISSING_PROFILE', 'profileId is required');
    if (!decision) return bad(400, 'BAD_DECISION', 'decision must be "approve" or "reject"');

    const sr = base44.asServiceRole;
    const target: Profile | null = await sr.entities.UserProfile.get(profileId).catch(() => null);
    if (!target?.school_id) return bad(404, 'NOT_FOUND', 'Profile not found');
    if (target.status !== 'PENDING') return bad(409, 'NOT_PENDING', 'Only a PENDING profile can be approved or rejected');
    if (target.user_id === user.id) return bad(403, 'SELF_APPROVAL', 'You cannot approve or reject your own profile');

    const isPlatformOwner = user.role === 'admin';
    let callerProfile: Profile | null = null;
    if (!isPlatformOwner) {
      const callerProfiles: Profile[] = await sr.entities.UserProfile.filter(
        { user_id: user.id, school_id: target.school_id },
        '-created_date',
      );
      callerProfile = callerProfiles.find((p) => p.app_role === 'ADMIN' && p.status === 'ACTIVE') || null;
      if (!callerProfile) return bad(403, 'NOT_ADMIN', 'Requires an active ADMIN profile in the target\'s school');
    }

    await sr.entities.UserProfile.update(target.id, { status: decision.status });

    // Best-effort: the approval already happened; a failed audit row must not
    // turn it into an error the admin would retry.
    await sr.entities.AuditLog.create({
      school_id: target.school_id,
      user_id: user.id,
      user_email: user.email,
      action: decision.action,
      target_type: 'UserProfile',
      target_id: target.id,
      details: {
        from_status: 'PENDING',
        to_status: decision.status,
        target_role: target.app_role,
        actor_profile_id: callerProfile?.id || null,
        via: 'approveProfile',
      },
    }).catch(() => null);

    return Response.json({ ok: true, profileId: target.id, status: decision.status });
  } catch (e) {
    return Response.json({ ok: false, code: 'INTERNAL', error: (e as Error).message }, { status: 500 });
  }
});
