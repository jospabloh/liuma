export function sortProfilesForTenantSelection(profiles = []) {
  return [...profiles].sort((a, b) => String(b.created_date || '').localeCompare(String(a.created_date || '')));
}

export function selectCurrentUserProfile(profiles = []) {
  const sortedProfiles = sortProfilesForTenantSelection(profiles);
  return sortedProfiles.find((profile) => profile.status === 'ACTIVE' && profile.onboarding_completed) || sortedProfiles[0] || null;
}

export function buildTenantSelectionContext({ profiles = [], schools = [], currentSchoolId }) {
  const schoolById = new Map(schools.map((school) => [school.id, school]));
  const options = sortProfilesForTenantSelection(profiles)
    .filter((profile) => profile.status === 'ACTIVE' && profile.school_id)
    .map((profile) => {
      const school = schoolById.get(profile.school_id);
      return {
        profile_id: profile.id,
        school_id: profile.school_id,
        school_name: school?.name || profile.school_id,
        app_role: profile.app_role,
        is_current: profile.school_id === currentSchoolId,
      };
    });

  return {
    current_school_id: currentSchoolId || null,
    options,
  };
}
