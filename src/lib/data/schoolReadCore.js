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
/** The server refuses a skip past this (MAX_SKIP in _scope.ts). */
export const SCHOOL_READ_MAX_SKIP = 20000;
/** The most rows one read() can page through: the last page starts at MAX_SKIP. */
export const SCHOOL_READ_MAX_TOTAL = SCHOOL_READ_MAX_SKIP + SCHOOL_READ_PAGE;
/**
 * Pass as `limit` to read EVERY matching row: read() then throws
 * TOO_MANY_ROWS_MESSAGE instead of returning a silently cut list when the
 * server has more than SCHOOL_READ_MAX_TOTAL. For reports, where a truncated
 * count reads as a real (wrong) number.
 */
export const SCHOOL_READ_ALL = Infinity;
export const TOO_MANY_ROWS_MESSAGE = 'Demasiados registros para este rango; acota las fechas.';

// --- Request volume (v1.8.3) -------------------------------------------------
//
// Base44 rate-limits the app's entity calls (about 150 a minute, one budget
// for every user's function invocations — base44/functions/schoolRead/
// _answer.ts). Each schoolRead invocation re-derives the caller's scope
// before reading (a parent or a teacher: 2 service-role calls), so a screen
// that fired five single reads paid that five times. With three people
// browsing at once the budget ran out and screens rendered failures as empty
// lists. Two things here cut that without touching a single page:
//
//   1. AUTO-BATCHING. read() calls made within SCHOOL_READ_BATCH_WINDOW_MS of
//      each other travel as ONE `queries` request (one invocation, one scope
//      derivation), within the server's limits: ≤ SCHOOL_READ_BATCH_MAX reads
//      and ≤ SCHOOL_READ_BATCH_MAX_SCANS scan-mode reads per request. A lone
//      read still goes out in the single-read shape. Identical reads in
//      flight at the same time share one answer.
//   2. A SHORT-LIVED CONTEXT. context() (who am I here: role, classrooms,
//      children) is asked by many hooks on the same screen under different
//      query keys; its answer is shared for CONTEXT_TTL_MS.
//
// scripts/load-test-reads.mjs measures the effect per screen.

/** The server's MAX_BATCH (_scope.ts). */
export const SCHOOL_READ_BATCH_MAX = 12;
/** The server's MAX_SCANS_PER_BATCH (_scope.ts). */
export const SCHOOL_READ_BATCH_MAX_SCANS = 3;
/** How long a read waits for siblings before its batch leaves. */
export const SCHOOL_READ_BATCH_WINDOW_MS = 10;
/** How long one context() answer is shared. */
export const SCHOOL_READ_CONTEXT_TTL_MS = 30 * 1000;
/**
 * Entities that are scan-mode reads (needsScan in _scope.ts) for at least one
 * role. The client does not know the caller's role when it batches, so it
 * counts these as scans for everyone: a batch can never trip TOO_MANY_SCANS.
 * tests/unit/rate-limit-resilience.test.js fails if this drifts from
 * _scope.ts.
 */
export const SCAN_MODE_ENTITIES = new Set(['Notice', 'NoticeDelivery', 'Event', 'OfficialDocument', 'SupportTicket']);

function errorStatusOf(error) {
  const status = error?.status ?? error?.response?.status;
  return typeof status === 'number' ? status : undefined;
}

/** A batch the server refused as a whole because of its shape or one read in it. */
function isBatchRefusal(error) {
  const status = errorStatusOf(error);
  return status !== undefined && status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}

/** Split pending reads into server-acceptable batches, in order. */
export function planBatches(items, { max = SCHOOL_READ_BATCH_MAX, maxScans = SCHOOL_READ_BATCH_MAX_SCANS } = {}) {
  const groups = [];
  for (const item of items) {
    const scan = SCAN_MODE_ENTITIES.has(item.payload.entity);
    let group = groups.find((g) => g.items.length < max && (!scan || g.scans < maxScans));
    if (!group) {
      group = { items: [], scans: 0 };
      groups.push(group);
    }
    group.items.push(item);
    if (scan) group.scans += 1;
  }
  return groups.map((g) => g.items);
}

