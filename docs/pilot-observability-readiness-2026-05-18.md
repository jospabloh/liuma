# Pilot Observability & Incident Readiness Plan

Date prepared: 2026-05-18

## 0) Assumptions (explicit)

1. We have a metrics stack that supports dashboards, logs, and alerts (for example: Datadog/Grafana + centralized logs).
2. We can tag every telemetry event with at least: `tenant_id`, `role`, `user_id` (hashed), `request_id`, `route`, and `environment`.
3. Pilot go-live is scheduled for 2026-06-01 and this plan must be fully verified before that date.
4. Alert routing integrates with PagerDuty (or equivalent) and Slack/email fallback.
5. Existing auth/policy/audit instrumentation from current production build remains enabled during pilot.

## 1) Pilot Monitoring Dashboards (must exist before go-live)

Create one dashboard folder: `Pilot 2026-06 - Operations` with these dashboards.

### A. App Errors & Crashes Dashboard
- Metrics:
  - Frontend uncaught exception rate (`errors/min`)
  - Crash-free session rate (`%`)
  - Top 10 error signatures by count
  - Error rate by role and tenant
- Views:
  - Last 15m, 1h, 24h
  - Breakdown by release version
- Alertable signals:
  - Spike in uncaught exceptions
  - Crash-free sessions below threshold

### B. API Failures Dashboard
- Metrics:
  - 5xx rate per service and per endpoint
  - 4xx rate for protected endpoints (excluding expected auth denials)
  - Timeout rate
  - Upstream dependency failure rate
- Views:
  - Global API health
  - Critical endpoint panel (`/auth/*`, `/approvals/*`, `/payments/*`, `/attendance/*`)
- Alertable signals:
  - Sustained 5xx burst
  - Timeout surge on critical endpoints

### C. Latency Dashboard (Global + Critical Endpoints)
- Metrics:
  - p50/p95/p99 response latency globally
  - p95 latency per critical endpoint
  - DB/query latency for critical paths
- Critical endpoints in scope:
  - Login/session refresh
  - Role/permission checks
  - Maker-checker approval submit/approve
  - Danger-zone action validation + submit
  - Lumi interaction request/response
- Alertable signals:
  - p95 or p99 degradation above threshold windows

### D. Auth/Permission Denials Dashboard
- Metrics:
  - Auth failures (invalid/expired token)
  - Permission denied rate by route/action and role
  - Sudden denial spikes by tenant
- Distinguish expected vs unexpected denials:
  - Expected: blocked actions outside role permissions
  - Unexpected: denial on allowed path per authorization matrix
- Alertable signals:
  - Unexpected denial ratio increase

### E. AI Capability Failures/Denials Dashboard
- Metrics:
  - Lumi request failure rate (transport, timeout, provider error)
  - Capability denial rate by reason (`policy_denied`, `missing_context`, `unsafe_action`, etc.)
  - AI fallback success rate (did user recover via non-AI path)
- Alertable signals:
  - Capability-denied spike for previously healthy flows
  - Lumi failure rate crossing high threshold

## 2) Security-Specific Monitors

### A. Cross-tenant Access Attempts
- Detect requests where actor tenant != target resource tenant.
- Track fields: actor role, endpoint, tenant pair, request_id.
- Alert immediately on any confirmed cross-tenant access attempt.

### B. Role Escalation Attempts
- Detect attempts to grant/assume higher privilege than caller policy allows.
- Include both UI action attempts and API direct calls.
- Alert on burst patterns and any successful escalation.

### C. Failed Maker-Checker Approvals
- Monitor failed approval transitions due to policy/state mismatch.
- Flag repeated failures by same actor and same entity.
- Alert when failures exceed threshold window (possible misuse or workflow break).

### D. Danger-Zone Action Attempts/Failures
- Monitor high-risk actions (destructive edits, irreversible status changes, critical config edits).
- Split by: attempted, denied, failed execution, successful execution.
- Alert on unusual attempt volume or repeated denied attempts.

## 3) UX-Operational Monitors

### A. Key Journey Drop-off Rates
- Journeys:
  - Teacher attendance publish
  - Parent notice read/acknowledge
  - Admin payment review
  - Maker-checker approval flow
- Measure stage-to-stage completion and drop-off percentages.
- Alert if drop-off increases beyond baseline delta.

### B. Repeated Action Retries
- Detect repeated submit/retry clicks for same action key within short window.
- Track by journey, role, tenant, and endpoint.
- Alert when retry ratio exceeds threshold (likely UX friction or backend instability).

### C. Notification Failure Rates
- Track failure rate by channel (in-app, email, push if enabled).
- Separate provider failures vs template/render failures.
- Alert on sustained failure rate above medium/high thresholds.

### D. Lumi Interaction Failure Rates
- Track failed prompts, empty responses, policy denials, and user aborts.
- Break down by role and workflow context.
- Alert on degradation affecting key journeys.

