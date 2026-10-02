// Pure rules for guardedFamilyWrite — no Deno globals, no SDK, no imports, so
// the function (./_policy.ts) and `node --test`
// (tests/unit/guarded-family-write.test.js) load the very same code.
//
// These are the records a FAMILY writes about a child: who may pick them up,
// why they'll be absent, whether they go to an event, what uniform to order.
// Before P7 each entity's create RLS only checked "parent_id is you" (or
// "you created it"), never that the child is yours — a stranger could put
// themselves on any child's authorized-pickup list.

// The author name a write stamps (author_name, teacher_name, parent_name,
// uploaded_by_name, requester_name). `display_name` is the name the person
// chose in LIUMA ("¿Cómo te llamas?", a User custom field: the SDK's
// auth.updateMe() cannot write full_name); `full_name` is whatever signup
// left, often the email handle. A handle is never stamped as a name (Codex
// review of PR #197): the same rule as the greeting (src/lib/userDisplayName.js
// #isHandleLikeName) and Lumi (_lumiCore.ts#displayUserName) — empty, an
// address, the email's local part, or one token with . + _ or digits. Both
// fields are checked: display_name is self-written with updateMe, so the
// dialog's validation can be skipped. Without a real name the stamp is the
// caller's ROLE ('Dirección', 'Docente', 'Familia'), because these fields are
// shown as the author in lists and e-mails, where a blank reads as a bug and
// the role is what the reader needs; with no role, ''.
// Identical in guardedEntityWrite/_policy.ts and guardedFamilyWrite/_policy.ts
// (functions cannot import across directories), from this comment to the end
// of callerDisplayName; tests/unit/user-display-name.test.js compares the
// two and runs both on the same cases.
export const AUTHOR_ROLE_LABELS: Record<string, string> = { ADMIN: 'Dirección', TEACHER: 'Docente', PARENT: 'Familia' };

export function isHandleLikeName(name: unknown, email?: unknown): boolean {
  const value = String(name ?? '').trim();
  if (!value || value.includes('@')) return true;
  const local = String(email ?? '').split('@')[0].trim().toLowerCase();
  if (local && value.toLowerCase() === local) return true;
  return !/\s/.test(value) && /[.+_\d]/.test(value);
}

export function callerDisplayName(user: unknown, role?: unknown): string {
  const u = (user ?? {}) as { display_name?: unknown; full_name?: unknown; email?: unknown; data?: { display_name?: unknown } | null };
  const raw = typeof u.display_name === 'string' ? u.display_name : typeof u.data?.display_name === 'string' ? u.data.display_name : '';
  const chosen = raw.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!isHandleLikeName(chosen, u.email)) return chosen;
  const full = String(u.full_name ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!isHandleLikeName(full, u.email)) return full;
  return AUTHOR_ROLE_LABELS[String(role ?? '')] || '';
}

// Accepting the current Aviso de Privacidad and Términos is mandatory to use
// LIUMA (v1.9.0). MIRRORS schoolRead/_scope.ts#profileConsentIsCurrent and
// src/lib/consent/privacyNotice.js; tests/unit/consent-gate.test.js checks
// every copy of the versions.
export const CONSENT_NOTICE_VERSION = '2026-10-02';
export const CONSENT_TERMS_VERSION = '2026-10-02';

export function profileConsentIsCurrent(profile: { consent_notice_version?: unknown; consent_terms_version?: unknown } | null): boolean {
  return Boolean(profile)
    && profile!.consent_notice_version === CONSENT_NOTICE_VERSION
    && profile!.consent_terms_version === CONSENT_TERMS_VERSION;
}

export const FAMILY_OPERATIONS: Record<string, string[]> = {
  EmergencyContact: ['create', 'update', 'delete'],
  AbsenceNotification: ['create'],
  EventResponse: ['create', 'update'],
  UniformOrder: ['create'],
};

export const EVENT_RESPONSES = ['ACCEPTED', 'DECLINED', 'PENDING'];
export const PAYMENT_STATUSES = ['NOT_REQUIRED', 'PENDING', 'PAID'];

