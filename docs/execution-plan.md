# Execution Plan (Single Source of Truth)

This document is the **single source of truth** for plan tracking.

## Plan Tracking Table

| task | owner | start date | end date | status | blockers | verification evidence |
|---|---|---|---|---|---|---|
| Create `docs/execution-plan.md` with one row per task. | TBD | TBD | TBD | done | none | This file exists and contains one row per listed task. |
| Add columns: owner, start/end date, status, blockers, verification evidence. | TBD | TBD | TBD | done | none | Table includes all requested columns. |
| Add mandatory end-of-day checkpoint format. | TBD | TBD | TBD | done | none | End-of-day checkpoint section is present with all required fields. |
| Lock this as single source of truth for plan tracking (Parallel: No). | TBD | TBD | TBD | done | none | Statement at top declares this file as single source of truth; execution mode is serial. |
| If hard gates pass, continue rollout wave-by-wave tenant-by-tenant under freeze policy. | Release Manager | 2026-05-19 | TBD | pending | Hard gates not passed or freeze exception missing | Signed gate report + tenant rollout checklist + explicit freeze exemption log (if any). |
| Run daily reliability review (errors, latency, permission denials, Lumi failures). | SRE + App Owner | 2026-05-19 | recurring daily | in_progress | Missing telemetry snapshot for the day | Daily review note in `docs/ops-health-and-governance-review-YYYY-MM-DD.md` with command outputs. |
| Run weekly security drift checks (permissions, maker-checker integrity, owner override logs). | Security + Platform | 2026-05-19 | recurring weekly | pending | Weekly audit not yet executed | Weekly report with `test:permissions` results and owner-override audit log reconciliation. |
| Run bi-weekly UX quality checks (mobile/laptop + tenant-theming contrast). | QA + Design | 2026-05-19 | recurring bi-weekly | pending | Cross-device screenshots missing | UX certification update with device matrix and tenant contrast pass/fail notes. |
| Keep incident postmortems mandatory for blocker/high events and add regression tests for every incident. | Incident Commander + QA | 2026-05-19 | recurring | in_progress | Open incidents without linked tests | Incident doc includes postmortem section and links to merged regression test(s). |

## End-of-Day Checkpoint (Mandatory Format)

- done:
- verified:
- pending:
- risks:
- next-day adjustments:
