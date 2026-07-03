# Role-change governance remediation (findings C1 / C2)

**Date:** 2026-07-03 · **Version:** 1.5.0 · **Scope:** `UserProfile.app_role` maker-checker

This document is the authoritative record for the two open critical findings from the
2026-07-02 audit (PR #141), including a correction to how C1 was originally described,
the fix shipped in 1.5.0, and the follow-up that the owner must review and deploy to
fully close the raw-SDK bypass.

---

## 1. Findings (as verified in code + the live deployed schema)

The repo `base44/entities/*.jsonc` and the **deployed** Base44 schema were confirmed
identical on 2026-07-03 (`list_entity_schemas` for `UserProfile` + `PendingChange`).
Neither entity uses per-field RLS; enforcement is row-level only.

### C1 — Privilege escalation to ADMIN (broader than originally reported)

`UserProfile.update` RLS:

```jsonc
"update": {
  "$and": [
    { "data.school_id": "{{user.data.school_id}}" },
    { "$or": [
      { "data.user_id": "{{user.id}}" },                 // self branch
      { "user_condition": { "data.app_role": "ADMIN" } } // any admin in the school
    ] }
  ]
}
```

Base44 RLS gates **which rows** a caller may update, not **which fields**. So:

- The **self branch** lets *any* authenticated user update *their own* profile row —
  including `app_role`. A `PARENT` or `TEACHER` can call
  `UserProfile.update(myProfileId, { app_role: 'ADMIN' })` via the raw SDK and become an
  admin of their school. **This is broader than the audit's C1**, which described only
  an admin elevating another profile.
- The **admin branch** lets any admin set `app_role: 'ADMIN'` on any profile in the
  school, bypassing the maker-checker (which only existed in the UI).

The `PermisosRoles` UI routed non-self changes through a `PendingChange` and applied
self-changes instantly, but none of that is a security boundary — the SDK is reachable
outside the UI.

### C2 — Self-approval of a `PendingChange`

`PendingChange.update` RLS grants every admin in the school write access. The
"approver ≠ requester" rule was enforced only in
`PermisosRoles.handlePendingRoleChangeDecision`. A requester (who is an admin) could
call `PendingChange.update(id, { status: 'APPROVED', approver_* : self })` and then
apply the role change themselves.

The audit suggested an RLS field check
`approver_profile_id != requester_profile_id`. **That is not expressible in Base44
RLS** — templates only resolve `{{user.*}}`; there is no way to compare two fields of
the same entity to each other. C2 therefore genuinely requires a backend function (or
a per-field lock forcing approvals through one).

---

## 2. What shipped in 1.5.0 (this PR)

The sanctioned, server-authoritative path.

- **`base44/functions/governRoleChange/entry.ts`** — runs with the caller's token to
  establish identity, re-reads state with the service role, and enforces:
  - caller holds an **ACTIVE ADMIN** profile; its school is the only tenant it may act on;
  - `request`: valid role, actual change, last-admin protection, no duplicate open
    request → creates the `PendingChange` (never applies directly);
  - `decide`: **approver ≠ requester** (checked on both `profile_id` and `user_id`),
    change is still open, same school, last-admin protection on admin-demotions →
    stamps the approver and, on approve, applies `app_role` with the service role.
- **`src/lib/authorization/roleGovernance.js`** — the same predicates as pure,
  framework-agnostic functions, used by the client for pre-submit UX and unit-tested in
  `tests/unit/role-governance.test.js` (17 cases). The function contains a mirrored copy
  because the trust boundary must not depend on client code.
- **`PermisosRoles.jsx`** — every role request and approval/rejection now goes through
  `governRoleChange`. The client no longer writes `app_role` or `PendingChange`
  approvals directly. Self role-changes are no longer instant.

**Effect:** the UI-reachable maker-checker is now enforced server-side. A user driving
the app can no longer self-approve or skip the second-admin step.

**Not yet closed by this PR:** the *raw-SDK* bypass in §1 (direct `UserProfile.update`
of `app_role`; direct `PendingChange.update`). Closing it requires the per-field RLS
lock in §3, which is deliberately staged rather than blind-deployed.

---

## 3. Follow-up the owner must review and deploy (staged)

### 3a. Deploy `governRoleChange` — **before merging this PR**

Base44 functions do **not** auto-deploy from GitHub. The wired UI depends on the
function, so deploy it first (from a machine with Base44 network access):

```bash
git pull origin <this-branch>
npx base44 functions deploy --app-id 696e967c430ceb6a2232ffd8 --force
npx base44 functions list  --app-id 696e967c430ceb6a2232ffd8   # expect governRoleChange present
```

### 3b. Per-field RLS lock on `app_role` (closes the C1 raw bypass)

Lock the `app_role` **field** to the service role so only `governRoleChange` can write
it, while leaving the entity-level `update` rule intact (admins still need it to write
`status` — user activation in `Aprobaciones.jsx` — and users still self-write
`welcome_message_shown`, `onboarding_completed`, etc.). Illustrative shape:

```jsonc
// UserProfile.app_role property
"app_role": {
  "type": "string",
  "enum": ["ADMIN", "TEACHER", "PARENT"],
  "default": "PARENT",
  "rls": {
    "write": { "user_condition": { "role": "admin" } }  // service role only
  }
}
```

> Verify the exact per-field RLS syntax and the built-in `role` mapping against the live
> backend before deploying. In LIUMA the *app* role lives in `data.app_role`; the
> built-in `role` is what `asServiceRole` evaluates as (`admin`). Confirm that a regular
> app-ADMIN does **not** carry built-in `role: admin`, or the lock will not actually
> exclude them.

**Blast-radius dependency:** onboarding self-writes `app_role`
(`src/lib/onboardingTenantCreation.js → upsertUserProfile`). Locking the field breaks
first-run onboarding unless the initial role assignment is first rerouted through a
service-role function (e.g. an `assignInitialRole` action that only lets a user set
their own role when they have no existing ACTIVE profile). **Do 3b and the onboarding
reroute together, and verify against the live backend** — do not deploy the lock alone.

### 3c. Per-field lock on `PendingChange` approval fields (defense-in-depth for C2)

Lock `status`, `approver_profile_id`, `approver_user_id`, `approved_at` to the service
role so approvals can only be written by `governRoleChange`. Leave `create` admin-open
so requests still work. This is optional once 3b is in place (a locked `app_role` means
a forged approval can no longer apply a role), but it keeps the audit trail honest.

---

## 4. Why staged rather than blind-deployed

LIUMA is a live multi-tenant app (real schools, parents, students). The portfolio's own
notes document multiple outages caused by narrowing live RLS rules without end-to-end
verification. The §3 changes put **onboarding** and **user activation** in the blast
radius and cannot be exercised end-to-end from this environment. Shipping the additive,
fully-tested server function now — and handing over the exact schema + deploy steps for
the RLS lock — closes the UI-reachable hole immediately while keeping the higher-risk
change under owner review, matching this codebase's "repo change + separate,
verified deploy" discipline.

---

## 5. Verification performed for 1.5.0

- `npm run lint` — clean
- `npm run validate:rls` — 31 entities OK
- `npm test` — 263/263 pass (was 246; +17 new governance cases)
- `npm run release:gate` — 23/23 pass
- `npm run build` — succeeds
- Deployed `UserProfile` + `PendingChange` schema confirmed identical to repo
