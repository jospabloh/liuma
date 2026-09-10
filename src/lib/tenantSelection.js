// Un usuario puede tener un UserProfile en más de una escuela — no porque la
// app le deje elegir (el selector de escuela se retiró el 2026-09-10: una
// cuenta, una escuela), sino porque nada en el modelo de datos lo impide y
// hay cuentas que ya arrastran más de un perfil. `selectCurrentUserProfile`
// es la única regla de "qué escuela estoy viendo ahora mismo" que debe usarse
// en todo el front-end y en cada función de backend que derive la escuela del
// solicitante.
//
// Que sea UNA sola regla es lo que importa, y es un hallazgo del módulo 14
// (2026-08-23): antes, `exportSchoolData`/`governRoleChange` (backend) y
// `NavContext.jsx` (front) tenían cada uno la suya, ninguna ordenada, y podían
// discrepar entre sí en cuanto un usuario tuviera perfil en dos escuelas —
// "Descargar mis datos" podía devolver en silencio la escuela que no estabas
// viendo. Sin selector eso sigue siendo posible, así que la regla compartida
// se queda.

export function sortProfilesForTenantSelection(profiles = []) {
  return [...profiles].sort((a, b) => String(b.created_date || '').localeCompare(String(a.created_date || '')));
}

/**
 * El perfil más reciente que esté ACTIVE y con onboarding_completed; si no
 * hay ninguno, el más reciente a secas. Determinista: `filter()` de Base44 no
 * garantiza orden, así que ordenar primero es lo que impide que dos lectores
 * de esta misma función elijan perfiles distintos.
 */
export function selectCurrentUserProfile(profiles = []) {
  const sortedProfiles = sortProfilesForTenantSelection(profiles);
  const eligible = sortedProfiles.filter((profile) => profile.status === 'ACTIVE' && profile.onboarding_completed);
  return eligible[0] || sortedProfiles[0] || null;
}
