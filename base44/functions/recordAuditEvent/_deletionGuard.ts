// _deletionGuard.ts — no write lands on an account whose deletion started.
// IDENTICAL in every function that writes after auth.me() (functions cannot
// import across directories); tests/unit/deletion-guard.test.js compares the
// copies, checks ANONYMIZE against deleteMyAccount/_deletion.ts, and fails if
// a writer is not wrapped. Import-free, so node --test runs it.
//
// WHY (Codex review of PR #197, round 8). Every function refuses a caller
// whose User carries a deletion marker — but on the auth.me() snapshot. A
// write could pass that gate, pause, and land after deleteMyAccount set its
// marker and finished anonymizing: a late DiaryEntry keeping the deleted
// teacher's id and name. Generic fix, not per entity:
//
//   withDeletionGuard(handler) wraps the function; inside it,
//   guarded(base44.asServiceRole, user.id) returns the same client with
//   every WRITE checked:
//     before the request's first write → re-read the STORED User; a marker
//       (or a User already removed) refuses with 403
//       ACCOUNT_DELETION_IN_PROGRESS, nothing written. A read that fails is
//       an error, not a pass.
//     after EVERY write → re-read it again; a marker now set means this row
//       landed during a deletion, so it gets exactly what the deletion does
//       to that entity (anonymize the name, revoke the link, close the
//       assignment, drop the user's own pending request / inbox row — see
//       stragglerAction) and the request answers 403. The post-check of one
//       write is the pre-check of the next, so a request pays one extra
//       read per write plus one.
//   A row compensated nowhere (both attempts failed) is recorded as an
//   AuditLog DELETION_STRAGGLER_UNRESOLVED row with its entity and id, for
//   the owner. A post-check whose read FAILS twice cannot tell whether a
//   deletion started, so it compensates nothing (no marker is known) but
//   records the row the same way and the request answers 503
//   DELETION_STATE_UNVERIFIED — never a success (Codex review of PR #197,
//   round 9: the deletion's final sweep may already have run).
//
// School data is never deleted to compensate — only what deleteMyAccount
// itself would delete (the user's own unattended requests and inbox rows).

export const ANONYMIZED_NAME = 'Cuenta eliminada'; // MIRRORS deleteMyAccount/_deletion.ts
// MIRRORS deleteMyAccount/_deletion.ts#ANONYMIZE (tested for equality).
export const ANONYMIZE: Array<[string, string, string]> = [
  ['AbsenceNotification', 'parent_id', 'parent_name'],
  ['UniformOrder', 'parent_id', 'parent_name'],
  ['EventResponse', 'parent_id', 'parent_name'],
  ['Attendance', 'recorded_by', 'recorded_by_name'],
  ['DiaryEntry', 'teacher_id', 'teacher_name'],
  ['Homework', 'teacher_id', 'teacher_name'],
  ['Notice', 'author_id', 'author_name'],
  ['OfficialDocument', 'uploaded_by', 'uploaded_by_name'],
  ['SupportTicket', 'requester_user_id', 'requester_name'],
];
// MIRRORS deleteMyAccount/_deletion.ts#OPEN_CHANGE_STATUSES.
export const OPEN_CHANGE_STATUSES = ['PENDING_ADMIN_APPROVAL', 'PENDING_SECOND_ADMIN_APPROVAL'];

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export const DELETION_IN_PROGRESS_BODY = { ok: false, code: 'ACCOUNT_DELETION_IN_PROGRESS', error: 'ACCOUNT_DELETION_IN_PROGRESS' };

export class DeletionInProgressError extends Error {
  status = 403;
  code = 'ACCOUNT_DELETION_IN_PROGRESS';
  constructor() {
    super('ACCOUNT_DELETION_IN_PROGRESS');
  }
}

export const DELETION_UNVERIFIED_BODY = { ok: false, code: 'DELETION_STATE_UNVERIFIED', error: 'DELETION_STATE_UNVERIFIED' };

