# Lumi Pilot Plan (Frozen)

Date prepared: 2026-05-18

## 0) Assumptions (explicit)

1. Pilot length is fixed to 4 weeks to capture at least one full monthly admin/payments cycle.
2. All pilot tenants use the same frozen scope; no tenant-specific feature toggles except data volume.
3. KPI measurements are collected daily and reviewed weekly by owners.
4. High-severity incidents include any issue that blocks core role workflows for >2 hours.
5. Security incidents include unauthorized data access, privilege escalation, or data leakage.

## 1) Pilot Tenants (selected profiles)

| Tenant code | Profile | Complexity rationale | Estimated active users | Roles in use |
|---|---|---|---:|---|
| PILOT-SM-01 | Small/simple school | Single campus, low role variance, straightforward daily operations. | 40-80 | Director, Teacher, Parent |
| PILOT-MD-01 | Medium complexity school | Multi-grade operations with both academic and payment/admin workflows. | 180-320 | Director, Admin, Teacher, Parent |
| PILOT-HC-01 | High-complexity school | Large user base, cross-role workflows, higher concurrency and permission edge-cases. | 700-1200 | Director, Admin, Teacher, Parent, Staff Support |

## 2) Pilot Timeline

- **Pilot start date:** 2026-06-01 (Monday)
- **Duration:** 4 weeks (28 calendar days)
- **Daily check window:** 16:00-16:30 UTC (Monday-Friday)
- **End-of-pilot review date:** 2026-06-30 (Tuesday), 17:00 UTC

## 3) Pilot Scope (frozen)

### Enabled modules
- Attendance
- Classroom management
- Teacher tasks
- Parent notices
- Daily operations dashboard
- Admin payments overview
- Role/permission enforcement
- Tenant theming

### Enabled roles
- Director
- Admin
- Teacher
- Parent
- Staff Support (high-complexity tenant only)

### AI capabilities enabled
- Lumi guided assistance for role-specific navigation
- Lumi contextual workflow suggestions (non-destructive)
- Lumi summary/help responses based on visible, authorized data only

### Excluded features (during pilot)
- New module rollouts not already in production build
- Bulk destructive actions triggered from AI
- Any cross-tenant analytics views
- Experimental permission model changes

## 4) Pilot KPIs and thresholds

| KPI | Definition | Threshold (weekly) | Threshold (pilot-end) |
|---|---|---|---|
| Successful task completion rate | % of representative role tasks completed without manual workaround. | >= 90% | >= 93% |
| Permission error false-positive rate | % of permission denials that were incorrect and later overridden as valid access. | <= 2.0% | <= 1.5% |
| Support ticket volume | Avg. pilot-related tickets per 100 active users per week. | <= 8 | <= 6 |
| UX satisfaction per role | Avg. role survey score (1-5) for Director/Admin/Teacher/Parent. | >= 4.0 each role | >= 4.2 each role |
| Lumi usefulness score | Avg. score (1-5) for “Lumi helped me complete my task faster.” | >= 3.8 | >= 4.1 |

## 5) Pilot acceptance criteria

A pilot is accepted only if **all** conditions are met:

1. Minimum KPI targets met at pilot-end:
   - Successful task completion rate >= 93%
   - Permission error false-positive rate <= 1.5%
   - Support ticket volume <= 6 per 100 users/week
   - UX satisfaction >= 4.2 for each active role
   - Lumi usefulness >= 4.1
2. Maximum blocker/high incidents:
   - Blocker incidents: <= 1 total
   - High incidents: <= 4 total
3. Maximum allowed security incidents:
   - **0 security incidents** (required)

## 6) Operational owners

| Responsibility | Owner | Backup |
|---|---|---|
| Technical on-call | Platform Engineering Lead | Senior Full-Stack Engineer |
| Product owner | Product Manager (Lumi School) | Group Product Manager |
| Security reviewer | Security Engineer | Head of Security |
| Tenant success contact | Customer Success Manager | Regional Implementation Specialist |

## 7) Communication plan

### Onboarding message to pilot tenants (template)

