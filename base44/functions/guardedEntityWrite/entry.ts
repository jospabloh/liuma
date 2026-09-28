// guardedEntityWrite — server-authoritative write gate for the 7 entities whose
// write access can be modified per-user via PermissionOverride
// (Notice, Attendance, Homework, DiaryEntry, ChargeItem, PaymentConcept,
// PaymentRecord — see src/lib/authorization/policy.js's POLICY and
// PermisosRoles.jsx's override form).
//
// WHY THIS EXISTS (module 3 of the portfolio standard — see CLAUDE.md)
// RLS on these 7 entities grants write access by ROLE only. PermissionOverride
// rows let an admin explicitly allow/deny write access for a *specific* user
// beyond their role default (e.g. deny Homework write for one TEACHER whose
// grading privileges were revoked) — but nothing server-side ever read a
// PermissionOverride before RLS let a write through: a user an admin
// explicitly denied could still call e.g. base44.entities.Homework.create()
// directly and RLS would allow it (TEACHER has role-level write access,
// with no concept of a per-user override). This function is now the
// sanctioned write path for these 7 entities: it re-derives the caller's role
// from their own school-scoped UserProfile (never from the request), re-checks
// the base role policy AND any matching PermissionOverride — mirroring
// src/lib/authorization/policy.js's getEffectivePolicyDecision(), scoped to
// action:'write' since that's the only override action PermisosRoles.jsx's
// form actually lets an admin set for these entities (POLICY_ACTIONS) — and
// also closes the SchoolSubscription.subscription_status gap: a school in
// view_only/suspended/inactive/canceled (the same statuses
// src/lib/license/licenseModel.js's isReadOnlyStatus already treats as
// read-only client-side) cannot write here either. Keep this file's POLICY_WRITE
// and READ_ONLY_STATUSES in sync with those two client copies by hand — Deno
// functions can't import across directories (same constraint documented on
// governRoleChange/entry.ts), so there's no shared module to import instead.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.35';

const POLICY_WRITE: Record<string, string[]> = {
  Notice: ['ADMIN', 'TEACHER'],
  Attendance: ['ADMIN', 'TEACHER'],
  Homework: ['ADMIN', 'TEACHER'],
  DiaryEntry: ['ADMIN', 'TEACHER'],
  ChargeItem: ['ADMIN'],
  PaymentConcept: ['ADMIN'],
  PaymentRecord: ['ADMIN'],
};
const ENTITIES = Object.keys(POLICY_WRITE);

// Each of these entities' OWN deployed RLS (bypassed here by the service-role
// write below) normally pins this field to `{{user.id}}` on create/update —
// Attendance.recorded_by, DiaryEntry/Homework.teacher_id, Notice.author_id.
// Every real call site in src/ already sends the caller's own id/name here
// (grepped, none do otherwise), so overriding rather than trusting the
// client's value costs no legitimate use and closes an attribution-spoofing
// hole a caller could otherwise use to make a write look like it came from a
// different teacher (Base44 security scan, 2026-09-28).
const ATTRIBUTION_FIELDS: Record<string, { id: string; name?: string }> = {
  Attendance: { id: 'recorded_by', name: 'recorded_by_name' },
  PaymentRecord: { id: 'recorded_by' },
  DiaryEntry: { id: 'teacher_id', name: 'teacher_name' },
  Homework: { id: 'teacher_id', name: 'teacher_name' },
  Notice: { id: 'author_id', name: 'author_name' },
};
const READ_ONLY_STATUSES = ['view_only', 'suspended', 'inactive', 'canceled'];
const OPERATIONS = ['create', 'update', 'delete'];

type Profile = { id: string; user_id?: string; school_id?: string; app_role?: string; status?: string };
type Override = { user_profile_id?: string; resource?: string; action?: string; effect?: string };