## 4) Alert Thresholds and Severity Routing

Use three operational severities for pilot: blocker / high / medium.

| Severity | Trigger examples | Initial response target | Routing |
|---|---|---|---|
| blocker | Complete outage, cross-tenant exposure risk, critical auth system failure, >= 20% critical-path error rate for 10m | Ack <= 5m, mitigation start <= 10m | Page primary + secondary immediately, incident commander auto-assigned |
| high | Major degradation on critical endpoints, repeated maker-checker failures, severe Lumi failure on active workflow, notification outage in pilot tenant | Ack <= 15m, mitigation start <= 30m | Page primary, notify secondary; incident commander assigned if unresolved at 30m |
| medium | Localized tenant issue, elevated retries/drop-offs, non-critical monitor regression, intermittent provider failures | Ack <= 60m, mitigation start same business day | Slack + ticket to primary queue; escalate to secondary if unresolved in 4h |

## 5) On-Call Ownership and Escalation Chain

| Role | Owner responsibility | Escalation timing |
|---|---|---|
| Primary on-call | First response, triage, mitigation owner, stakeholder update | Immediate on alert |
| Secondary on-call | Backup responder, parallel investigation, takeover if primary unavailable | Auto-page at +5m for blocker, +15m for high |
| Incident commander | Coordinates decisions, comms cadence, risk acceptance/rollback calls | Assigned immediately for blocker; for high if unresolved at 30m |

Escalation chain order:
1. Primary on-call
2. Secondary on-call
3. Incident commander
4. Product owner + security reviewer (if security, policy, or data risk)

## 6) Incident Playbooks (must be actionable)

### A. Auth/Policy Breach Response
1. Declare incident severity (default high; blocker if cross-tenant or widespread lockout).
2. Freeze risky writes for affected endpoints if needed.
3. Validate scope by tenant/role/action from audit logs.
4. Reproduce with least-privilege test account.
5. Contain via policy override/feature gate rollback.
6. Confirm denial/allow behavior against authorization matrix.
7. Communicate status every 15m (blocker) or 30m (high).
8. Post-incident: root cause + required regression tests.

### B. Data Integrity Response
1. Identify affected entities and time range from logs/audit trail.
2. Stop further writes in impacted workflow.
3. Compare source-of-truth records vs derived views.
4. Repair via approved script/manual correction with maker-checker signoff.
5. Validate sample + aggregate reconciliation.
6. Resume writes only after verification and signoff.

### C. Outage/Degradation Response
1. Confirm if global or tenant-scoped.
2. Check API error, latency, dependency, and deploy timeline correlation.
3. Apply fastest safe mitigation (rollback, scale-up, traffic shaping).
4. Re-check synthetic health and critical journey success.
5. Downgrade severity only after stable window (>= 30m).

### D. Rollback/Hotfix Decision Criteria
- Rollback preferred when:
  - Issue introduced by recent deploy and rollback is low risk.
  - Mitigation time with rollback < hotfix ETA.
- Hotfix preferred when:
  - Rollback would reintroduce known blocker/high issue.
  - Change is isolated and testable quickly.
- Mandatory gate before either action:
  - Incident commander approval (or delegate)
  - Primary + secondary concurrence
  - Security reviewer signoff for auth/data/security-impacting change

## 7) Pilot Hotfix Policy

1. Only blocker/high fixes are allowed during pilot.
2. Every hotfix must include:
   - Incident ID and severity.
   - Impacted journeys/roles/tenants.
   - Rollback plan.
3. Mandatory post-fix regression subset run before close:
   - Auth login + token refresh
   - Role/permission checks for each pilot role
   - Maker-checker approval happy path + one denied path
   - One danger-zone flow denied path
   - Lumi request in at least one role-specific journey
4. Incident remains open until regression subset passes and monitors stabilize.

## 8) Pre-Pilot Observability Validation Checklist

Complete on 2026-05-29 and re-run on 2026-05-31.

### A. Synthetic Checks
- Run synthetic probes for login, critical API endpoints, and core journeys.
- Verify success rate and latency thresholds from two regions.

### B. Alert Test Firing
- Trigger controlled test alerts for blocker/high/medium routes.
- Validate paging, Slack notifications, and acknowledgment SLA timing.

### C. Log Completeness Spot Checks
- Spot-check at least 20 sampled events per critical workflow.
- Confirm required fields exist: tenant_id, role, request_id, decision outcome, error code.
- Confirm cross-linkability from incident to logs/metrics/traces.

## Success Criteria (readiness gate)

- Monitoring dashboards are active, populated, and reviewed by owners.
- Alerting routes are active and verified with test firing.
- Security and UX-operational monitors are enabled with baseline thresholds.
- On-call ownership and escalation chain are documented and acknowledged.
- Incident playbooks are executable and reviewed in a tabletop exercise.
- Pilot hotfix policy is approved and enforced.
- Synthetic checks and log completeness checks pass before 2026-06-01 go-live.
