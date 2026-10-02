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
// parallel pages) until a short page, deduplicating by id, and stops at a
// hard bound it REPORTS (`complete: false`) instead of truncating quietly.
// The caller decides what an incomplete read means: refuse (directory,
// reminders) or use what was read and say so (the emergency alert).

export const PAGE_SIZE = 500;
/** 40 × 500 = 20,000 rows: far past any real school, and ~40 calls at most. */
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

/** Every row of `query`, or as many as the bound allows with complete:false. */
export async function readAllPages(
  handler: Handler, query: Record<string, unknown>,
  { pageSize = PAGE_SIZE, maxPages = MAX_PAGES }: { pageSize?: number; maxPages?: number } = {},
): Promise<PagedRead> {
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < maxPages; page += 1) {
    // Oldest first: new rows land at the end, so an insert between pages
    // cannot push an unread row behind the cursor.
    const batch: Row[] = (await handler.filter(query, 'created_date', pageSize, page * pageSize)) || [];
    for (const r of batch) {
      const id = String(r?.id ?? '');
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      rows.push(r);
    }
    if (batch.length < pageSize) return { rows, complete: true };
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
