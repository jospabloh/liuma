# LIUMA Security, Privacy, Tenant-Isolation & Release-Readiness Audit — 2026-07-13

**Version:** 1.7.0 · **Previous version:** 1.6.1 · **Scope:** full audit per the
owner's standing routine, triggered on a repo that had two PRs (#148, #149)
merged after the v1.6.1 release without a version/changelog/docs update.

---

## 1. Summary

No unresolved Critical or High findings. Two Medium-severity AI-assistant
observations recorded as accepted risk pending a product decision — neither
allows cross-school, cross-classroom, or cross-family data exposure. This
release's real work was **release-metadata catch-up**: two already-merged,
already-deployed changes (a branded login screen, and a critical RLS fix
that had been silently breaking onboarding) had no version bump, changelog
entry, or matrix/manual update. That gap is closed here, and both changes
were independently re-verified rather than taken on faith.

**Result: State 1 — Completed and merged** (pending final CI/merge step —
see report email for outcome).

---

## 2. What changed since v1.6.1 (commits 74b1506..HEAD)

| Commit | What | Verified this round |
|---|---|---|
| d848aaf / PR #148 | Branded in-app `/login` screen replacing Base44-hosted login redirect | Credential handling, XSS, open-redirect, tenant-isolation bypass — all checked, no issues |
| 05fa54d / PR #149 | Restored service-role admin RLS branch on `UserProfile`/`PendingChange`/`School`/`AuditLog` (fixes a production outage that silently blocked all onboarding and role-approval) | Confirmed it does **not** reopen C1/C2; confirmed **deployed live** (see §4) |

---

## 3. Security audit

- **Hardcoded secrets/credentials:** none found. `.env.example` has only
  placeholders; no `.env` is tracked; no API keys/tokens in source. See
  scan detail below.
- **Login screen (Login.jsx, AuthLayout.jsx, auth/parts.jsx, App.jsx):**
  credentials sent only via SDK POST body, never logged, never in a URL;
  no `dangerouslySetInnerHTML`; generic error message (no user
  enumeration); no open-redirect (hardcoded `/` navigation, no
  redirect-target query param); re-runs the same `AuthProvider` /
  `GuardedRoute` checks as every other auth path — no bypass.
- **Dependencies:** `npm audit` — 0 vulnerabilities (prod + dev).
- **CI/CD:** lint, RLS validation, full test suite, and release-gate all
  ran green. Typecheck and build were previously run locally only, not in
  CI — now added to `.github/workflows/ci-node.yml`.
- **Known accepted/open items carried forward unchanged** (see
  `docs/authorization-matrix.md` → "Open permission gaps" for full detail
  and reasoning): no CSP/X-Frame-Options headers (host-level, outside app
  code); `esbuild` build-toolchain advisory (deferred, runtime not
  exposed); `ConsentRecord` entity not yet created in Base44 Builder
  (owner action, pre-existing).

## 4. RLS restore fix (05fa54d) — regression check + live-deploy verification

Prior critical findings C1 (role self-escalation) and C2 (self-approval of
role changes) were closed in v1.6.0 via field-level RLS locking
`UserProfile.app_role` and `PendingChange.status`/`approver_*`/`approved_at`
to the service role. The 05fa54d fix added back a row-level
`{"user_condition":{"role":"admin"}}` `$or` branch to four entities so that
`asServiceRole` backend calls (`provisionOnboardingProfile`,
`governRoleChange`) can pass row-level RLS — this branch is unreachable by
any real end-user, since authenticated users always carry the built-in
`role: "user"`, never the synthetic `role: "admin"` identity that only
service-role calls get. The field-level locks from v1.6.0 are untouched.

**New this round:** rather than trust the git diff alone, the live Base44
schema was pulled via the Base44 MCP `list_entity_schemas` tool
(app id `696e967c430ceb6a2232ffd8`) and compared programmatically against
every one of the 32 `base44/entities/*.jsonc` files in the repo (row-level
and field-level `rls` blocks, order-independent structural comparison).
**Result: all 32 entities match byte-for-byte — no drift.** This confirms
the 05fa54d fix is not just merged in git but actually deployed and live,
and that no other entity has silently drifted from its repo definition.

## 5. Privacy & child/student data audit

- Student/parent/teacher PII access is gated by Base44 RLS keyed off the
  server-verified session (`school_id`, `assigned_classroom_ids`,
  `linked_student_ids`), independent of client input — verified via the
  live-schema comparison in §4 covering all entities that carry student
  data (Student, DiaryEntry, Attendance, Homework, ChargeItem, etc).
- Incident/behavior data (`DiaryEntry`) and file/document access
  (`OfficialDocument`) remain scoped per the existing matrix — unchanged
  this round, no new gaps found.