const SHORT = 200;
const LONG = 2000;

export type Decision = { ok: true } | { ok: false; code: string; message: string };
export type Built = { ok: true; data: Record<string, unknown>; pickupRevoked?: boolean } | { ok: false; code: string; message: string };

function fail(code: string, message: string): { ok: false; code: string; message: string } {
  return { ok: false, code, message };
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Today's calendar day at the school (Mexico), 'YYYY-MM-DD'. MIRRORS
 * guardedEntityWrite/_money.ts#mexicoToday (functions cannot import across
 * directories; tests/unit/payments-money.test.js compares the copies).
 */
export function mexicoToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 'YYYY-MM-DD' that names a real calendar day (no 2026-02-31). */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * Whether a family may file an absence request for this day (v1.8.3, live QA
 * of v1.8.1: the server took any well-formed date, so a direct call filed one
 * for a day already gone, and a second request for the same day went in next
 * to the first — the school then reviewed the same absence twice).
 *
 *  - The day is the school's today or later. An absence request is notice
 *    given ahead of time; what already happened is the teacher's attendance
 *    record (Asistencia), not a request. SolicitarAusencia's date picker has
 *    always said so (min = today); this is the server saying it too.
 *  - One live request per child per day. A REJECTED one doesn't count: the
 *    family may file again with a better reason.
 *
 * `sameDay` is what the store holds for this student on that day (the caller
 * reads it); rows for another student or day are ignored, so a broad read is
 * harmless.
 */
export function checkAbsenceRequest(input: {
  absenceDate: string;
  studentId: string;
  today: string;
  sameDay?: Array<Record<string, unknown>> | null;
}): Decision {
  const { absenceDate, studentId, today } = input;
  if (!isCalendarDate(absenceDate)) return fail('MISSING_FIELDS', 'absence_date must be a real YYYY-MM-DD day');
  if (absenceDate < today) return fail('ABSENCE_DATE_PAST', `absence_date ${absenceDate} is before the school's today (${today})`);
  const duplicate = (input.sameDay || []).some((row) =>
    row &&
    String(row.student_id || '') === studentId &&
    String(row.absence_date || '').slice(0, 10) === absenceDate &&
    row.status !== 'REJECTED');
  if (duplicate) return fail('ABSENCE_DUPLICATE', `there is already a request for ${absenceDate}`);
  return { ok: true };
}

/**
 * After an absence request is created: whether it lost a same-instant race.
 * The pre-read in checkAbsenceRequest is not atomic, so two creates for the
 * same child and day can both pass it. Every racer re-reads and applies the
 * same rule: among live rows (not REJECTED) the oldest by created_date, then
 * id, keeps the day; any other one is the loser and is removed by its own
 * request. All racers agree on the keeper, so exactly one survives.
 * `created` is added if the re-read does not show it yet.
 */
export function absenceRaceLoser(
  rows: Array<Record<string, unknown>> | null | undefined,
  created: Record<string, unknown>,
): boolean {
  const createdId = String(created?.id || '');
  if (!createdId) return false;
  const studentId = String(created.student_id || '');
  const day = String(created.absence_date || '').slice(0, 10);
  const live = (rows || []).filter((row) =>
    row &&
    String(row.student_id || '') === studentId &&
    String(row.absence_date || '').slice(0, 10) === day &&
    row.status !== 'REJECTED');
  if (!live.some((row) => String(row.id) === createdId)) live.push(created);
  live.sort((a, b) => {
    const ta = String(a.created_date || '');
    const tb = String(b.created_date || '');
    if (ta !== tb) return ta < tb ? -1 : 1;
    return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
  });
  return String(live[0].id) !== createdId;
}

/**
 * Who may write a family record for a student. Runs after the caller's
 * ACTIVE profile in the STUDENT's school (never a client-supplied school) has
 * been found.
 *
 *  - an ADMIN of that school may write any of them;
 *  - anyone else needs an ACTIVE ParentStudent link to that student;
 *  - an EventResponse may only be edited by the parent who gave it;
 *  - an EmergencyContact may only be edited or removed by whoever added it
 *    (the pre-P7 RLS rule was "created_by_id is you"; delete was platform
 *    only). A parent must not be able to drop a contact the school or the
 *    other parent registered.
 */
