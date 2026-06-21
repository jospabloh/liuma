# Security Audit — Authorization & Access Control

**Date:** 2026-06-21 · **Scope:** `src/lib/authorization/*`, `src/components/GuardedRoute.jsx`,
license/feature gating, and base44 RLS in `base44/entities/*.jsonc`.

> **Status of this document:** findings + recommended remediation. The
> **Critical** items below are changes to multi-tenant access control over
> minors' data. They MUST be implemented deliberately and verified against a
> staging tenant before reaching production — they are intentionally **not**
> applied as part of the change set that ships this document. The only code
> change shipped alongside this audit is the low-risk `AuditLog.action` enum
> fix (see H1) plus documentation corrections (M1).

---

## Architecture context (frames every finding)

Liuma is a **client-side base44 SDK app** — there is no application server.
`src/api/base44Client.js` creates the client with `requiresAuth: false`, and
every page calls `base44.entities.*` directly from the browser. Therefore
**all** checks in `policy.js`, `routeAccess.js`, `GuardedRoute.jsx`,
`overrides.js`, `adminSafety.js`, `useCanWrite`, `useFeatureGate`, and the
`PermisosRoles` maker-checker flow are **UI-only and trivially bypassable** by
calling the entity API from devtools.

**The only real enforcement boundary is base44 RLS** in
`base44/entities/*.jsonc`. Findings are ranked by whether RLS actually backs
the client-side check.

---

## Critical — server-side (RLS) privilege escalation

### C1 · A single admin can self-elevate any profile to ADMIN
**`base44/entities/UserProfile.jsonc` (update RLS) · `src/pages/PermisosRoles.jsx`**
The two-admin maker-checker for role changes lives only in the UI. UserProfile
`update` RLS lets **any** ACTIVE ADMIN in the school update **any** profile with
no field-level restriction on `app_role`. A rogue/compromised admin can call
`base44.entities.UserProfile.update(id, { app_role: 'ADMIN' })` directly,
bypassing `PendingChange`, the second-admin approval, and the
`isSelfAdminDemotion` / `isLastManagePermissionsAdminAtRisk` guards.
**Fix:** move the role mutation behind a base44 backend function that validates
an approved `PendingChange`, or add RLS forbidding `app_role` elevation via
direct update. **Caveat:** the current apply step itself uses
`UserProfile.update`, so a naive RLS lock breaks the legitimate flow — this
needs a backend function, not just a deny rule.

### C2 · The requester can approve their own PendingChange
**`base44/entities/PendingChange.jsonc` (update RLS)**
`update` RLS checks only `school_id` + `app_role == ADMIN`. The "approver ≠
requester" rule is client-only. The requesting admin can update their own
PendingChange to `APPROVED`, defeating the maker-checker.
**Fix:** RLS must enforce `approver_profile_id != requester_profile_id`, or gate
the apply step behind a backend function.

### C3 · `is_super_admin` is a free, self-grantable field → cross-tenant bypass
**`UserProfile.jsonc` (field undeclared) · `policy.js`, `support/owner.js`,
`SchoolSubscription.jsonc`**
`is_super_admin` is the root of platform-owner authority (owner route override,
paywall bypass, read-only write-guard bypass, and **cross-tenant**
SchoolSubscription read/update/delete). It is not declared in the UserProfile
schema and not restricted by RLS. Because of C1 (admins can write arbitrary
profile fields), an admin can set `is_super_admin: true` on their own profile
and become a platform owner across tenants.
**Fix:** declare `is_super_admin` in the schema and make it immutable for tenant
admins (settable only by the base44 platform role / backend). Audit existing
profiles for the flag.

### C4 · Any school admin can self-activate their subscription *(FIXED)*
> **Resolved**: `SchoolSubscription` `update`/`delete` RLS is now owner-only
> (`role: admin`); tenant admins keep read-only access. The only field a tenant
> admin used to write there — `welcome_message_shown` — moved to the
> self-writable `UserProfile`, so the welcome modal still works. Guarded by
> `tests/unit/rls-subscription-owner-only.test.js`. Verify on staging that the
> owner can still manage licenses and that a tenant admin cannot.

**`SchoolSubscription.jsonc` (update RLS)**
`update` RLS allows any ADMIN whose `school_id` matches. The license model backs
the read-only write-guard and the paywall, so an admin in
`view_only`/`suspended` can call
`SchoolSubscription.update(id, { subscription_status: 'active', license_tier: 'plus', ... })`
to unlock all writes and premium tiers for free.
**Fix:** restrict status/tier/expiry/payment writes to the platform owner /
backend; tenant admins get read-only access to their own subscription.

---

## High

### H1 · AuditLog action enum omitted security actions *(FIXED in this change set)*
**`base44/entities/AuditLog.jsonc`**
The `action` enum listed only 12 operational actions, but the code writes ~20
more — including the security-critical `PERMISSION_CHANGE`, `POLICY_DECISION`,
`owner_override`, `access_denied`, and the `ROLE_CHANGE*` family. If base44
enforces the enum, those audit writes fail silently and the security trail is
empty. **The enum has been expanded** to cover every action string emitted by
`src/lib/audit.js`, `GuardedRoute.jsx`, and `PermisosRoles.jsx`; regression test
`tests/unit/audit-action-enum.test.js` guards against future drift.
**Remaining (not yet done):** AuditLog `create` does not pin `actor`/`user_id`
to `{{user.id}}`, so entries can be forged. Pin them in RLS, ideally writing
permission/role events from a backend function.

