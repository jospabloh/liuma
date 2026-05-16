export function countActiveAdmins(profiles = []) {
  return profiles.filter((profile) => profile.app_role === 'ADMIN' && profile.status === 'ACTIVE').length;
}

export function hasOtherActiveAdminWithManagePermissions({ profiles = [], actorProfileId, targetProfileId }) {
  return profiles.some((profile) => (
    profile.id !== actorProfileId &&
    profile.id !== targetProfileId &&
    profile.app_role === 'ADMIN' &&
    profile.status === 'ACTIVE'
  ));
}