export class DeletionUnverifiedError extends Error {
  status = 503;
  code = 'DELETION_STATE_UNVERIFIED';
  constructor() {
    super('DELETION_STATE_UNVERIFIED');
  }
}

function isNotFound(e: unknown): boolean {
  const err = e as { status?: unknown; message?: unknown } | null;
  return err?.status === 404 || /not found/i.test(String(err?.message ?? ''));
}

function filled(v: unknown): boolean {
  return typeof v === 'string' && v !== '';
}

/** 'marked' (a deletion marker is set, or the User is gone) or 'none'. Throws on a failed read. */
export async function storedDeletionState(sr: Db, userId: string): Promise<'marked' | 'none'> {
  let row: Row | null = null;
  try {
    row = await sr.entities.User.get(userId);
  } catch (e) {
    if (isNotFound(e)) return 'marked';
    throw e;
  }
  const r = (row || {}) as Row;
  const data = (r.data || {}) as Row;
  return filled(r.account_deletion_started_at ?? data.account_deletion_started_at)
    || filled(r.account_deleted_at ?? data.account_deleted_at)
    ? 'marked'
    : 'none';
}

export type StragglerAction = { op: 'delete' } | { op: 'update'; data: Row } | null;

/** What deleteMyAccount does to this row of `userId`'s — null when nothing. */
export function stragglerAction(entity: string, row: Row | null, userId: string): StragglerAction {
  if (!row) return null;
  const mine = (field: string) => String(row[field] ?? '') === userId;
  if ((entity === 'AbsenceNotification' || entity === 'UniformOrder') && mine('parent_id') && row.status === 'PENDING') return { op: 'delete' };
  if (entity === 'PendingChange' && mine('requester_user_id') && OPEN_CHANGE_STATUSES.includes(String(row.status))) return { op: 'delete' };
  if (entity === 'NoticeDelivery' && mine('recipient_user_id')) return { op: 'delete' };
  if ((entity === 'NoticeRead' || entity === 'ParentProfile') && mine('user_id')) return { op: 'delete' };
  if (entity === 'ParentStudent' && mine('parent_id') && row.status !== 'REVOKED') return { op: 'update', data: { status: 'REVOKED' } };
  if (entity === 'TeacherClassroom' && mine('teacher_id') && row.is_active === true) return { op: 'update', data: { is_active: false } };
  for (const [e, idField, nameField] of ANONYMIZE) {
    if (e === entity && mine(idField) && row[nameField] !== ANONYMIZED_NAME) return { op: 'update', data: { [nameField]: ANONYMIZED_NAME } };
  }
  return null;
}

async function tryTwice(fn: () => Promise<unknown>): Promise<boolean> {
  for (let i = 0; i < 2; i += 1) {
    try { await fn(); return true; } catch { /* retried once */ }
  }
  return false;
}

/** Apply stragglerAction to one written row; record it if that fails. */
export async function compensateRow(sr: Db, entity: string, id: string, userId: string): Promise<boolean> {
  let row: Row | null = null;
  try {
    row = await sr.entities[entity].get(id);
  } catch (e) {
    if (isNotFound(e)) return true; // gone already
    row = null;
  }
  const action = row ? stragglerAction(entity, row, userId) : null;
  let ok = row !== null;
  if (action?.op === 'delete') ok = await tryTwice(() => sr.entities[entity].delete(id));
  if (action?.op === 'update') ok = await tryTwice(() => sr.entities[entity].update(id, action.data));
  if (ok) return true;
  await recordStraggler(sr, entity, id, userId, String(row?.school_id || ''), action?.op || 'read_failed');
  return false;
}

/** The owner's record of a write the guard could not settle (retried once). */
export async function recordStraggler(sr: Db, entity: string, id: string, userId: string, schoolId: string, reason: string): Promise<void> {
  console.error('deletion guard: unresolved straggler', entity, id, userId, reason);
  await tryTwice(() => sr.entities.AuditLog.create({
    school_id: schoolId || 'unknown',
    user_id: userId,
    action: 'DELETION_STRAGGLER_UNRESOLVED',
    target_type: entity,
    target_id: id,
    details: { action: reason },
  }));
}