// ChargeItem has one narrow carve-out beyond the table above, and it already
// lives in the DEPLOYED RLS (base44/entities/ChargeItem.jsonc's `create` rule)
// even though src/lib/authorization/policy.js's simplified POLICY table (and
// the mirror above) don't encode it: a PARENT may create a ChargeItem for
// their OWN linked student when accepting a paid event
// (EventosParaPadres.jsx), scoped to concept_type:'EVENTO'. RLS checks this
// via {{user.data.linked_student_ids}}, which — per
// src/lib/relations/getLinkedStudents.js's own comment — has no
// client-accessible source (base44.auth.me() never populates user.data on the
// client), so this function re-derives the same linkage the RLS token can't
// be read from, via the ParentStudent table directly (asServiceRole).
// deno-lint-ignore no-explicit-any
async function parentCanCreateEventCharge(
  sr: any,
  userId: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  if (data?.concept_type !== 'EVENTO') return false;
  const studentId = String(data?.student_id || '');
  if (!studentId) return false;
  const links: Array<{ parent_id?: string; student_id?: string; status?: string }> = await sr.entities.ParentStudent.filter({
    parent_id: userId,
    student_id: studentId,
    status: 'ACTIVE',
  });
  return links.length > 0;
}

// The PARENT/EVENTO carve-out's financial fields (amount, status, ...) must
// never come from the client — see the module-level comment on
// parentCanCreateEventCharge. Re-derives them from the referenced Event
// record itself, the only server-side source of what the fee actually is.
// Returns null if the event doesn't check out (wrong school, no cost, or
// doesn't exist), which the caller treats as "carve-out does not apply."
// deno-lint-ignore no-explicit-any
async function buildEventChargeData(
  sr: any,
  schoolId: string,
  studentId: string,
  eventId: string,
): Promise<Record<string, unknown> | null> {
  if (!eventId) return null;
  const event = await sr.entities.Event.get(eventId).catch(() => null);
  if (!event) return null;
  if (String(event.school_id || '') !== schoolId) return null;
  if (!event.has_cost) return null;
  return {
    school_id: schoolId,
    student_id: studentId,
    concept_type: 'EVENTO',
    concept_name: String(event.cost_concept || event.title || 'Evento'),
    original_amount: event.cost_amount,
    amount: event.cost_amount,
    discount_amount: 0,
    status: 'PENDING',
    due_date: event.confirmation_deadline || event.date,
    event_id: eventId,
  };
}

