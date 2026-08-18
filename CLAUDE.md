# Liuma — Project Notes

School management SaaS (Base44 backend + Vite/React front-end), multi-tenant via
`school_id` on every business entity. See `docs/authorization-matrix.md` and
`docs/security-role-governance-remediation.md`.

## Module 3 (server-side permission/billing enforcement) — investigated, deferred

A portfolio-standard audit (`jospabloh/acacia-app-standard`, module 3) flagged
"server-side enforcement of `PermissionOverride`/`SchoolSubscription.
subscription_status`" as a gap. Investigated in detail (2026-08-18) rather
than assumed:

- **`PermissionOverride` itself is already correctly gated.** Its RLS
  (`base44/entities/PermissionOverride.jsonc`) requires
  `data.app_role: ADMIN` + tenant match on all four ops — a TEACHER/PARENT
  cannot create, read, update, or delete an override via a direct SDK call.
  This part was **not** a gap.
- **The real gap: an override, once created, is never enforced.**
  `PermissionOverride` rows exist to grant/deny specific actions
  (`Notice`/`Attendance`/`Homework`/`DiaryEntry`/`ChargeItem`/
  `PaymentConcept`/`PaymentRecord`, per `PermisosRoles.jsx`'s override form)
  to specific users beyond their role defaults. `src/lib/authorization/
  overrides.js` evaluates them **client-side only** — nothing server-side
  reads a `PermissionOverride` row before allowing a write to the entity it's
  supposed to gate. A user an admin explicitly denied `Homework:create` for
  can still call `base44.entities.Homework.create()` directly and RLS lets
  it through (base `Homework` RLS grants TEACHER create by role, with no
  concept of a per-user override).
- **`SchoolSubscription.subscription_status` has the same shape of gap.**
  `PaymentReminderBanner.jsx`/`SuspendedAccountModal.jsx` read it to show a
  banner/lock the UI, but no entity's RLS checks it — Base44's RLS rule
  language has no join/lookup (a `Notice` row can't reference a field on a
  different `SchoolSubscription` row), so this can't be closed declaratively.

**Why not fixed here:** true enforcement of either needs a Safe-function
write-mediation layer (`asServiceRole` + explicit check before every write)
across the 7 override-able entities × create/update/delete, or a
`resolveTenant`-style approach (compute a `write_access`/override-aware flag
server-side, persist it onto `UserProfile`, then require it in RLS) — the
same pattern `jospabloh/rumbo`'s `resolveTenant/entry.ts` already uses for
its own license write-gate. Either path is a multi-entity initiative on that
same scale, and the RLS-narrowing half of it carries real outage risk if
done without a live deploy to verify against (see `jospabloh/stockflow`'s
`CLAUDE.md` for two real incidents from exactly this class of mistake).
`governRoleChange` (the one real Safe function this app has) is scoped
narrowly to `UserProfile.app_role` and doesn't cover any of this. Tracked
here rather than rushed, same as `jospabloh/rumbo`'s own deferred module 3.

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
