// Onboarding profile-provisioning rules.
//
// SECURITY NOTE: pure, framework-agnostic predicates. The AUTHORITATIVE copy is
// enforced server-side in base44/functions/provisionOnboardingProfile/entry.ts
// (service role), which mirrors these rules. This exists because once
// UserProfile.app_role is locked to the service role via field-level RLS,
// onboarding can no longer write app_role directly from the client — the initial
// role assignment must go through the service-role function.
//
// The only privileged decision is: who may be provisioned as ADMIN. A user may
// self-assign ADMIN only as the FOUNDER of a brand-new school (a school they just
// created that has no other active admin) — this is self-serve tenant signup, not
// escalation. Everyone else joins an existing school as TEACHER/PARENT with status
// PENDING and must be activated by an admin (Aprobaciones). Post-onboarding role
// changes go exclusively through governRoleChange.

export const APP_ROLES = ['ADMIN', 'TEACHER', 'PARENT'];

function fail(code, message) {
  return { ok: false, code, message, appRole: null, status: null };
}

// Decide the app_role + status for the caller's own onboarding profile.
// `schoolAdmins` = UserProfile rows in the school with app_role ADMIN.
export function resolveOnboardingProvision({ user, school, role, schoolAdmins = [] }) {
  if (!user?.id) return fail('UNAUTHENTICATED', 'No authenticated user.');
  if (!APP_ROLES.includes(role)) return fail('INVALID_ROLE', 'Rol de onboarding inválido.');
  if (!school) return fail('SCHOOL_NOT_FOUND', 'No se encontró la escuela.');

  if (role === 'ADMIN') {
    const isFounder = school.created_by_user_id === user.id;
    const otherActiveAdminExists = schoolAdmins.some(
      (p) => p.status === 'ACTIVE' && p.user_id !== user.id,
    );
    if (!isFounder || otherActiveAdminExists) {
      return fail(
        'ADMIN_NOT_ALLOWED',
        'Solo el fundador de una escuela nueva puede asignarse ADMIN en el registro. Para una escuela existente, solicita el cambio de rol a un administrador.',
      );
    }
    return { ok: true, code: null, message: null, appRole: 'ADMIN', status: 'ACTIVE' };
  }

  // TEACHER / PARENT join an existing school and wait for admin approval.
  return { ok: true, code: null, message: null, appRole: role, status: 'PENDING' };
}

// Build the create/update payload for an onboarding upsert. On an EXISTING
// profile we never rewrite app_role/status (those are governance-controlled once
// the profile exists); we only refresh onboarding-owned fields. On a NEW profile
// we set the resolved role/status.
export function buildOnboardingUpsert({ user, schoolId, phone, appRole, status, existingProfile }) {
  if (existingProfile) {
    return {
      action: 'update',
      id: existingProfile.id,
      payload: { phone: phone || '', onboarding_completed: true },
    };
  }
  return {
    action: 'create',
    id: null,
    payload: {
      user_id: user.id,
      school_id: schoolId,
      app_role: appRole,
      status,
      phone: phone || '',
      onboarding_completed: true,
    },
  };
}
