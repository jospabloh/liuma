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

import { readAllPages } from './_pages.ts';

// deno-lint-ignore no-explicit-any
type Db = any;

export type SchoolExport = {
  data: Record<string, unknown[]>;
  errors: Record<string, string>;
  /** Entities whose rows are not all in `data`: unreadable, or past the paging bound. */
  incomplete: string[];
  complete: boolean;
};

/**
 * Every row of every exported entity for one school (Codex review of PR #197,
 * round 10: a bare filter() returned the SDK's default 100 rows per entity,
 * so a real school's export was silently cut). Paged by created_date
 * (./_pages.ts), one entity after another (Base44's rate limit), and honest:
 * an entity that could not be read whole is named in `incomplete`, never
 * passed off as the full set.
 */
export async function readSchoolExport(sr: Db, schoolId: string, entities: string[]): Promise<SchoolExport> {
  const data: Record<string, unknown[]> = {};
  const errors: Record<string, string> = {};
  const incomplete: string[] = [];
  for (const name of entities) {
    try {
      const read = await readAllPages(sr.entities[name], { school_id: schoolId });
      data[name] = read.rows;
      if (!read.complete) {
        incomplete.push(name);
        errors[name] = 'too many rows to export at once';
      }
    } catch (e) {
      errors[name] = String((e as Error)?.message || e);
      incomplete.push(name);
    }
  }
  return { data, errors, incomplete, complete: incomplete.length === 0 };
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