export function decideFamilyAccess(input: {
  entity: string;
  operation: string;
  isAdmin: boolean;
  isLinkedParent: boolean;
  userId: string;
  existing?: Record<string, unknown> | null;
}): Decision {
  const { entity, operation, isAdmin, isLinkedParent, userId, existing } = input;
  if (!(FAMILY_OPERATIONS[entity] || []).includes(operation)) {
    return fail('BAD_OPERATION', `${operation} is not supported for ${entity}`);
  }
  if (isAdmin) return { ok: true };
  if (!isLinkedParent) return fail('NOT_LINKED', 'You are not linked to this student');
  if (entity === 'EventResponse' && operation === 'update' && String(existing?.parent_id || '') !== userId) {
    return fail('NOT_OWN_RESPONSE', 'Only the parent who answered may change this response');
  }
  if (entity === 'EmergencyContact' && operation !== 'create') {
    // added_by_user_id for records written through this function; created_by_id
    // for the ones a parent created directly before P7.
    const addedBy = String(existing?.added_by_user_id || existing?.created_by_id || '');
    if (!addedBy || addedBy !== userId) {
      return fail('NOT_OWN_CONTACT', 'Only whoever added this contact, or a school ADMIN, may change it');
    }
  }
  return { ok: true };
}

/**
 * The record to write, built ONLY from fields a family may set. school_id,
 * student_id and parent_id come from the server (ctx), never from `input`;
 * review/status fields are fixed; `is_authorized_pickup` is ADMIN-only.
 */
