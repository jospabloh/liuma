# Final Rollout Decision Report — 2026-05-18

## 0) Assumptions, ambiguities, and decision method

### Explicit assumptions
1. This report uses only evidence already present in repository artifacts dated **2026-05-18**.
2. "Pilot outcomes" are consolidated from: release gate, UX certification, and defect register artifacts.
3. No additional live-traffic telemetry export was provided in-repo; therefore KPI and incident values are taken from documented pilot evidence snapshots only.
4. A rollout decision is valid only if hard gates are re-validated and unresolved issues are explicitly classified.

### Ambiguities surfaced (not hidden)
- There is no standalone `pilot-kpi-dashboard` dataset file; KPI status is inferred from the documented go/no-go evidence.
- Tenant feedback is qualitative and role-based from review artifacts; no raw survey CSV is present.

### Success criteria for this report
- Decision is explicit (**FULL GO / LIMITED GO / NO-GO**).
- Decision is evidence-backed (tables + source artifacts).
- Decision is operationally executable (waves, monitoring, rollback triggers OR remediation sprint).
- Cross-functional sign-off section exists and is action-ready.

---

## 1) Consolidated pilot outcomes

### 1.1 KPI outcomes vs thresholds

| KPI | Threshold | Observed (2026-05-18 evidence) | Result |
|---|---|---|---|
| Open blocker UX/security defects | 0 | 0 | PASS |
| Open high UX/security defects | 0 | 0 | PASS |
| Critical journey quality score | >= certification threshold (11.1 rubric pass level) | Certified with provisional tags on some journeys; one admin surface (AlertaEmergencia) below threshold | PARTIAL |
| Authorization/tenant security regression tests | 100% pass on defined hardening suite | PASS in documented hardening matrix | PASS |
| CI reliability (app + deno checks) | Fully green | App tests/typecheck pass; deno checks unavailable in runner in gate evidence | FAIL |

### 1.2 Incident counts by severity (pilot evidence window)

| Severity | Count | Notes |
|---|---:|---|
| Critical/Blocker incidents | 0 | No open blocker incidents recorded in consolidation artifacts. |
| High incidents | 0 | No open high incidents recorded. |
| Medium incidents | 7 | Tracked as THM-01, THM-02, JNY-01, LUM-01, ADM-04, ADM-05, TCH-01. |
| Low incidents | 2 | ADM-06, TCH-02. |

### 1.3 Unresolved issues (current open set)
- THM-01 — semantic token drift on status colors.
- THM-02 — missing palette safety validator/auto-adjust.
- JNY-01 — journey visual automation not CI-gating yet.
- LUM-01 — Lumi route-by-route overlap/contrast stress pack incomplete.
- ADM-04 — Admin Home hardcoded palette classes.
- ADM-05 — Admin Pagos static payment semantics.
- ADM-06 — Auditoría quick-filter persistence enhancement.
- TCH-01 — Teacher long-list sticky quick actions.
- TCH-02 — Teacher timeline chip copy clarity.

### 1.4 Tenant feedback summary by role (from role review/cert artifacts)
- **Admin/Owner:** security-critical and approval journeys improved materially; residual concern is theme semantic consistency in state-heavy pages.
- **Teacher:** attendance/homework UX materially improved; remaining usability request is faster actions in long rosters and copy polish.
- **Parent:** core journeys are acceptable but still contrast-sensitive under weaker tenant palettes.
- **Operations/Support perspective:** release confidence is reduced by incomplete deno execution evidence and pending visual automation coverage.

---

## 2) Hard-gate re-validation (required second pass)

| Hard gate | Re-validation result | Status |
|---|---|---|
| No open blocker/high security issues | Confirmed (0 blocker, 0 high open) | PASS |
| Tenant isolation remained intact | Cross-tenant denial and role-boundary evidence pass | PASS |
| Permission/audit controls held under real usage | Permission logic pass; audit persistence evidence remains partial-live | PARTIAL |
| UX quality above certification threshold | Overall certified for constrained pilot, but with provisional areas and one below-threshold admin surface in cert table | PARTIAL |

**Gate outcome:** hard gates are **not all fully closed** for unrestricted rollout.

