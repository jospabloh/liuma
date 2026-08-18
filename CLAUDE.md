# Liuma — Project Notes

School management SaaS (Base44 backend + Vite/React front-end), multi-tenant via
`school_id` on every business entity. See `docs/authorization-matrix.md` and
`docs/security-role-governance-remediation.md`.

## Module 3 (server-side permission/billing enforcement) — fixed 2026-08-18

A portfolio-standard audit (`jospabloh/acacia-app-standard`, module 3) flagged
"server-side enforcement of `PermissionOverride`/`SchoolSubscription.
subscription_status`" as a gap. Investigated in detail first (see git history
of this section for the original "investigated, deferred" writeup), then
actually closed:

- **`PermissionOverride` itself was already correctly gated.** Its RLS
  (`base44/entities/PermissionOverride.jsonc`) requires
  `data.app_role: ADMIN` + tenant match on all four ops — a TEACHER/PARENT
  cannot create, read, update, or delete an override via a direct SDK call.
  This part was never a gap and needed no change.
- **The real gap: an override, once created, was never enforced.**
  `PermissionOverride` rows exist to grant/deny write access
  (`Notice`/`Attendance`/`Homework`/`DiaryEntry`/`ChargeItem`/
  `PaymentConcept`/`PaymentRecord`, per `PermisosRoles.jsx`'s override form —
  the only override `action` that form actually lets an admin set for these
  entities is `read`/`write`, matching `src/lib/authorization/policy.js`'s
  `POLICY_ACTIONS`) to specific users beyond their role defaults.
  `src/lib/authorization/overrides.js` evaluated them **client-side only** —
  nothing server-side read a `PermissionOverride` row before allowing a
  write to the entity it's supposed to gate. A user an admin explicitly
  denied `Homework:write` for could still call
  `base44.entities.Homework.create()` directly and RLS let it through (base
  `Homework` RLS grants TEACHER create by role, with no concept of a
  per-user override).
- **`SchoolSubscription.subscription_status` had the same shape of gap.**
  `useCanWrite()`/`ReadOnlyBanner.jsx` read it to block the UI, but no
  entity's RLS checked it — Base44's RLS rule language has no join/lookup (a
  `Notice` row can't reference a field on a different `SchoolSubscription`
  row), so this couldn't be closed declaratively.

**Fix:** new `base44/functions/guardedEntityWrite/entry.ts` — one
Safe function, parameterized by `entity` (one of the 7 above) and
`operation` (`create`/`update`/`delete`), now the sanctioned write path for
all of them. It re-derives the caller's role from their own school-scoped
`UserProfile` (never from the request — for `update`/`delete` the target
school comes from the **existing** record, not client input, so a client
can't submit a foreign `school_id` to dodge its own school's block), then
checks, in order: the base role policy (mirrors `policy.js`'s `POLICY`
table) → any matching `PermissionOverride` for `action:'write'` (deny wins
outright, allow grants access beyond the role default — mirrors
`getEffectivePolicyDecision()`) → the `SchoolSubscription.subscription_status`
read-only gate (`view_only`/`suspended`/`inactive`/`canceled` — same
statuses `licenseModel.js`'s `isReadOnlyStatus` already treats as read-only
client-side). Platform owner (`user.role === 'admin'`) bypasses all of it,
same as every other privileged function in this app.

One narrow carve-out needed its own logic: `ChargeItem`'s **deployed** RLS
(`base44/entities/ChargeItem.jsonc`) already lets a PARENT create a charge
for their own linked student when accepting a paid event
(`EventosParaPadres.jsx`, `concept_type:'EVENTO'` only) — a real exception
`policy.js`'s simplified `POLICY` table doesn't encode. RLS checks this via
`{{user.data.linked_student_ids}}`, which per `getLinkedStudents.js`'s own
comment has no client-accessible source (`base44.auth.me()` never populates
`user.data` on the client) — the new function re-derives the same linkage
server-side via the `ParentStudent` table instead, so this one legitimate
non-admin write path keeps working unchanged.

The 15 real call sites across 8 pages (`AvisosAdmin.jsx`, `AvisosMaestro.jsx`,
`Asistencia.jsx` ×4, `CrearBitacora.jsx`, `EventosParaPadres.jsx`,
`GestionAusencias.jsx` ×2, `PagosAdmin.jsx` ×5, `TareaMaestro.jsx`) were
migrated from direct `base44.entities.X.create/update/delete(...)` to a
shared thin wrapper, `src/lib/authorization/guardedWrite.js`
(`guardedCreate`/`guardedUpdate`/`guardedDelete`), which calls
`base44.functions.invoke('guardedEntityWrite', ...)` — same calling shape
(data in, record out) as the entity SDK it replaces, so each call site was a
near-mechanical swap. `POLICY_WRITE`/`READ_ONLY_STATUSES` are duplicated
inline in `entry.ts` (Deno functions can't import across directories, same
constraint `governRoleChange/entry.ts` already documents) — keep both in
sync by hand with `policy.js`'s `POLICY` and `licenseModel.js`'s
`READ_ONLY_STATUSES` if either changes.

**Deliberately NOT migrated:** `src/lib/notifications/service.js`'s two
`Notice.create` calls (`sendInApp`/`sendHighPriorityAlert`). These aren't a
user authoring a Notice — they're the app's internal in-app-notification
delivery mechanism, reused as a side effect of many different features (only
one direct caller today, `AlertaEmergencia.jsx`'s emergency broadcast, but
`sendByEvent`'s generic dispatcher is designed for many more). Routing an
infrastructure-level notification record through the same
resource/action-based override model as a user-authored Notice would be a
category error, and risked silently breaking notification delivery in paths
this session couldn't fully trace. Left on direct RLS-gated writes
(role-based only, same as before this fix) — not a regression, since no
`PermissionOverride` for `Notice:write` was ever enforced against these
calls anyway, and it's now explicitly documented as an accepted
architectural distinction rather than an oversight.

**Separate finding, not built here:** `PermisosRoles.jsx` also renders a
"role permission template" grid (`RESOURCES` × `ACTIONS`, `DEFAULT_TEMPLATE`,
add/edit/delete template) that looks like a real permission-management
feature but is pure `useState` local component state — never persisted to
any entity, never read anywhere else, resets on every page load. It has no
connection to `PermissionOverride` (the actual, now-enforced override
mechanism) or to `guardedEntityWrite`. Same shape of finding as module 7's
danger-zone table below — a UI built but never wired to anything real. Not
fixed here (out of this fix's scope, which was specifically the documented
`PermissionOverride`/`SchoolSubscription` gap); flagged for whoever next
touches `PermisosRoles.jsx`.

**Verification performed:** `npm run lint`, `npm run typecheck`,
`npm run build`, `npm run test` (276/276), `npm run test:permissions`
(23/23), and `npm run validate:rls` (32 entities) all pass. `deno` isn't
available in this sandbox (same limitation as every other Deno function in
this app) — `guardedEntityWrite` gets its first live check in this PR's CI,
and the ChargeItem/PARENT/EVENTO carve-out specifically is unverified
against a live restricted user. Risk is bounded: every migrated call site
preserves identical behavior for anyone whose role/override combination
already granted access (i.e. every admin, every teacher writing their own
entities, and the one parent event-payment path) — the only behavior change
is that a user an admin explicitly denied, or a school in a read-only
billing state, now correctly gets rejected server-side instead of the write
silently succeeding.

## Module 7 (danger zone) — found aspirational, not wired to any action

`PermisosRoles.jsx` renders a "Danger Zone" table (`DELETE_TENANT`,
`SUSPEND_TENANT`, `RESET_TENANT_DATA`, `TRANSFER_TENANT_OWNERSHIP` from
`src/lib/authorization/tenantDangerZone.js`) describing risk level,
confirmation requirements, and rollback policy for each operation — but it's
**read-only documentation**. The table has no action column, no buttons, no
click handlers. `tenantDangerZone.js` additionally exports
`evaluateDangerZoneRequest`/`buildDangerZoneAuditEvent`/
`isHighRiskOperation` — a maker-checker policy library — but **none of the
three are imported anywhere in `src/` or `base44/functions/`**. The whole
module was built (policy + spec table) but never connected to an executable
path: there is currently no way, through the UI, to actually delete/suspend/
reset/transfer a tenant.

**Why not built here:** these four operations are irreversible and
tenant-wide (a botched `RESET_TENANT_DATA` or `DELETE_TENANT` destroys a
school's data outright) — implementing them for real needs the same
maker-checker rigor `governRoleChange` already proved out for role changes
(second-ADMIN approval, `PendingChange` audit trail, self-approval
rejection) applied to four much higher-blast-radius operations, with no way
to verify against a live deploy from this environment. Building it rushed,
unverified, is a worse outcome than leaving the honest gap documented.
Tracked as a separate initiative alongside module 3 above.