function copyContext(c) {
  return {
    ...c,
    classroomIds: [...c.classroomIds],
    studentIds: [...c.studentIds],
    linkStudentIds: [...c.linkStudentIds],
    students: c.students.map((row) => ({ ...row })),
    classrooms: c.classrooms.map((row) => ({ ...row })),
  };
}

/**
 * @param {(payload: object) => Promise<any>} call  resolves to the function's JSON body
 * @param {{ batch?: boolean, windowMs?: number, contextTtlMs?: number,
 *   now?: () => number, schedule?: (fn: () => void, ms: number) => any }} [options]
 *   `batch` turns on auto-batching and `contextTtlMs` the shared context
 *   (src/lib/data/schoolRead.js turns both on; off by default so a test sees
 *   each payload as sent).
 */
export function makeSchoolReader(call, {
  batch = false,
  windowMs = SCHOOL_READ_BATCH_WINDOW_MS,
  contextTtlMs = 0,
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  // --- auto-batching -------------------------------------------------------
  // Pending items are reads (`{ payload }`) or context requests
  // (`{ context: true }`); a context request rides on the first batch of
  // reads that leaves with it (`context: true` on the request — one scope
  // derivation for both), or goes alone as `{ action: 'context' }`.
  let pending = [];
  let scheduled = false;
  const inFlight = new Map();

  async function sendContext(items) {
    try {
      const body = await call({ action: 'context' });
      for (const item of items) item.resolve(body);
    } catch (error) {
      for (const item of items) item.reject(error);
    }
  }

  async function sendGroup(group) {
    const ctx = group.filter((item) => item.context);
    const items = group.filter((item) => !item.context);
    if (items.length === 0) return sendContext(ctx);
    if (items.length === 1 && ctx.length === 0) {
      const [item] = items;
      try {
        item.resolve(await call(item.payload));
      } catch (error) {
        item.reject(error);
      }
      return undefined;
    }
    let body;
    try {
      body = await call({
        queries: items.map((item, i) => ({ key: `q${i}`, ...item.payload })),
        ...(ctx.length ? { context: true } : {}),
      });
    } catch (error) {
      if (isBatchRefusal(error)) {
        // One read in the batch was refused (or the batch shape was): the
        // server answers a batch all-or-nothing, so ask each read on its own
        // and let each get its own answer. Rare — a refused read is a bug in
        // the screen asking — so this path is allowed to cost more.
        await Promise.all([...items.map((item) => sendGroup([item])), ctx.length ? sendContext(ctx) : null]);
        return undefined;
      }
      for (const item of group) item.reject(error);
      return undefined;
    }
    const results = body?.results || {};
    const hasMore = body?.has_more || {};
    items.forEach((item, i) => {
      const key = `q${i}`;
      item.resolve({
        ok: true,
        rows: Array.isArray(results[key]) ? results[key] : [],
        has_more: Boolean(hasMore[key]),
      });
    });
    if (ctx.length) {
      // A server from before v1.8.3 ignores `context: true`: ask on its own.
      if (body?.context && typeof body.context === 'object') for (const item of ctx) item.resolve(body.context);
      else await sendContext(ctx);
    }
    return undefined;
  }

  function flush() {
    scheduled = false;
    const items = pending;
    pending = [];
    const ctx = items.filter((item) => item.context);
    const groups = planBatches(items.filter((item) => !item.context));
    if (groups.length === 0) groups.push([]);
    groups[0] = [...ctx, ...groups[0]];
    for (const group of groups) if (group.length) sendGroup(group);
  }

  function enqueue(item) {
    pending.push(item);
    if (!scheduled) {
      scheduled = true;
      schedule(flush, windowMs);
    }
  }

  /** One page of one read: batched with its siblings, deduped while in flight. */
  function fetchPage(payload) {
    if (!batch) return call(payload);
    const key = JSON.stringify(payload);
    const shared = inFlight.get(key);
    if (shared) return shared;
    const promise = new Promise((resolve, reject) => enqueue({ payload, resolve, reject }))
      .finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  }

  /** The raw context body: batched with the reads around it when batching. */
  function fetchContextBody() {
    if (!batch) return call({ action: 'context' });
    return new Promise((resolve, reject) => enqueue({ context: true, resolve, reject }));
  }

  /**
   * Same shape as an entity SDK `filter(filter, sort, limit)` call:
   * resolves to an array of rows. A `school_id` in the filter is optional and
   * must be the caller's own school (the server injects it either way).
   * Without a limit it pages until it has every row, up to 5000. A limit is
   * capped at SCHOOL_READ_MAX_TOTAL (the server refuses a skip past
   * MAX_SKIP); `SCHOOL_READ_ALL` reads everything or throws.
   */
  async function read(entity, filter = {}, sort, limit) {
    const all = limit === SCHOOL_READ_ALL;
    const requested = all || (Number.isInteger(limit) && limit > 0) ? limit : SCHOOL_READ_DEFAULT_TOTAL;
    const wanted = Math.min(requested, SCHOOL_READ_MAX_TOTAL);
    const rows = [];
    let skip = 0;
    for (;;) {
      const pageSize = Math.min(SCHOOL_READ_PAGE, wanted - rows.length);
      const body = await fetchPage({ entity, filter, sort, limit: pageSize, skip });
      const page = Array.isArray(body?.rows) ? body.rows : [];
      rows.push(...page);
      if (!body?.has_more || page.length === 0) break;
      // Next page would start past what the server accepts, or we have what
      // was asked for: stop — and if the caller asked for everything, say so
      // instead of returning a partial list.
      if (rows.length >= wanted || skip + page.length > SCHOOL_READ_MAX_SKIP) {
        if (all) throw new Error(TOO_MANY_ROWS_MESSAGE);
        break;
      }
      skip += page.length;
    }
    // A shared (deduped) answer must not be mutated by one of its callers.
    return batch ? rows.map((row) => ({ ...row })) : rows;
  }

  /**
   * Several reads in one request (one scope derivation on the server).
   * `queries` is `{ key: [entity, filter, sort, limit] }`; resolves to
   * `{ key: rows }`. Each list is capped at one server page (1000 rows).
   */
  async function readMany(queries) {
    const entries = Object.entries(queries || {});
    if (entries.length === 0) return {};
    if (batch) {
      // Through the batcher: these lists share a request with whatever else
      // the screen is reading in the same tick (its context included), and
      // the batcher keeps every request within the server's caps.
      const lists = await Promise.all(entries.map(([, [entity, filter = {}, sort, limit]]) => fetchPage({
        entity, filter, sort, limit: Math.min(limit || SCHOOL_READ_PAGE, SCHOOL_READ_PAGE), skip: 0,
      })));
      return Object.fromEntries(entries.map(([key], i) => [
        key, (Array.isArray(lists[i]?.rows) ? lists[i].rows : []).map((row) => ({ ...row })),
      ]));
    }
    const body = await call({
      queries: entries.map(([key, [entity, filter = {}, sort, limit]]) => ({
        key, entity, filter, sort, limit: Math.min(limit || SCHOOL_READ_PAGE, SCHOOL_READ_PAGE),
      })),
    });
    const results = body?.results || {};
    return Object.fromEntries(entries.map(([key]) => [key, Array.isArray(results[key]) ? results[key] : []]));
  }

  // --- context -------------------------------------------------------------
  let contextCache = null; // { value, at }
  let contextInFlight = null;

  async function fetchContext() {
    const body = await fetchContextBody();
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

  /** The caller's derived scope: role, school, classrooms, children. */
  async function context() {
    if (contextTtlMs <= 0) return fetchContext();
    if (contextCache && now() - contextCache.at < contextTtlMs) return copyContext(contextCache.value);
    if (!contextInFlight) {
      contextInFlight = fetchContext()
        .then((value) => {
          contextCache = { value, at: now() };
          return value;
        })
        .finally(() => { contextInFlight = null; });
    }
    return copyContext(await contextInFlight);
  }

  /** Forget the shared context (sign-out, or a change to the caller's own links). */
  function reset() {
    contextCache = null;
  }

  return { read, readMany, context, reset };
}
