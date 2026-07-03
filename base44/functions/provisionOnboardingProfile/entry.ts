// provisionOnboardingProfile — server-authoritative onboarding role assignment.
//
// WHY THIS EXISTS
// Field-level RLS locks UserProfile.app_role to the service role (see
// docs/security-role-governance-remediation.md). Onboarding used to self-write
// app_role from the client, so that write now has to go through the service role.
// This function provisions ONLY the caller's own profile and enforces the single
// privileged rule: a user may be provisioned as ADMIN only as the FOUNDER of a
// brand-new school (a school they created, with no other active admin). Everyone
// else joins an existing school as TEACHER/PARENT with status PENDING and must be
// activated by an admin. Post-onboarding role changes go through governRoleChange.
//
// Predicates MIRROR src/lib/authorization/onboardingProvision.js.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';

const APP_ROLES = ['ADMIN', 'TEACHER', 'PARENT'];

type Profile = {
  id: string;
  user_id?: string;
  school_id?: string;
  app_role?: string;
  status?: string;
};

function bad(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, code, error: message }, { status });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me().catch(() => null);
    if (!user) return bad(401, 'UNAUTHENTICATED', 'Unauthorized');

    const body = await req.json().catch(() => ({}));
    const schoolId = String(body?.schoolId || '');
    const role = String(body?.role || '');
    const phone = typeof body?.phone === 'string' ? body.phone : '';
    if (!schoolId || !role) return bad(400, 'MISSING_PARAMS', 'schoolId and role required');
    if (!APP_ROLES.includes(role)) return bad(400, 'INVALID_ROLE', 'Invalid onboarding role');

    const sr = base44.asServiceRole;

    const school = await sr.entities.School.get(schoolId).catch(() => null);
    if (!school) return bad(404, 'SCHOOL_NOT_FOUND', 'School not found');

    // Resolve the privileged app_role decision from authoritative backend state.
    let appRole = role;
    let status = 'PENDING';
    if (role === 'ADMIN') {
      const schoolAdmins: Profile[] = await sr.entities.UserProfile.filter({ school_id: schoolId, app_role: 'ADMIN' });
      const isFounder = school.created_by_user_id === user.id;
      const otherActiveAdminExists = schoolAdmins.some((p) => p.status === 'ACTIVE' && p.user_id !== user.id);
      if (!isFounder || otherActiveAdminExists) {
        return bad(403, 'ADMIN_NOT_ALLOWED', 'Only the founder of a new school may self-assign ADMIN during onboarding');
      }
      appRole = 'ADMIN';
      status = 'ACTIVE';
    }

    // Upsert the caller's OWN profile. On an existing profile we never rewrite
    // app_role/status (governance-controlled once it exists); only refresh
    // onboarding-owned fields.
    const existing: Profile[] = await sr.entities.UserProfile.filter({ user_id: user.id, school_id: schoolId }, '-created_date', 1);

    let profileId: string | null = null;
    let resolvedStatus = status;
    if (existing[0]) {
      await sr.entities.UserProfile.update(existing[0].id, { phone: phone || '', onboarding_completed: true });
      profileId = existing[0].id;
      resolvedStatus = existing[0].status || status;
    } else {
      const created = await sr.entities.UserProfile.create({
        user_id: user.id,
        school_id: schoolId,
        app_role: appRole,
        status,
        phone: phone || '',
        onboarding_completed: true,
      });
      profileId = created?.id || null;
    }

    return Response.json({ ok: true, profileId, status: resolvedStatus });
  } catch (e) {
    return Response.json({ ok: false, code: 'INTERNAL', error: (e as Error).message }, { status: 500 });
  }
});