---

## 3) Remaining issue classification

## 3.1 Must-fix before full rollout
1. **REL-001:** Restore full CI signal reliability (including deno checks in runner) — **Owner:** Platform/DevEx — **Due:** 2026-05-19.
2. **THM-02:** Implement palette safety validator/auto-adjust to prevent unsafe tenant contrasts — **Owner:** Frontend Platform — **Due:** 2026-05-27.
3. **JNY-01:** Make journey visual automation gating in CI (TC-1/TC-2/TC-3) — **Owner:** QA Automation — **Due:** 2026-05-29.
4. **LUM-01:** Complete Lumi overlap/contrast regression pack across route matrix — **Owner:** Frontend + QA — **Due:** 2026-05-28.
5. **AlertaEmergencia score recovery:** Raise UX score to certification pass threshold with evidence rerun — **Owner:** Product Design + Frontend Admin — **Due:** 2026-05-24.

## 3.2 Acceptable post-rollout (tracked debt)
1. **THM-01** — Owner: Design System — Due: 2026-05-24.
2. **ADM-04** — Owner: Design System — Due: 2026-05-24.
3. **ADM-05** — Owner: Design System — Due: 2026-05-24.
4. **TCH-01** — Owner: Frontend Teacher — Due: 2026-06-02.
5. **ADM-06** — Owner: Frontend Admin — Due: 2026-06-03.
6. **TCH-02** — Owner: Product + Frontend — Due: 2026-06-05.

---

## 4) Final rollout decision

## **LIMITED GO**

### Why this is not FULL GO
- Full rollout requires all hard gates fully closed; current evidence shows partial gaps (audit persistence validation and CI deno evidence).

### Why this is not NO-GO
- Security/permission isolation gates are passing, blocker/high defect counts are zero, and critical role journeys are largely certified for constrained exposure.

**Decision timestamp (UTC):** 2026-05-18T00:00:00Z.

---

## 5) Rollout execution plan (LIMITED GO path)

## 5.1 Rollout waves (tenant cohorts)
- **Wave 1 (Canary, 1–2 low-risk tenants):** internal-friendly tenants with strong admin champions and rapid feedback loops.
- **Wave 2 (Early expansion, +3–5 tenants):** mixed complexity tenants after 7-day stable window and no rollback triggers.
- **Wave 3 (Broader staged expansion):** remaining medium-complexity tenants only after must-fix list closure.
- **Wave 4 (Full rollout):** all remaining tenants after hard-gate closure and sign-off refresh.

## 5.2 Monitoring intensity per wave
- **Wave 1:** highest intensity (daily triage; security + UX review each day).
- **Wave 2:** high intensity (48h triage cadence; incident review twice weekly).
- **Wave 3:** moderate-high (weekly governance review + automated dashboards).
- **Wave 4:** steady-state monitoring (standard SLO/SLA cadence).

## 5.3 Rollback triggers (objective)
Rollback to prior stable release if any occur:
1. Any **blocker or high** security/tenant-isolation defect appears.
2. Any confirmed cross-tenant data exposure signal appears.
3. Permission/audit control failure on high-risk operation is reproducible.
4. UX critical journey failure rate exceeds certification tolerance for two consecutive review windows.
5. CI gate reliability regresses (required checks missing or red on release candidate).

---

## 6) Governance sign-off (required to execute)

| Function | Decision | Name | Date |
|---|---|---|---|
| Product | Approved for LIMITED GO | _Pending_ | _Pending_ |
| Engineering | Approved for LIMITED GO | _Pending_ | _Pending_ |
| Security/Compliance | Approved for LIMITED GO | _Pending_ | _Pending_ |
| Operations | Approved for LIMITED GO | _Pending_ | _Pending_ |

---

## 7) Operational checklist to start Wave 1
1. Confirm active on-call roster and escalation path.
2. Confirm incident triage channel + severity rubric.
3. Confirm per-tenant rollout window and rollback owner.
4. Confirm dashboard watchers (product, eng, security, ops).
5. Confirm must-fix tracking board with due dates above.

This report’s conclusion is explicit and executable: **LIMITED GO with staged expansion and strict rollback governance**.
