# Operations Health + Governance Review (2026-05-19)

## Scope
This review defines the recurring production governance cadence for:
1. Daily production health review (errors, performance, denials, Lumi failures).
2. Weekly tenant-isolation, permission drift, and maker-checker/audit integrity review.
3. Biweekly UX review (mobile/laptop parity, notification clarity, tenant theming).
4. Mandatory blocker/high incident handling with postmortem + regression test.

## 1) Daily production health review

### Cadence
- **Frequency:** every day (business day start + end-of-day checkpoint).
- **Owner:** on-call admin/ops.
- **Required checks:**
  1. Error signal health.
  2. Performance degradation signal health.
  3. Authorization denial signal health.
  4. Lumi failure/fallback signal health.

### Verification evidence
- **Errors + performance**
  - Source: `tests/unit/observability-alerts.test.js`.
  - Coverage includes sustained failure-rate alerting and deduplicated incident grouping.
- **Denials**
  - Source: `tests/unit/route-access.test.js`, `tests/unit/policy.test.js`, `tests/unit/role-boundary.test.js`.
  - Coverage includes wrong-role, cross-tenant, and scope violations.
- **Lumi failures**
  - Source: `tests/unit/lumi-capabilities.test.js`.
  - Coverage includes safe deny/fallback behavior and tenant-scoped enforcement.

## 2) Weekly governance review

### Cadence
- **Frequency:** once per week.
- **Owner:** security/governance reviewer.

### Required checks
1. **Tenant isolation**
   - Source: `tests/integration/authorization-stack.test.js`, `tests/integration/owner-route-walkthrough.test.js`.
2. **Permission drift**
   - Source: `npm run test:permissions` and `tests/unit/admin-safety.test.js`.
3. **Maker-checker + audit integrity**
   - Source: `tests/unit/admin-safety.test.js`, `tests/unit/tenant-danger-zone.test.js`, and audit policy documentation.

### Weekly expected outcome
- Any regression in tenant boundaries, permission precedence, or maker-checker constraints is treated as a release-gating issue.

## 3) Biweekly UX review

### Cadence
- **Frequency:** every two weeks.
- **Owner:** product + QA.

### Required checks
1. **Mobile/laptop parity**
   - Source: `docs/ui-quality-baseline.md` and manual walkthrough script.
2. **Notification clarity**
   - Source: `src/lib/notifications/templates.js` plus UX validation notes.
3. **Tenant-specific theming**
   - Source: `src/lib/tenantTheme.js`, `src/components/theme/TenantThemeRuntime.jsx`, `tests/unit/tenant-theme.test.js`.

### Biweekly expected outcome
- UX findings are logged with severity and owners; any high-impact UX regression is added to release gate follow-up.

## 4) Incident policy (blocker/high)

### Mandatory rule
For every incident with severity **blocker** or **high**:
1. A written postmortem is mandatory.
2. A regression test is mandatory before closure.
3. Incident cannot be marked closed until both artifacts are linked.

### Evidence pattern
- Incident docs under `docs/incident-*.md`.
- Regression tests added/updated in `tests/unit` or `tests/integration` based on incident scope.

## Commands executed
1. `npm test -- tests/unit/observability-alerts.test.js tests/unit/route-access.test.js tests/unit/policy.test.js tests/unit/role-boundary.test.js tests/unit/lumi-capabilities.test.js tests/unit/admin-safety.test.js tests/unit/tenant-theme.test.js tests/unit/tenant-danger-zone.test.js`
2. `npm run test:permissions`
3. `npm test -- tests/integration/authorization-stack.test.js tests/integration/owner-route-walkthrough.test.js`

All commands passed.