const WRITE_OPS = new Set(['create', 'update', 'delete', 'bulkCreate', 'updateMany', 'deleteMany']);

type Guard = { sr: Db; tripped: () => boolean; unverified: () => boolean };

/** The service-role client with every write checked (see the top of this file). */
export function guardWrites(raw: Db, userId: string): Guard {
  let checked = false;
  let tripped = false;
  let unverified = false;
  const pre = async () => {
    if (tripped) throw new DeletionInProgressError();
    if (unverified) throw new DeletionUnverifiedError();
    if (checked) return;
    if (await storedDeletionState(raw, userId) === 'marked') {
      tripped = true;
      throw new DeletionInProgressError();
    }
    checked = true;
  };
  const post = async (entity: string, written: Row[]) => {
    let state: 'marked' | 'none' | 'unknown' = 'unknown';
    for (let i = 0; i < 2 && state === 'unknown'; i += 1) {
      try {
        state = await storedDeletionState(raw, userId);
      } catch {
        state = 'unknown';
      }
    }
    if (state === 'unknown') {
      // No marker is known, so nothing is compensated; the row is recorded
      // and the request does not report success.
      unverified = true;
      for (const row of written) {
        if (row?.id) await recordStraggler(raw, entity, String(row.id), userId, String(row.school_id || ''), 'state_unverified');
      }
      throw new DeletionUnverifiedError();
    }
    if (state !== 'marked') return;
    tripped = true;
    for (const row of written) if (row?.id) await compensateRow(raw, entity, String(row.id), userId);
    throw new DeletionInProgressError();
  };
  const entities = new Proxy({}, {
    get(_t, name) {
      const handler = raw.entities[name as string];
      if (!handler || typeof name !== 'string') return handler;
      return new Proxy(handler, {
        get(target, op) {
          const fn = target[op];
          if (typeof fn !== 'function') return fn;
          if (!WRITE_OPS.has(String(op))) return fn.bind(target);
          return async (...args: unknown[]) => {
            await pre();
            const result = await fn.apply(target, args);
            const written: Row[] = op === 'create' ? [result]
              : op === 'bulkCreate' ? (Array.isArray(result) ? result : [])
              : op === 'update' ? [{ id: args[0] }]
              : [];
            await post(name, written);
            return result;
          };
        },
      });
    },
  });
  const sr = new Proxy(raw, {
    get(target, prop) {
      if (prop === 'entities') return entities;
      return Reflect.get(target, prop);
    },
  });
  return { sr, tripped: () => tripped, unverified: () => unverified };
}

export type Guarded = (raw: Db, userId: string) => Db;

/**
 * Wraps a function's handler: `guarded(raw, userId)` hands out checked
 * clients, and if any of them tripped — whatever the handler answered, and
 * whatever it caught — the answer is 403 ACCOUNT_DELETION_IN_PROGRESS (or
 * 503 DELETION_STATE_UNVERIFIED when the state could not be read back).
 */
export function withDeletionGuard(handler: (req: Request, guarded: Guarded) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const guards: Guard[] = [];
    const guarded: Guarded = (raw, userId) => {
      const g = guardWrites(raw, userId);
      guards.push(g);
      return g.sr;
    };
    let res: Response;
    try {
      res = await handler(req, guarded);
    } catch (e) {
      if (e instanceof DeletionInProgressError || guards.some((g) => g.tripped())) {
        return Response.json(DELETION_IN_PROGRESS_BODY, { status: 403 });
      }
      if (e instanceof DeletionUnverifiedError || guards.some((g) => g.unverified())) {
        return Response.json(DELETION_UNVERIFIED_BODY, { status: 503 });
      }
      throw e;
    }
    if (guards.some((g) => g.tripped())) return Response.json(DELETION_IN_PROGRESS_BODY, { status: 403 });
    if (guards.some((g) => g.unverified())) return Response.json(DELETION_UNVERIFIED_BODY, { status: 503 });
    return res;
  };
}