> Subject: Lumi Pilot Start on 2026-06-01 — Scope and Support Details  
> Hello Pilot Team,  
> Your school has been selected for the Lumi pilot running from **2026-06-01 to 2026-06-30**.  
> Pilot scope is frozen and includes attendance, classroom management, teacher tasks, parent notices, daily operations, admin payments overview, permissions, and tenant theming.  
> Please report issues via the pilot support channel (below) and include role, tenant code, timestamp, and reproduction steps.  
> Daily status checks happen Monday-Friday at 16:00 UTC. Thank you for partnering with us.

### Issue reporting channel
- Primary: `#pilot-lumi-support` (shared support channel)
- Secondary fallback: pilot-support@lumi.example
- Severity tagging required: blocker / high / medium / low

### Status update cadence
- Daily: short check-in during 16:00-16:30 UTC window
- Weekly: KPI summary every Friday 18:00 UTC
- End-of-pilot: consolidated review on 2026-06-30

## 8) Pilot change-freeze policy

1. Only blocker/high hotfixes may be deployed during pilot window.
2. No scope expansion during 2026-06-01 to 2026-06-30.
3. Any hotfix must include rollback steps and owner sign-off (technical on-call + product owner).
4. Non-critical backlog items are deferred to post-pilot release planning.

## 9) Launch controls and daily operating cadence

### 9.1 Launch to selected pilot tenants only

1. Pilot launch is limited to: `PILOT-SM-01`, `PILOT-MD-01`, `PILOT-HC-01`.
2. No broader rollout is permitted until end-of-pilot Go/No-Go approval is complete.

### 9.2 Launch-window health confirmation checklist

Within the launch window (first 2 hours on 2026-06-01), confirm and record:

- Login/authentication success across all pilot roles.
- Role-based routing correctness for Director/Admin/Teacher/Parent paths.
- Permission boundaries (deny/allow) for high-risk actions.
- Lumi availability for allowed roles and Lumi exclusions where disabled by policy.

### 9.3 Daily pilot checkpoint (same time each day)

Daily checkpoint time is fixed at **16:00-16:30 UTC**. Required review artifacts:

1. Incidents opened/closed since previous checkpoint.
2. KPI trend vs target thresholds (section 4).
3. Blocker/high defects with status and ETA.
4. Support feedback themes (top 3 recurring).
5. AI usage quality signals (usefulness, safety flags, unresolved low-confidence responses).

### 9.4 Strict change policy enforcement during pilot

1. Only blocker/high fixes may ship.
2. No feature expansion or scope increase is allowed.
3. Mandatory regression subset must pass before every hotfix deploy:
   - Auth/login flow by role.
   - Role route access checks.
   - Tenant isolation checks.
   - Maker-checker approval path.
   - Danger-zone authorization controls.
   - Audit event write/read completeness.

### 9.5 Tenant-by-tenant health tracking

Maintain a daily status board with one row per pilot tenant:

| Tenant | Health | Major pain points | Mitigation actions | Owner |
|---|---|---|---|---|
| PILOT-SM-01 | Green / Yellow / Red | Top issues impacting operations | Current actions and due dates | Named owner |
| PILOT-MD-01 | Green / Yellow / Red | Top issues impacting operations | Current actions and due dates | Named owner |
| PILOT-HC-01 | Green / Yellow / Red | Top issues impacting operations | Current actions and due dates | Named owner |

### 9.6 Daily safety control validation

Validate and record evidence for:

- Tenant isolation integrity.
- Maker-checker control integrity.
- Danger-zone control enforcement.
- Audit completeness (critical user/admin actions present and attributable).

### 9.7 Daily stakeholder summary requirements

Send a daily summary covering:

1. What happened (incidents, KPI movement, tenant status changes).
2. What changed (hotfixes/config changes, if any).
3. Current risks.
4. Next 24-hour plan.

### 9.8 Security/privacy incident response rule

If any security/privacy incident is detected:

1. Execute incident playbook immediately.
2. Pause pilot expansion and any rollout increase.
3. Escalate to formal Go/No-Go review before resuming.

## Success Criteria Checklist

- [x] Pilot tenants chosen (small, medium, high complexity)
- [x] Measurable KPI framework set
- [x] Scope and responsibilities locked
- [x] Daily operating controls defined (launch checks, checkpoints, safety validation, stakeholder updates)
- [x] Security/privacy escalation gate defined (incident playbook + expansion pause + Go/No-Go)
- [x] Pilot success requires guardrail compliance and daily trend stability or explicit corrective actions
