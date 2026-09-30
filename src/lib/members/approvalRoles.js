// Roles an approving ADMIN can hand to a PENDING applicant from Aprobaciones.
// DIRECTIVO is deliberately absent: giving ADMIN is a role grant that needs a
// second director (approveProfile answers ADMIN_NEEDS_GOVERNANCE; the flow is
// Permisos y Roles / governRoleChange). Mirrors the offer in approveProfile.
export const APPROVABLE_ROLES = ['TEACHER', 'PARENT'];

/** What to preselect: the role the applicant asked for when it is offerable. */
export function defaultApprovalRole(requested) {
  return APPROVABLE_ROLES.includes(requested) ? requested : 'PARENT';
}
