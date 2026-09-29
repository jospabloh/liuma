// Pure half of the client's tenant read path (P10, sales-readiness audit F01).
// Import-free so `node --test` loads it; src/lib/data/schoolRead.js binds it to
// the Base44 client.
//
// Every read of a school's data from the browser goes through the
// `schoolRead` backend function (base44/functions/schoolRead), which derives
// the caller's school, role, classrooms and children from their own profile
// and applies the per-entity × role allowlist in _scope.ts. The deployed
// entity RLS stays strict (platform owner, or own rows), so a direct
// `base44.entities.X.filter()` from a school user returns nothing — which is
// what left real directors, teachers and parents looking at empty screens.
// tests/unit/school-read-client.test.js fails if src/ reads a school-scoped
// entity directly.

/** The server's page cap (MAX_LIMIT in _scope.ts). */
export const SCHOOL_READ_PAGE = 1000;
/** What a read without an explicit limit fetches at most (Base44's own default page). */
export const SCHOOL_READ_DEFAULT_TOTAL = 5000;

/**
 * @param {(payload: object) => Promise<any>} call  resolves to the function's JSON body
 */
export function makeSchoolReader(call) {
  /**
   * Same shape as an entity SDK `filter(filter, sort, limit)` call:
   * resolves to an array of rows. A `school_id` in the filter is optional and
   * must be the caller's own school (the server injects it either way).
   * Without a limit it pages until it has every row, up to 5000.
   */
  async function read(entity, filter = {}, sort, limit) {
    const wanted = Number.isInteger(limit) && limit > 0 ? limit : SCHOOL_READ_DEFAULT_TOTAL;
    const rows = [];
    let skip = 0;
    for (;;) {
      const pageSize = Math.min(SCHOOL_READ_PAGE, wanted - rows.length);
      const body = await call({ entity, filter, sort, limit: pageSize, skip });
      const page = Array.isArray(body?.rows) ? body.rows : [];
      rows.push(...page);
      if (!body?.has_more || page.length === 0 || rows.length >= wanted) break;
      skip += page.length;
    }
    return rows;
  }

  /**
   * Several reads in one request (one scope derivation on the server).
   * `queries` is `{ key: [entity, filter, sort, limit] }`; resolves to
   * `{ key: rows }`. Each list is capped at one server page (1000 rows).
   */
  async function readMany(queries) {
    const entries = Object.entries(queries || {});
    if (entries.length === 0) return {};
    const body = await call({
      queries: entries.map(([key, [entity, filter = {}, sort, limit]]) => ({
        key, entity, filter, sort, limit: Math.min(limit || SCHOOL_READ_PAGE, SCHOOL_READ_PAGE),
      })),
    });
    const results = body?.results || {};
    return Object.fromEntries(entries.map(([key]) => [key, Array.isArray(results[key]) ? results[key] : []]));
  }

  /** The caller's derived scope: role, school, classrooms, children. */
  async function context() {
    const body = await call({ action: 'context' });
    return {
      role: body?.role || null,
      schoolId: body?.school_id || null,
      profileId: body?.profile_id || null,
      classroomIds: Array.isArray(body?.classroom_ids) ? body.classroom_ids : [],
      studentIds: Array.isArray(body?.student_ids) ? body.student_ids : [],
      linkStudentIds: Array.isArray(body?.link_student_ids) ? body.link_student_ids : [],
      students: Array.isArray(body?.students) ? body.students : [],
      classrooms: Array.isArray(body?.classrooms) ? body.classrooms : [],
    };
  }

  return { read, readMany, context };
}