function bad(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, code, error: message }, { status });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return bad(401, 'UNAUTHENTICATED', 'Unauthorized');

    const body = await req.json().catch(() => ({}));
    const entity = String(body?.entity || '');
    const operation = String(body?.operation || '');
    if (!ENTITIES.includes(entity)) return bad(400, 'UNKNOWN_ENTITY', 'Unsupported entity');
    if (!OPERATIONS.includes(operation)) return bad(400, 'BAD_OPERATION', 'operation must be create/update/delete');

    const sr = base44.asServiceRole;

    // Determine the target school. For create, from the submitted data — the
    // caller's own profile in that school is what gets checked next, so a
    // client can't just claim a school it has no profile in. For update/
    // delete, from the EXISTING record, never from client input (a client
    // could otherwise submit a foreign school_id to sidestep its own school's
    // block).
    let schoolId: string;
    let existing: Record<string, unknown> | null = null;
    if (operation === 'create') {
      schoolId = String(body?.data?.school_id || '');
      if (!schoolId) return bad(400, 'MISSING_SCHOOL', 'data.school_id is required');
    } else {
      const id = String(body?.id || '');
      if (!id) return bad(400, 'MISSING_ID', 'id is required');
      existing = await sr.entities[entity].get(id).catch(() => null);
      if (!existing) return bad(404, 'NOT_FOUND', 'Record not found');
      schoolId = String((existing as { school_id?: string }).school_id || '');
    }

    const isPlatformOwner = user.role === 'admin';
    let profile: Profile | null = null;
    // Populated only when the ChargeItem/PARENT/EVENTO carve-out grants
    // access below — the create handler uses this, server-derived, instead
    // of body.data, so a parent can't submit their own amount/status.
    let eventChargeData: Record<string, unknown> | null = null;
    if (!isPlatformOwner) {
      const profiles: Profile[] = await sr.entities.UserProfile.filter({ user_id: user.id, school_id: schoolId });
      profile = profiles.find((p) => p.status === 'ACTIVE') || null;
      if (!profile) return bad(403, 'NO_PROFILE', 'No active profile in this school');

      // Base role policy + PermissionOverride, mirroring getEffectivePolicyDecision:
      // an explicit deny override wins outright; an allow override grants access
      // even if the role default doesn't; otherwise fall back to the role default.
      const roleAllowed = (POLICY_WRITE[entity] || []).includes(String(profile.app_role));
      const overrides: Override[] = await sr.entities.PermissionOverride.filter({
        school_id: schoolId,
        user_profile_id: profile.id,
        resource: entity,
        action: 'write',
      });
      const hasDeny = overrides.some((o) => o.effect === 'deny');
      const hasAllow = overrides.some((o) => o.effect === 'allow');
      let allowed = hasDeny ? false : hasAllow ? true : roleAllowed;

      // The ChargeItem/PARENT/EVENTO carve-out (see parentCanCreateEventCharge's
      // own comment) is independent of PermissionOverride — it's a narrow RLS
      // grant already live in production, not a role default an admin can
      // override — so it applies even when the base policy/override check above
      // denied. A deny override still wins over it, same precedence as above.
      if (!hasDeny && !allowed && entity === 'ChargeItem' && operation === 'create' && profile.app_role === 'PARENT') {
        const canCreate = await parentCanCreateEventCharge(sr, user.id, body.data || {});
        if (canCreate) {
          eventChargeData = await buildEventChargeData(
            sr,
            schoolId,
            String(body?.data?.student_id || ''),
            String(body?.data?.event_id || ''),
          );
          allowed = eventChargeData !== null;
        }
      }
      if (!allowed) return bad(403, 'FORBIDDEN', 'Not permitted to write this resource');

      // Billing write-gate — same statuses the client already treats as read-only.
      const subs: Array<{ subscription_status?: string }> = await sr.entities.SchoolSubscription.filter({ school_id: schoolId });
      const sub = subs[0] || null;
      if (sub && READ_ONLY_STATUSES.includes(String(sub.subscription_status))) {
        return bad(403, 'WRITE_BLOCKED', 'This school\'s subscription is read-only');
      }
    }

    if (operation === 'create') {
      // eventChargeData, when set, is entirely server-derived (see
      // buildEventChargeData) and replaces body.data outright — the parent's
      // submitted amount/status/etc. never reach the write.
      const data: Record<string, unknown> = eventChargeData ?? { ...(body.data || {}) };

      const attribution = ATTRIBUTION_FIELDS[entity];
      if (attribution) {
        data[attribution.id] = user.id;
        if (attribution.name) data[attribution.name] = String(user.full_name || '');
      }

      const created = await sr.entities[entity].create(data);
      return Response.json({ ok: true, record: created });
    }

    if (operation === 'update') {
      // A client-submitted school_id on update could otherwise reassign the
      // record to a different tenant — always drop it, the record keeps its
      // existing school_id. Same for the entity's attribution field(s): who
      // authored a record doesn't change on edit, and no real call site ever
      // sends one on update (only on create).
      const patch = { ...(body.data || {}) };
      delete (patch as { school_id?: unknown }).school_id;
      const attribution = ATTRIBUTION_FIELDS[entity];
      if (attribution) {
        delete (patch as Record<string, unknown>)[attribution.id];
        if (attribution.name) delete (patch as Record<string, unknown>)[attribution.name];
      }
      const updated = await sr.entities[entity].update(String((existing as { id: string }).id), patch);
      return Response.json({ ok: true, record: updated });
    }

    // operation === 'delete'
    await sr.entities[entity].delete(String((existing as { id: string }).id));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, code: 'INTERNAL', error: (e as Error).message }, { status: 500 });
  }
});
