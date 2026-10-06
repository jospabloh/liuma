// _exportGate.ts — reading the export, and the last check before it leaves
// (Codex review of PR #197, rounds 9 and 10). Its only import is ./_pages.ts
// (itself import-free), so node --test runs it (tests/unit/deletion-guard
// .test.js, tests/unit/school-export.test.js).
//
// The export reads the whole school with the service role, which takes a
// while; the deletion-marker gate at the top only saw the auth.me()
// snapshot. Right before answering, the STORED User is read again: a marker
// set meanwhile (or a User already removed) discards the export — 403
// ACCOUNT_DELETION_IN_PROGRESS — and a User that cannot be read discards it
// too — 503 — rather than hand out a school's data on an unknown state.

import { keysetQuery } from './_pages.ts';

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/** The SDK's documented maximum per filter() call (@base44/sdk 0.8.35: "The maximum limit is 5,000 items per request"). */
export const EXPORT_PAGE_SIZE = 5000;
/** ~200,000 rows per entity (each page after the first re-reads its boundary row). */
export const EXPORT_MAX_PAGES = 45;
/**
 * Time this call may spend reading. Base44 does not document a function
 * timeout we can rely on; assume 60 s and stop well before it. Whatever is
 * left goes back as `resume`, and the client calls again.
 */
export const EXPORT_BUDGET_MS = 45_000;
/** Waits after a rate-limit answer before retrying the same page. */
export const RATE_LIMIT_BACKOFF_MS = [3000, 6000, 12000];

/** Where the next call picks up: the entity, its keyset position, and the rows already sent at that position. */
export type ExportResume = { entity: string; since: string | null; boundaryIds: string[] };

export type SchoolExport = {
  data: Record<string, unknown[]>;
  errors: Record<string, string>;
  /** Entities that will not be complete whatever the client does: unreadable, or past the paging bound. */
  incomplete: string[];
  /** Set when the time budget ran out: call again with it. */
  resume: ExportResume | null;
  complete: boolean;
};

function isRateLimit(e: unknown): boolean {
  const err = e as { status?: unknown; message?: unknown } | null;
  return err?.status === 429 || /rate limit/i.test(String(err?.message ?? ''));
}

/** A resume token from the request, or null if it is not one we issued for these entities. */
export function parseResume(input: unknown, entities: string[]): ExportResume | null {
  const r = input as Row | null;
  if (!r || typeof r !== 'object' || !entities.includes(String(r.entity))) return null;
  const since = typeof r.since === 'string' ? r.since : null;
  const ids = Array.isArray(r.boundaryIds) ? r.boundaryIds.filter((x: unknown) => typeof x === 'string').slice(0, EXPORT_PAGE_SIZE) : [];
  return { entity: String(r.entity), since, boundaryIds: ids };
}

/**
 * Every row of every exported entity for one school (Codex review of PR #197,
 * round 10: a bare filter() returned the SDK's default first page per entity,
 * so a real school's export was silently cut). Keyset-paged by created_date
 * (./_pages.ts#keysetQuery), 5,000 rows per call, one call at a time — a
 * year of a 100-student school is ~35 calls instead of ~130 (Base44's rate
 * limit is ~150 calls/min for the whole app). A rate-limit answer is retried
 * on the same page after 3 s, 6 s, 12 s; an entity is only given up when it
 * cannot be read at all (`incomplete`), and when the time budget runs out
 * the call answers with what it has plus `resume`.
 */
