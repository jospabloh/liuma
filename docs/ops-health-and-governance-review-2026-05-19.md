# Operations Health + Governance Review (2026-05-19)

## Scope
This review covers four recurring controls requested for the production readiness loop:
1. Daily production health review (errors, latency, denials, AI failures).
2. Weekly tenant-isolation and role-boundary verification.
3. Weekly permission drift and maker-checker integrity verification.
4. Roadmap triage updates from support + incident learnings.

## 1) Daily production health review

### Errors + latency
- **Verification source:** automated observability alert coverage.
- `tests/unit/observability-alerts.test.js` passed, including:
  - owner-denied alert grouping (dedup keys: actor, route, tenant, reason).
  - tenant-creation sustained failure-rate detection (attempt threshold gate).
- Result: the code path for production-style error and latency-triggered alerting remains active and green.

### Authorization denials
- **Verification source:** route + policy tests and owner walkthrough tests.
- Denial scenarios still pass for wrong-role, cross-tenant, and parent/teacher scope violations.
- Result: denials remain explicit and structured (reason codes preserved for alerting).

### AI failures (Lumi safety)
- **Verification source:** `tests/unit/lumi-capabilities.test.js`.
- Denied AI capability requests return safe alternative guidance and enforce tenant scope.
- Result: AI deny/fallback safety behavior remains green.

## 2) Weekly tenant isolation + role boundary verification
- **Verification source:** unit + integration authorization stack.
- Confirmed pass conditions:
  - policy denies unknown entities by default.
  - parent scope restricted to linked students.
  - teacher scope restricted to assigned classrooms.
  - owner override blocked for cross-tenant access.
  - direct URL access denied for unauthorized roles.
- Result: tenant isolation and role boundaries are currently intact under automated coverage.

## 3) Weekly permission drift + maker-checker integrity
- **Verification source:** `test:permissions` plus danger-zone tests.
- Confirmed pass conditions:
  - deny-override precedence enforced.
  - owner override remains explicit and scoped.
  - high-risk operations require maker-checker constraints (no self-approval, same-tenant approval, required reasons).
- Result: no permission drift signal observed from the current regression suite.

## 4) Roadmap triage from support + incident learnings
Incident and support evidence reviewed:
- `docs/incident-tenant-creation-failure-2026-05-19.md`
- `docs/incident-owner-override-2026-05-18.md`
- `docs/incident-owner-access-tenant-creation-blocker-2026-05-18.md`

### Triage outcomes
1. **Keep P0 guardrails in release gate:** owner-denial alert and tenant-creation failure-rate alert tests stay mandatory.
2. **Promote blocker incident lifecycle update:** the blocker incident document still shows `Status: Open`; this conflicts with closed/fixed evidence in subsequent reports and should be reconciled in the next incident hygiene pass.
3. **Track operational hardening item:** enforce provisioning completeness check (`ACTIVE ADMIN UserProfile` + optional `is_super_admin`) as a non-bypassable pre-expansion gate.
4. **Retain deterministic onboarding error mapping:** preserve explicit mapping for `duplicate_tenant`, `validation_error`, and `invalid_school_code` to reduce unknown-error support load.

## Commands executed
1. `npm test -- tests/unit/observability-alerts.test.js tests/unit/role-boundary.test.js tests/unit/policy.test.js tests/unit/admin-safety.test.js tests/unit/route-access.test.js tests/unit/lumi-capabilities.test.js`
2. `npm run test:permissions`
3. `npm test -- tests/integration/authorization-stack.test.js tests/integration/owner-route-walkthrough.test.js`

All commands passed.