### H2 · Owner override trusts the user's own profile flag
**`GuardedRoute.jsx` · `policy.js` (`getOwnerScopedAccess`)**
Owner route access is granted from the user's *own* `is_super_admin` flag. The
route guard is advisory, but combined with C3 (self-grantable flag) it is a real
escalation to ADMIN-only routes like `LicenseAdmin` / `PanelSoporte`.
**Fix:** depends on C3; once `is_super_admin` is immutable this collapses to
defense-in-depth.

### H3 · Parents can create event charges with arbitrary amount/status
**`ChargeItem.jsonc` (create RLS)**
PARENT may create `EVENTO` ChargeItems for linked students, but RLS can't
constrain `amount`/`status`, so a parent can create a charge with `amount: 0` or
`status: 'PAID'`.
**Fix:** move event-charge creation to a backend function that derives
`amount`/`status` from the Event, or add RLS forbidding parent-set `status: PAID`.

---

## Medium — correctness / doc-code drift

### M1 · Paywall master-switch default was mis-documented *(FIXED in this change set)*
`featureGates.js` sets `PAYWALL_GATING_ENABLED = ... !== 'false'` → **ON by
default**, but `useFeatureGate.js` JSDoc said `!== 'true'` (off) and older prose
implied off. The docs have been corrected to match the code. **Open question for
the owner:** confirm whether ON-by-default is the *intended* billing behavior;
if not, the fix is a one-line code change to the default, which is a billing
decision and was deliberately left untouched.

### M2 · Override system advertises resources/actions it never enforces
**`authorization-matrix.md` vs `policy.js` (`getEffectivePolicyDecision`) ·
`PermisosRoles.jsx` · `PermissionOverride.jsonc`**
The override UI/schema accept free-text `resource`/`action` (Students, Reports,
`manage_permissions`, `approve`, `export`, …), but the policy engine only
evaluates a fixed set of entities and `read`/`write`. Overrides outside that set
are silently ignored — admins believe they granted/denied access that has zero
effect. The whole override system is also advisory (no RLS reads
PermissionOverride).
**Fix:** restrict the schema/UI to enforceable resources+actions, or wire
overrides into RLS/backend; document the system as UI-only until then.

### M3 · `manage_permissions` self-guard is dead code
**`overrides.js`** — fires only for `action === 'manage_permissions'`, which the
UI never emits and the policy engine never evaluates. Remove or make real.

### M4 · Permission-change audit confidentiality is client-only
**`AuditoriaAdmin.jsx` / `audit.js` vs `AuditLog.jsonc` (read RLS)** — the
per-admin masking is applied over already-fetched rows; RLS lets any admin read
all rows. Enforce in RLS or drop the misleading client gate.

### M5 · RLS depends on undeclared UserProfile fields
**`UserProfile.jsonc` vs `Student/DiaryEntry/ChargeItem/...` RLS** — parent/teacher
row scoping uses `{{user.data.linked_student_ids}}` /
`{{user.data.assigned_classroom_ids}}`, which are not declared/managed in the
schema (links live in `ParentStudent`/`TeacherClassroom`). Stale/unset arrays
risk silent over- or under-return at the only real enforcement layer.
**Fix:** declare and keep these denormalized arrays in sync, or change RLS to
reference the join entities.

---

## Low / defense-in-depth

- **L1** `getOwnerScopedAccess` retains a legacy client-`ownerEmail`/`ownerUserId`
  branch (`policy.js`); dead today, remove to prevent future bundle leakage.
- **L2** `filterByRowLevel` teacher branch is fail-open on a null `classroom_id`
  (`policy.js`) — wrong default for a security filter (client-only).
- **L3** `normalizeSubscription` grandfathers a missing status to `trial`
  (`licenseModel.js`) — "missing = privileged" default-allow gap.
- **L4** `AuditLog.create` excludes PARENT yet parent flows call
  `logAuditEvent` (e.g. SupportTicket) → audit gaps for parent actions.

---

## Remediation priority (highest value, lowest risk first)

1. **Lock down `is_super_admin` (C3)** — declare + make immutable for tenant
   admins. Single change that closes the cross-tenant subscription bypass and the
   owner-route/paywall/write-guard escalations at once.
2. **Restrict `SchoolSubscription` writes to the platform owner (C4).**
3. **Forbid `app_role` self-elevation (C1)** — via backend-validated apply.
4. **Pin AuditLog `actor`/`user_id` in RLS (H1 remainder).**
5. **Trim or wire up the override matrix (M2)** and confirm the paywall default
   (M1).

**Bottom line:** the client-side authorization layer is elaborate and internally
consistent, but it is *advisory*. Real security rests entirely on base44 RLS,
which currently lets a school admin self-grant ADMIN and the platform-owner flag,
self-activate their subscription, and self-approve privileged changes. Items 1–3
are the ones that matter.