export async function readSchoolExport(sr: Db, schoolId: string, entities: string[], opts: {
  pageSize?: number;
  maxPages?: number;
  budgetMs?: number;
  backoffMs?: number[];
  resume?: ExportResume | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
} = {}): Promise<SchoolExport> {
  const pageSize = opts.pageSize ?? EXPORT_PAGE_SIZE;
  const maxPages = opts.maxPages ?? EXPORT_MAX_PAGES;
  const backoff = opts.backoffMs ?? RATE_LIMIT_BACKOFF_MS;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + (opts.budgetMs ?? EXPORT_BUDGET_MS);
  const data: Record<string, unknown[]> = {};
  const errors: Record<string, string> = {};
  const incomplete: string[] = [];
  const startAt = opts.resume ? Math.max(0, entities.indexOf(opts.resume.entity)) : 0;

  for (let e = startAt; e < entities.length; e += 1) {
    const name = entities[e];
    const resuming = opts.resume && opts.resume.entity === name ? opts.resume : null;
    let since: string | null = resuming ? resuming.since : null;
    const seen = new Set<string>(resuming ? resuming.boundaryIds : []);
    const rows: Row[] = [];
    data[name] = rows;
    // The ids already sent AT `since` (they come back on the next keyset page).
    const boundaryIds = (): string[] => {
      if (since === null) return [];
      const ids = rows.filter((r) => String(r.created_date) === since).map((r) => String(r.id));
      if (resuming && resuming.since === since) ids.push(...resuming.boundaryIds);
      return [...new Set(ids)];
    };
    let done = false;
    for (let page = 0; page < maxPages && !done; page += 1) {
      let batch: Row[] | null = null;
      for (let attempt = 0; batch === null; attempt += 1) {
        if (now() >= deadline) {
          // Out of time: hand back where this entity stands.
          const boundary = boundaryIds();
          return { data, errors, incomplete, resume: { entity: name, since, boundaryIds: boundary }, complete: false };
        }
        try {
          batch = (await sr.entities[name].filter(keysetQuery({ school_id: schoolId }, since), 'created_date', pageSize)) || [];
        } catch (err) {
          if (isRateLimit(err) && attempt < backoff.length && now() + backoff[attempt] < deadline) {
            await sleep(backoff[attempt]);
            continue;
          }
          if (isRateLimit(err)) {
            // No time left to wait: stop here and resume on the next call.
            const boundary = boundaryIds();
            return { data, errors, incomplete, resume: { entity: name, since, boundaryIds: boundary }, complete: false };
          }
          errors[name] = String((err as Error)?.message || err);
          incomplete.push(name);
          done = true;
          batch = [];
        }
      }
      if (done) break;
      let added = 0;
      for (const r of batch) {
        const id = String(r?.id ?? '');
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        rows.push(r);
        added += 1;
      }
      if (batch.length < pageSize) { done = true; break; }
      const last = String(batch[batch.length - 1]?.created_date ?? '');
      if (added === 0 || !last) {
        errors[name] = 'more rows share one creation time than fit in a page';
        incomplete.push(name);
        done = true;
        break;
      }
      since = last;
    }
    if (!done) {
      errors[name] = 'too many rows to export at once';
      incomplete.push(name);
    }
  }
  return { data, errors, incomplete, resume: null, complete: incomplete.length === 0 };
}

export type ExportGate = { ok: true } | { ok: false; status: number; code: string };

function filled(v: unknown): boolean {
  return typeof v === 'string' && v !== '';
}

export async function finalExportGate(sr: Db, userId: string): Promise<ExportGate> {
  // deno-lint-ignore no-explicit-any
  let row: any;
  try {
    row = await sr.entities.User.get(userId);
  } catch (e) {
    const err = e as { status?: unknown; message?: unknown } | null;
    if (err?.status === 404 || /not found/i.test(String(err?.message ?? ''))) {
      return { ok: false, status: 403, code: 'ACCOUNT_DELETION_IN_PROGRESS' };
    }
    return { ok: false, status: 503, code: 'DELETION_STATE_UNVERIFIED' };
  }
  const data = row?.data || {};
  const marked = filled(row?.account_deletion_started_at ?? data.account_deletion_started_at)
    || filled(row?.account_deleted_at ?? data.account_deleted_at);
  return marked ? { ok: false, status: 403, code: 'ACCOUNT_DELETION_IN_PROGRESS' } : { ok: true };
}