export function buildFamilyPayload(
  entity: string,
  operation: string,
  input: Record<string, unknown>,
  ctx: {
    isAdmin: boolean;
    userId: string;
    userName: string;
    schoolId: string;
    studentId: string;
    existing?: Record<string, unknown> | null;
    event?: { has_cost?: boolean } | null;
    chargeId?: string | null;
    // AbsenceNotification only: the school's today (defaults to Mexico's) and
    // the requests already stored for this student on the requested day.
    today?: string;
    sameDayAbsences?: Array<Record<string, unknown>> | null;
  },
): Built {
  const data = input || {};

  if (entity === 'EmergencyContact') {
    if (operation === 'create') {
      const name = text(data.name, SHORT);
      const phone = text(data.phone, 40);
      if (!name || !phone) return fail('MISSING_FIELDS', 'name and phone are required');
      return {
        ok: true,
        data: {
          school_id: ctx.schoolId,
          student_id: ctx.studentId,
          name,
          relationship: text(data.relationship, SHORT),
          phone,
          notes: text(data.notes, LONG),
          // Service-role writes don't carry the caller as created_by_id, so the
          // read rule keys on this instead.
          added_by_user_id: ctx.userId,
          // Who may take a child out of school is the school's call: a parent
          // can propose a contact, only an ADMIN can authorize the pickup.
          is_authorized_pickup: ctx.isAdmin ? data.is_authorized_pickup === true : false,
        },
      };
    }
    // update
    const patch: Record<string, unknown> = {};
    for (const [field, max] of [['name', SHORT], ['relationship', SHORT], ['phone', 40], ['notes', LONG]] as Array<[string, number]>) {
      if (field in data) patch[field] = text(data[field], max);
    }
    if (('name' in patch && !patch.name) || ('phone' in patch && !patch.phone)) {
      return fail('MISSING_FIELDS', 'name and phone cannot be empty');
    }
    let pickupRevoked = false;
    if (ctx.isAdmin) {
      if ('is_authorized_pickup' in data) patch.is_authorized_pickup = data.is_authorized_pickup === true;
    } else if (ctx.existing?.is_authorized_pickup === true) {
      // Changing the name, phone or relationship of an authorized contact
      // changes WHO is authorized. That goes back to the school to confirm.
      const identityChanged = ['name', 'relationship', 'phone'].some(
        (f) => f in patch && patch[f] !== String(ctx.existing?.[f] ?? ''),
      );
      if (identityChanged) {
        patch.is_authorized_pickup = false;
        pickupRevoked = true;
      }
    }
    return { ok: true, data: patch, pickupRevoked };
  }

  if (entity === 'AbsenceNotification') {
    const absenceDate = text(data.absence_date, 10);
    const reason = text(data.reason, LONG);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(absenceDate) || !reason) {
      return fail('MISSING_FIELDS', 'absence_date (YYYY-MM-DD) and reason are required');
    }
    const allowed = checkAbsenceRequest({
      absenceDate,
      studentId: ctx.studentId,
      today: ctx.today || mexicoToday(),
      sameDay: ctx.sameDayAbsences,
    });
    if (!allowed.ok) return allowed;
    return {
      ok: true,
      data: {
        school_id: ctx.schoolId,
        student_id: ctx.studentId,
        parent_id: ctx.userId,
        parent_name: ctx.userName,
        absence_date: absenceDate,
        reason,
        // A parent files the justification; only the school reviews it.
        status: 'PENDING',
      },
    };
  }

  if (entity === 'EventResponse') {
    if (operation === 'create') {
      const response = EVENT_RESPONSES.includes(String(data.response)) ? String(data.response) : 'PENDING';
      return {
        ok: true,
        data: {
          school_id: ctx.schoolId,
          event_id: text(data.event_id, SHORT),
          student_id: ctx.studentId,
          parent_id: ctx.userId,
          parent_name: ctx.userName,
          response,
          notes: text(data.notes, LONG),
          // Derived from the Event, never from the parent: a parent must not
          // be able to answer "PAID" for themselves.
          payment_status: ctx.event?.has_cost && response === 'ACCEPTED' ? 'PENDING' : 'NOT_REQUIRED',
        },
      };
    }
    // update
    const patch: Record<string, unknown> = {};
    if ('response' in data && EVENT_RESPONSES.includes(String(data.response))) patch.response = String(data.response);
    if ('notes' in data) patch.notes = text(data.notes, LONG);
    if (ctx.chargeId) {
      patch.charge_id = ctx.chargeId;
      if (ctx.existing?.payment_status !== 'PAID') patch.payment_status = 'PENDING';
    }
    if (ctx.isAdmin && PAYMENT_STATUSES.includes(String(data.payment_status))) {
      patch.payment_status = String(data.payment_status);
    }
    return { ok: true, data: patch };
  }

  if (entity === 'UniformOrder') {
    const rawItems = Array.isArray(data.items) ? data.items : [];
    const items = rawItems
      .slice(0, 50)
      .map((item) => {
        const it = (item || {}) as Record<string, unknown>;
        const quantity = Math.floor(Number(it.quantity));
        return {
          product: text(it.product, SHORT),
          size: text(it.size, 40),
          quantity: Number.isFinite(quantity) && quantity > 0 ? Math.min(quantity, 99) : 1,
        };
      })
      .filter((it) => it.product && it.size);
    if (items.length === 0) return fail('MISSING_FIELDS', 'at least one item with product and size is required');
    const measurements: Record<string, string> = {};
    const rawMeasurements = data.measurements && typeof data.measurements === 'object' ? data.measurements as Record<string, unknown> : {};
    for (const [key, value] of Object.entries(rawMeasurements).slice(0, 20)) {
      if (typeof value === 'string' || typeof value === 'number') measurements[key.slice(0, 40)] = String(value).slice(0, 40);
    }
    return {
      ok: true,
      data: {
        school_id: ctx.schoolId,
        student_id: ctx.studentId,
        parent_id: ctx.userId,
        parent_name: ctx.userName,
        items,
        measurements,
        notes: text(data.notes, LONG),
        // status / admin_notes / estimated_delivery belong to the school.
        status: 'PENDING',
      },
    };
  }

  return fail('UNKNOWN_ENTITY', 'Unsupported entity');
}
