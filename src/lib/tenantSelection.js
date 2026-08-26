// Módulo 18 (jospabloh/acacia-app-standard → STANDARD.md): un usuario puede
// tener un UserProfile ACTIVE en más de una escuela (fundador de una y
// maestro/padre en otra, por ejemplo). `selectCurrentUserProfile` es la única
// regla de "qué escuela estoy viendo ahora mismo" que debe usarse en todo el
// front-end y en cada función de backend que necesite derivar la escuela del
// solicitante — antes del módulo 18, `exportSchoolData`/`governRoleChange`
// (backend) y `NavContext.jsx` (front) tenían cada uno su propia regla,
// ninguna ordenada, y podían discrepar entre sí en cuanto un usuario tuviera
// perfil en dos escuelas (hallazgo del módulo 14, 2026-08-23 — latente
// entonces porque no existía forma de llegar a un segundo perfil; ya no es
// latente una vez que `Home.jsx` deja unirse a una segunda escuela sin salir
// de la primera).
const ACTIVE_SCHOOL_KEY = 'liuma.activeSchoolId';

export function sortProfilesForTenantSelection(profiles = []) {
  return [...profiles].sort((a, b) => String(b.created_date || '').localeCompare(String(a.created_date || '')));
}

/**
 * `preferredSchoolId`, si se da, gana SOLO si hay un perfil ACTIVE y
 * onboarding_completed en esa escuela entre los del usuario — nunca se
 * confía ciegamente (el usuario pudo perder acceso a esa escuela, o el
 * valor guardado en localStorage puede estar obsoleto). Sin preferencia, o
 * si la preferencia ya no es válida, cae al mismo criterio de siempre:
 * el más reciente ACTIVE && onboarding_completed.
 */
export function selectCurrentUserProfile(profiles = [], preferredSchoolId = null) {
  const sortedProfiles = sortProfilesForTenantSelection(profiles);
  const eligible = sortedProfiles.filter((profile) => profile.status === 'ACTIVE' && profile.onboarding_completed);
  if (preferredSchoolId) {
    const preferred = eligible.find((profile) => profile.school_id === preferredSchoolId);
    if (preferred) return preferred;
  }
  return eligible[0] || sortedProfiles[0] || null;
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

// Preferencia persistida de "en qué escuela quiero estar" — puramente de
// cliente, por diseño: a diferencia de Rumbo/CtrlHQ, ninguna RLS ni función
// de este repo depende de un `tenant_id` activo escrito en el servidor
// (`guardedEntityWrite` re-deriva la escuela del propio registro en cada
// escritura — ver su header comment), así que no hay nada que mover del
// lado del servidor al cambiar de escuela, solo qué perfil usa la UI para
// decidir qué leer. Un valor inválido u obsoleto simplemente no gana en
// `selectCurrentUserProfile` — nunca hace falta "limpiarlo" con cuidado.
export function getActiveSchoolOverride() {
  try {
    return localStorage.getItem(ACTIVE_SCHOOL_KEY) || null;
  } catch {
    return null;
  }
}

export function setActiveSchoolOverride(schoolId) {
  try {
    if (schoolId) localStorage.setItem(ACTIVE_SCHOOL_KEY, schoolId);
    else localStorage.removeItem(ACTIVE_SCHOOL_KEY);
  } catch {
    /* localStorage puede no estar disponible (Safari privado, etc.) — la
       selección simplemente vuelve a la regla por defecto en ese caso. */
  }
}
