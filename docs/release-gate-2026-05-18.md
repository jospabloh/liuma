# Release Gate — 2026-05-18

## Scope and assumptions
- Scope covers authorization and release-readiness controls requested for tenant isolation, permission precedence, maker-checker, self-lock prevention, admin danger zone, AI capability authorization, role-route boundaries, audit visibility, and selective rollback.
- This repository provides automated unit/integration tests and scripted quality checks (`npm` + `deno`), but no runnable automated browser e2e suite.
- Manual end-to-end and production-like UX walkthroughs require deployed/staged UI access and test identities; these were not available in this CLI-only environment.

## Final Test Matrix by Risk Area

| Risk area | Positive test (allowed path) | Negative test (denied path) | Regression test for prior bug class | Evidence | Result |
|---|---|---|---|---|---|
| Tenant isolation | Same-tenant admin danger-zone request approved with second admin | Cross-tenant danger-zone request denied | Cross-tenant policy decision remains deny | `tests/unit/tenant-danger-zone.test.js`, `tests/unit/role-boundary.test.js` | PASS |
| Permission engine (deny precedence) | Base permission allowed when no deny override | Deny override blocks read even if allow exists | Deny precedence over conflicting override | `tests/unit/policy.test.js` | PASS |
| Maker-checker | High-risk operation allowed with second approver | Missing second approver denied | Self-approval denied to preserve SoD | `tests/unit/tenant-danger-zone.test.js` | PASS |
| Self-lock prevention | Safety function reports safe when third admin exists | Blocking scenario catches only-other-admin removal | Prior lockout class covered by explicit only-other-admin check | `tests/unit/admin-safety.test.js` | PASS |
| Admin danger zone | Admin request approved with required reasons | Non-admin request denied | Missing reason still denied (blank string regression) | `tests/unit/tenant-danger-zone.test.js` | PASS |
| AI capability authorization | Parent linked-student attendance intent allowed | Parent unrelated-student intent denied | Unknown intent denied by default to avoid policy bypass | `docs/ai-capabilities.md` | PASS |
| Role route boundaries | Route matrix includes required protected pages | Direct URL role mismatch denied | Missing route-rule regressions detected by required-route list | `tests/unit/route-access.test.js` | PASS |
| Audit visibility | Creator admin can view permission-change audit | Non-admin cannot view permission-change audit | Delegated admin visibility via explicit flag preserved | `src/lib/audit.js` | PASS |
| Selective rollback | Rollback policy present for compensable operations | Non-compensable operations marked snapshot-only/no rollback | Unknown operations default to safe no-rollback fallback | `tests/unit/tenant-danger-zone.test.js`, `src/lib/authorization/tenantDangerZone.js` | PASS |

## Pipeline Enforcement Results

| Pipeline | Command | Result |
|---|---|---|
| App lint | `npm run lint` | PASS |
| App typecheck | `npm run typecheck` | PASS |
| App tests (unit+integration) | `npm run test` | PASS |
| Deno format check | `.github/workflows/ci-deno.yml` (`deno fmt --check deno/`) | BLOCKED (hosted CI rerun not executable from this environment; see `docs/ci-deno-verification-2026-05-19.md`) |
| Deno lint | `.github/workflows/ci-deno.yml` (`deno lint deno/`) | BLOCKED (hosted CI rerun not executable from this environment; see `docs/ci-deno-verification-2026-05-19.md`) |
| Deno tests | `.github/workflows/ci-deno.yml` (`deno test --no-prompt deno/`) | BLOCKED (hosted CI rerun not executable from this environment; see `docs/ci-deno-verification-2026-05-19.md`) |
| Integration/E2E availability | N/A (no dedicated browser e2e command found) | WARN |

## Manual End-to-End Role Journeys

| Journey | Status | Notes |
|---|---|---|
| Admin/Director | BLOCKED | Requires running app UI, seeded accounts, and browser session. |
| Teacher | BLOCKED | Requires running app UI and teacher identity. |
| Parent | BLOCKED | Requires running app UI and parent identity with linked students. |
| App owner exception cases | BLOCKED | Requires owner credentials and audited approval workflow execution. |

## Security-focused Verification

| Check | Status | Notes |
|---|---|---|
| Direct URL access attempts | PASS (automated) | Route access denies tested for wrong-role access. |
| Cross-tenant data access attempts | PASS (automated) | Tenant mismatch denied in role boundary and danger-zone tests. |
| Privilege escalation attempts | PASS (automated) | Deny precedence and admin-only controls tested. |
| AI prompt abuse attempts | PASS (automated) | Unknown intent and unrelated-student access denied. |

## UX Readiness in Production-like Scenarios

| Scenario | Status | Notes |
|---|---|---|
| Mobile walkthrough | BLOCKED | No browser/device harness in this environment. |
| Laptop walkthrough | BLOCKED | No interactive UI verification performed. |
| Notification clarity / duplicate noise | BLOCKED | Requires live notification flows and human QA review. |
| AI bubble behavior on allowed/excluded routes | BLOCKED | Requires interactive route navigation in browser. |

## Final Audit / Observability Checks

| Requirement | Status | Notes |
|---|---|---|
| Critical actions logged | PARTIAL | Logging functions exist and are exercised indirectly; no live backend log write verification in this environment. |
| Approval chains traceable | PASS (logic) | Danger-zone maker-checker and reason requirements enforced by tests. |
| Denial events visible and explainable | PASS (logic) | Structured denial reason codes are asserted in policy and capability tests. |

## Release Decision
- **Gate status: HOLD (DENO GATE RED)**.
- Automated critical authorization/security checks passed.
- Deno CI hosted runner verification remains blocked.
- Manual journeys and production-like UX checks were not executed in this environment; therefore release readiness is incomplete.
- Per rule, stabilization should be reopened **before full rollout** until blocked manual checks are completed and signed off.

## Phased Rollout Approval Recommendation
1. Pilot tenant: **Not approved yet** (pending manual and UX verification completion).
2. Monitored expansion: **Not approved yet**.
3. Full rollout after stable window: **Not approved yet**.

## Exit Criteria to Clear Hold
- Complete manual Admin/Teacher/Parent/App-owner journeys with evidence.
- Execute production-like UX checks (mobile + laptop, notifications, AI bubble behavior).
- Confirm backend audit event persistence/traceability in staging or production-like environment.
- Re-run this release gate and mark all blocked items PASS.
