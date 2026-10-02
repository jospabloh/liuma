// _exportGate.ts — the last check before an export leaves (Codex review of
// PR #197, round 9). Import-free so node --test runs it
// (tests/unit/deletion-guard.test.js).
//
// The export reads the whole school with the service role, which takes a
// while; the deletion-marker gate at the top only saw the auth.me()
// snapshot. Right before answering, the STORED User is read again: a marker
// set meanwhile (or a User already removed) discards the export — 403
// ACCOUNT_DELETION_IN_PROGRESS — and a User that cannot be read discards it
// too — 503 — rather than hand out a school's data on an unknown state.

// deno-lint-ignore no-explicit-any
type Db = any;
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
