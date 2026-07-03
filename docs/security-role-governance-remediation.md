# Role-change governance remediation (findings C1 / C2)

**Date:** 2026-07-03 · **Versions:** 1.5.0 (server function) + 1.6.0 (field-level RLS + onboarding reroute) · **Scope:** `UserProfile.app_role` maker-checker

> **Status (v1.6.0):** C1 and C2 are now fully closed in the repo. The raw-SDK bypass is
> shut by field-level RLS; onboarding is rerouted so the lock doesn't break signup. This
> requires an **ordered** owner deploy (functions first, then schema) — see §3.

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

## 2b. What v1.6.0 adds (the raw-SDK closure)

- **Field-level RLS (FLS) on `UserProfile.app_role`** — `write` restricted to the service
  role (`{"user_condition":{"role":"admin"}}`). Base44 FLS gates the *field*, so the
  entity-level `update` rule stays intact: admins can still write `status` (activation in
  `Aprobaciones.jsx`) and users can still self-write `welcome_message_shown` /
  `onboarding_completed` — only `app_role` is locked. In LIUMA the app role lives in
  `data.app_role`; the built-in `role` is what `asServiceRole` evaluates as (`admin`), and
  tenant admins carry built-in `role: user`, so this excludes them from writing `app_role`
  while still allowing the service-role functions.
- **FLS on `PendingChange` approval fields** — `status`, `approver_profile_id`,
  `approver_user_id`, `approved_at` get `update` restricted to the service role, so an
  approval can only be written by `governRoleChange`.
- **`provisionOnboardingProfile`** backend function — onboarding self-wrote `app_role`,
  which the field lock now blocks, so the initial role assignment moves server-side. It
  provisions only the caller's own profile and enforces founder-only ADMIN (a school the
  caller created, with no other active admin); joiners land TEACHER/PARENT **PENDING** for
  admin approval. Existing profiles are never re-roled by onboarding. Shared rules:
  `src/lib/authorization/onboardingProvision.js` (unit-tested).

With 2 + 2b in place the raw bypass is closed: a client cannot set `app_role` (FLS) and
cannot forge an approval that applies a role (FLS + governance).

---

## 3. Ordered owner deploy — DO THIS IN ORDER

Base44 functions do **not** auto-deploy from GitHub, and deploying the FLS schema before
the functions exist will block onboarding and role changes. From a machine with Base44
network access:

### Step 1 — deploy the functions FIRST

```bash
git pull origin main
npx base44 functions deploy --app-id 696e967c430ceb6a2232ffd8 --force
npx base44 functions list  --app-id 696e967c430ceb6a2232ffd8
# expect: governRoleChange AND provisionOnboardingProfile present; total ≤ 50
```

### Step 2 — deploy the schema (FLS) SECOND

Deploy the updated `UserProfile` and `PendingChange` schemas (the field-level `rls`
blocks). Either `npx base44 entities push` (or `base44 deploy`), or the Base44 MCP
`update_entity_schema`. Because `update_entity_schema` removes omitted properties, send
the **full** property set for each entity (the repo `.jsonc` is the source of truth), and
remember it **preserves** entity-level and per-field `rls` only when omitted — here we are
intentionally changing per-field `rls`, so include it.

### Step 3 — verify end-to-end against the live backend

- Founder onboarding → becomes ACTIVE ADMIN of their new school.
- Joiner onboarding (TEACHER/PARENT) → lands PENDING; admin activates via Aprobaciones.
- Role request + second-admin approval → applies; self-approval is rejected.
- Direct SDK `UserProfile.update({app_role:'ADMIN'})` as a non-service user → rejected.

---

## 4. Why this was staged across two releases

LIUMA is a live multi-tenant app (real schools, parents, students). The portfolio's own
notes document multiple outages caused by narrowing live RLS rules without end-to-end
verification. v1.5.0 shipped the additive, fully-tested server function first (no
onboarding blast radius); v1.6.0 adds the field lock together with the onboarding reroute
that keeps signup working, and hands over a strict ordered deploy. This matches the
codebase's "repo change + separate, verified deploy" discipline — the field lock is never
live before the functions that make it survivable.

---

## 5. Verification

- `npm run lint` — clean
- `npm run validate:rls` — 31 entities OK (the guard parses field-level `rls` too)
- `npm test` — 271/271 pass (v1.5.0 added 17 governance cases; v1.6.0 added 8 onboarding-provision cases)
- `npm run release:gate` — 23/23 pass
- `npm run typecheck` — clean
- `npm run build` — succeeds
- Deployed `UserProfile` + `PendingChange` schema confirmed identical to repo before the FLS change
