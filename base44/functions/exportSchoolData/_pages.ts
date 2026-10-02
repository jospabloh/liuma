// _pages.ts — read EVERY row a query matches, page by page, or say it could
// not. Import-free so node --test runs it. IDENTICAL in
// sendBulkNotification/ and listSchoolMembers/ (functions cannot import
// across directories); tests/unit/paged-reads.test.js compares the copies.
//
// Why (Codex review of PR #197, round 4): the recipient set of every bulk
// notice — the emergency alert included — and the staff directory came from a
// single filter() with a fixed limit (2,000 / 5,000). A larger school lost the
// rest without a word: an emergency alert that silently skips families.
// Now each read loops sequentially (Base44's ~150 calls/min app limit: no
// parallel pages) by created_date until a short page, deduplicating by id,
// and stops at a hard bound it REPORTS (`complete: false`) instead of
// truncating quietly.
// The caller decides what an incomplete read means: refuse (directory,
// reminders) or use what was read and say so (the emergency alert).

export const PAGE_SIZE = 500;
/** ~40 × 500 = 20,000 rows: far past any real school, and ~40 calls at most. */
export const MAX_PAGES = 40;
/** Ids per `$in` query: keeps the request URL bounded. */
export const IN_CHUNK = 200;

// deno-lint-ignore no-explicit-any
type Handler = { filter: (query: Record<string, unknown>, sort?: string, limit?: number, skip?: number) => Promise<any[]> };
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export type PagedRead = { rows: Row[]; complete: boolean };

export class IncompleteReadError extends Error {
  status = 503;
  code = 'RECIPIENTS_INCOMPLETE';
  constructor(what: string) {
    super(`${what}: more than ${PAGE_SIZE * MAX_PAGES} rows; refusing to act on a partial list`);
  }
}

/** The page of `query` at or after `since` (keyset on created_date; null = the first page). */
export function keysetQuery(query: Record<string, unknown>, since: string | null): Record<string, unknown> {
  return since === null ? query : { ...query, created_date: { $gte: since } };
}

/**
 * Every row of `query`, or as many as the bound allows with complete:false.
 *
 * Keyset paging, not offsets (Codex review of PR #197, round 4): with
 * `skip`, a row deleted from a page already read shifts every later row back
 * by one and the next page silently starts one row too late. Here each page
 * asks for `created_date >= the last date seen`, oldest first, so a deletion
 * or an insert between pages moves nothing that is still to be read; rows on
 * the boundary come back again and are dropped by id. (The functions' SDK,
 * @base44/sdk 0.8.35, has no cursor option — filter(query, sort, limit,
 * skip) only — but the query accepts $gte.)
 *
 * More rows sharing one created_date than fit in a page would make no
 * progress: that is reported as incomplete, never looped on or skipped.
 */
export async function readAllPages(
  handler: Handler, query: Record<string, unknown>,
  { pageSize = PAGE_SIZE, maxPages = MAX_PAGES }: { pageSize?: number; maxPages?: number } = {},
): Promise<PagedRead> {
  const rows: Row[] = [];
  const seen = new Set<string>();
  let since: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const q = keysetQuery(query, since);
    const batch: Row[] = (await handler.filter(q, 'created_date', pageSize)) || [];
    let added = 0;
    for (const r of batch) {
      const id = String(r?.id ?? '');
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      rows.push(r);
      added += 1;
    }
    if (batch.length < pageSize) return { rows, complete: true };
    const last = String(batch[batch.length - 1]?.created_date ?? '');
    // No new row, or no date to continue from: stuck on a tie wider than a page.
    if (added === 0 || !last) return { rows, complete: false };
    since = last;
  }
  return { rows, complete: false };
}

/** readAllPages, or throw IncompleteReadError: for reads that must be whole. */
export async function readAllOrFail(handler: Handler, query: Record<string, unknown>, what: string): Promise<Row[]> {
  const read = await readAllPages(handler, query);
  if (!read.complete) throw new IncompleteReadError(what);
  return read.rows;
}

/** readAllPages over `field $in ids`, in chunks of IN_CHUNK ids. */
export async function readAllByIds(
  handler: Handler, field: string, ids: string[], extra: Record<string, unknown> = {},
): Promise<PagedRead> {
  const unique = [...new Set((ids || []).filter(Boolean))];
  const rows: Row[] = [];
  let complete = true;
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const read = await readAllPages(handler, { ...extra, [field]: { $in: unique.slice(i, i + IN_CHUNK) } });
    rows.push(...read.rows);
    if (!read.complete) complete = false;
  }
  return { rows, complete };
}
