# Task 11.2–11.7 Consolidated UX/UI Defect Register — 2026-05-18

## Assumptions (explicit)
1. Source of truth is the existing Task 11 artifacts in this repository (`task-11-theme-role-audit`, admin review, teacher review, baseline rubric).
2. "Open defects" means entries still marked Open or provisional risk items not yet resolved with implementation evidence.
3. No new browser-based manual QA was possible in this CLI-only environment; consolidation and re-scoring are evidence-based from current docs and code-linked validations.

## 1) Ranked open defect list (11.2–11.7 unified)

Ranking logic: Severity first (Blocker > High > Medium > Low), then journey criticality (Admin/Teacher/Parent + Lumi touchpoints), then breadth across tenants/themes.

| Rank | ID | Workstream | Area/Journey | Defect summary | Severity | Owner | Target date | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | THM-01 | 11.3/11.4 | Cross-role status semantics | Some screens still rely on hardcoded state colors instead of semantic token map; risk of status confusion in low-contrast tenant themes. | Medium | Design System | 2026-05-24 | Open |
| 2 | THM-02 | 11.5 | Tenant onboarding/config | Palette safety validator and auto-adjust path not yet implemented for unsafe contrasts. | Medium | Frontend Platform | 2026-05-27 | Open |
| 3 | JNY-01 | 11.6 | Critical journeys (all roles) | Journey-based visual automation (TC-1/TC-2/TC-3) is not yet in CI for regression gating. | Medium | QA Automation | 2026-05-29 | Open |
| 4 | LUM-01 | 11.7 | Lumi bubble/chat | Full route-by-route Lumi overlap + contrast regression pack missing across theme stress profiles. | Medium | Frontend + QA | 2026-05-28 | Open |
| 5 | ADM-04 | 11.3 | Admin Home dashboard | Hardcoded palette classes can drift from tenant semantic intent. | Medium | Design System | 2026-05-24 | Open |
| 6 | ADM-05 | 11.4 | Admin Pagos | Pending/overdue/paid visual semantics still partially static. | Medium | Design System | 2026-05-24 | Open |
| 7 | ADM-06 | 11.6 | Admin Auditoría | Missing persistent quick-filter summary for multi-filter context. | Low | Frontend Admin | 2026-06-03 | Open |
| 8 | TCH-01 | 11.6 | Teacher attendance long lists | Sticky per-student quick actions for very long classes not implemented. | Medium | Frontend Teacher | 2026-06-02 | Open |
| 9 | TCH-02 | 11.6 | Teacher timeline chips | Daily timeline filter chip labels could be clearer in Spanish copy. | Low | Product + Frontend | 2026-06-05 | Open |

## 2) Blocker/high-first rule outcome

- **Open blocker defects:** 0
- **Open high defects:** 0

Evidence basis:
- Admin high defects ADM-01/02/03 are fixed.
- Teacher reviewed high defects are fixed.
- Remaining open items are medium/low backlog items.

## 3) Re-test log for affected journeys (post high-fix batches)

Only journeys affected by high-fix batches were re-tested in prior review artifacts:
- Admin: Permisos y Roles, Aprobaciones, Auditoría/Rollback, Danger Zone.
- Teacher: Attendance, Homework modal, Notice wizard.

Result: no remaining blocker/high in those reviewed journeys.

## 4) Re-score of impacted screens (11.1 rubric)

| Screen | Role | Previous | Current | Delta | Notes |
|---|---|---:|---:|---:|---|
| Permisos y Roles | Admin/Owner | 68 | 89 | +21 | High-risk action clarity and confirmation hierarchy improved. |
| Aprobaciones | Admin/Owner | 69 | 87 | +18 | Semantic action labeling and confirmation improved. |
| Auditoría/Rollback | Admin/Owner | 74 | 86 | +12 | CTA clarity and decision support improved. |
| Danger Zone | Admin/Owner | 68 | 90 | +22 | Risk signaling and guarded actions improved. |
| ResumenAsistencia | Teacher | 3.8/5 (equiv prior) | 4.5/5 | +0.7 | Mobile target size and label clarity improved. |
| TareaMaestro | Teacher | 3.7/5 (equiv prior) | 4.3/5 | +0.6 | Unsaved change protection improved recoverability. |
| AvisosMaestro (wizard touchpoint) | Teacher | 3.8/5 (equiv prior) | 4.4/5 | +0.6 | Unsaved change guard + discard confirmation. |

## 5) Tenant-theme consistency confirmation (incl. Lumi + notifications)

Current state after high-fix batches:
- Critical destructive/admin-risk controls preserve danger semantics and do not inherit unsafe tenant-primary styling.
- Lumi route exclusion logic remains explicit for protected/owner-related paths.
- Notification UX remains functionally stable; full theme-stress visual consistency for notifications remains in medium backlog under THM-01/JNY-01.

## 6) Accessibility/responsive regression check summary

- Teacher mobile attendance target sizing and accessible labels were improved in reviewed fixes.
- No newly introduced blocker/high accessibility or responsive regressions are recorded in affected journeys.
- Full cross-device visual regression automation remains pending (JNY-01).

## 7) Explicit medium/low backlog (owner/date)

All non-blocker/non-high defects are tracked in section 1 with owner and target date, and stay open until validated by TC-1/TC-2/TC-3 journey evidence artifacts.

## Success criteria snapshot

- blocker/high UX defects = **0** ✅
- critical journeys pass across Admin/Teacher/Parent + Lumi = **Pass for reviewed/fixed critical journeys; full evidence completion pending visual automation backlog** ⚠️
- regression risk controlled = **Yes, with medium-risk items explicitly tracked and dated** ✅