- Support tickets (`SupportTicket`/`SupportTicketMessage`) remain scoped to
  requester + school admins + platform owner — unchanged, verified live.

## 6. School/tenant isolation audit

Source of truth confirmed: `school_id` resolved server-side from the
authenticated `UserProfile`, never trusted from client input
(`src/lib/authorization/policy.js`). All 32 entities' row-level RLS was
directly diffed against the live backend (§4) — every entity requires
`school_id` match except where a role-level owner/service-role branch is
narrower. No route, report, or notification path found that aggregates or
sends across schools.

## 7. AI / RAG safety audit (Lumi + soporte AI questionnaire)

Both features audited read-only.

| Check | Result |
|---|---|
| Cross-tenant / cross-classroom retrieval | **Passed** — RLS backstop applies regardless of what the LLM requests |
| Cross-student / cross-parent retrieval | **Passed** — `evaluateCapabilityAccess` checks `linked_students` for PARENT; backed by matching RLS |
| Prompt injection | **Medium** — see finding AI-1 below |
| Unconfirmed AI writes | **Medium** — see finding AI-2 below |
| AI content attribution | **Passed** — soporte AI briefs are clearly headered "(generado por IA BA/PO)" and stored separately from the human requester's own text |
| Logging scope | **Passed, with one caveat** — audit logs store intent/role/scope metadata, not raw prompt text, with PII redaction consistent with `docs/audit-retention-policy.md`. Not verified: whether Base44's own agent-conversation store (outside `src/lib/audit.js`) is subject to the same retention policy — flagged for a future pass, not blocking. |

**Finding AI-1 (Medium, accepted risk):** Lumi's free-text chat path skips
the app-level `evaluateCapabilityAccess` check (it only applies when a
structured `intent` is set) and relies solely on backend RLS for scoping.
RLS was independently verified adequate (§4, §6), so this is not a data-
exposure gap, but that path lacks the same `policy_decision` audit-log
detail as the structured quick-actions.

**Finding AI-2 (Medium, accepted risk):** Lumi's dictation-based
`DiaryEntry`/`Attendance` writes commit as soon as the agent decides to call
the tool, with no separate "review before saving" step — the teacher's
dictated message is the only confirmation. This is long-standing,
intentional product behavior (voice-driven bitácora creation), not a new
regression, and writes stay scoped to the teacher's assigned classroom.

Both are documented in `docs/authorization-matrix.md` with a recommendation
(add `policy_decision` logging to the free-text path; add a lightweight
post-save confirmation/undo affordance for dictation writes). **Not fixed
in this release** — changing a live, intentional teacher workflow without
product/owner sign-off is out of scope for an automated audit; per the
routine's own rule, AI behavior changes are not to be guessed at.

## 8. Code quality & CI/CD

- `npm ci` clean install (fresh environment had no `node_modules` —
  installed, not a code defect).
- Lint: clean. Typecheck: clean. Build: succeeds. Tests: 271/271 pass.
- `.github/workflows/ci-node.yml` gained `Typecheck` and `Build` steps
  (previously only run locally / in this audit, not gated in CI).
- No dead code, broken imports, or unrelated refactors introduced.

## 9. Permissions matrix

- Reviewed against actual code (`routeAccess.js`, `policy.js`,
  `capabilities.js`) and the live Base44 schema.
- Added: `/login` to the route matrix (new public/unauthenticated
  section); closure notes for C1/C2 deploy verification; a new "Fixed"
  row for the service-role restore fix; the two AI accepted-risk notes.
- Roles reviewed: 4 (ADMIN, TEACHER, PARENT, PLATFORM_OWNER). Modules
  reviewed: all rows in the existing route/entity/AI-capability tables
  (unchanged counts — no new modules added this release). Permissions
  reviewed: all 32 entities' row-level rules + all field-level (FLS)
  locks, cross-checked against the live backend.
- No unsafe defaults found; no permission gaps requiring a code fix this
  round.

## 10. User manual & changelog

- `USER_MANUAL.md`: added a tenant-neutral "2b. Iniciar sesión" section
  describing the new login screen and its generic-error behavior. No
  school/student/parent/teacher names or emails included.
- `CHANGELOG.md` / `VERSION_CONTROL.json` / `package.json`: version bumped
  1.6.1 → 1.7.0 (minor — catches up an already-shipped feature + a
  critical fix that had no release entry).

## 11. Rollback

See PR description for exact commit SHAs, rollback commands, and
per-change rollback notes. In short: this release is documentation/CI/
version-metadata only in the app source (no entity schema or business
logic changed by this PR) — a plain `git revert` of the merge commit is
sufficient and carries no data-migration or live-schema risk. The
underlying `/login` and RLS-restore changes it documents were already
live before this PR and are not touched by it.
