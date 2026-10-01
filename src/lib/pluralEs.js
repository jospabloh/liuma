// "1 salón" / "3 salones". Spanish plurals are not "add -es": an accented
// last syllable loses its accent (salón → salones), so the plural is always
// spelled out by the caller. Live QA of v1.8.2 found the maestro's home saying
// "3 salónes" — built as 'salón' + 'es'. Import-free so `node --test` loads it.
export function pluralEs(count, singular, plural) {
  const n = Number(count) || 0;
  return `${n} ${n === 1 ? singular : plural}`;
}
