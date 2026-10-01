// Telling a failed load apart from an empty one (v1.8.3).
//
// Every screen used to read `const { data = [] } = useQuery(…)` and render
// its empty state when the list was empty — which is also what a FAILED read
// looks like. Under Base44's rate limit that turned into "Sin hijos
// vinculados", "Sin avisos", "Sin salón" and zero counts while the data was
// there. A screen now asks blockingLoadFailure(...queries) first: if any of
// them failed and has nothing to show, it renders <LoadError> with a retry
// button instead of the empty state. A query that failed on a background
// refetch but still holds earlier data keeps showing that data (the global
// toast already said the refresh failed).
//
// Import-free so `node --test` loads it.

import { humanizeError } from './errorMessages.js';
import { isUndefinedDataError } from './queryErrorPolicy.js';
import { TOO_MANY_ROWS_MESSAGE } from './data/schoolReadCore.js';

/**
 * The first query (React Query result objects) that failed with no data to
 * show, as `{ error, message, retry }` — `retry()` refetches every failed one
 * — or null when the screen can render what it has.
 */
export function blockingLoadFailure(...queries) {
  // React Query reports a queryFn that resolved to undefined ("no row":
  // `(await read(...))[0]`) as an error. That is an empty answer, not a
  // failed load (same exception as the global toast, queryErrorPolicy.js).
  const failed = queries.filter((q) => q && q.isError && q.data === undefined && !isUndefinedDataError(q.error));
  if (failed.length === 0) return null;
  const { error } = failed[0];
  return {
    error,
    // Our own Spanish refusal ("acota las fechas") says more than a generic line.
    message: error?.message === TOO_MANY_ROWS_MESSAGE ? TOO_MANY_ROWS_MESSAGE : humanizeError(error),
    retry: () => Promise.all(failed.map((q) => (typeof q.refetch === 'function' ? q.refetch() : null))),
  };
}
