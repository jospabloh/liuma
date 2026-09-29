// Small Spanish copy helpers for counts and dates. Import-free for node --test.

/** "1 alumno", "0 alumnos", "3 alumnos" — never "1 alumnos". */
export function countLabel(count, singular, plural = `${singular}s`) {
  const n = Number(count) || 0;
  return `${n.toLocaleString('es-MX')} ${n === 1 ? singular : plural}`;
}

/**
 * Capitalise only the first letter. Spanish sentence case: CSS
 * `text-transform: capitalize` turned "martes 29 de septiembre" into
 * "Martes 29 De Septiembre"; this gives "Martes 29 de septiembre".
 */
export function capitalizeFirst(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  return text.charAt(0).toLocaleUpperCase('es-MX') + text.slice(1);
}
