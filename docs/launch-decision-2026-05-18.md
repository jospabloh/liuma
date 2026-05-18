# Launch Decision Record — 2026-05-18

## 0) Assumptions and ambiguity handling

### Assumptions used
1. "Final evidence artifacts" refers to artifacts already present in this repository plus fresh CI command outputs executed in this session.
2. "Phase 10 test hardening results" are represented by the current authorization/security hardening automated suites (policy, role boundaries, tenant isolation, maker-checker, admin safety, and route protection) because no separate `phase-10` file exists in this repo.
3. "CI status (app + deno)" means local execution status of app checks (`npm`) and deno checks (`deno task ...`) in this environment.
4. A formal launch decision must be auditable and explicit even when evidence is incomplete.

### Ambiguity noted
- There is no explicit named document called "Phase 10 hardening report" in-repo. This decision maps the requirement to the available hardening evidence matrix and test runs.

---

## 1) Final evidence artifacts (collected)

### 1.1 Phase 10 hardening evidence snapshot
- Authorization hardening matrix captured in `docs/release-gate-2026-05-18.md` (tenant isolation, deny precedence, maker-checker, self-lock prevention, admin danger-zone, role-route boundaries, audit visibility, selective rollback): **PASS in automated logic checks**.
- Detailed unit/integration evidence files referenced by gate:
  - `tests/unit/tenant-danger-zone.test.js`
  - `tests/unit/role-boundary.test.js`
  - `tests/unit/policy.test.js`
  - `tests/unit/admin-safety.test.js`
  - `tests/unit/route-access.test.js`
  - `tests/unit/lumi-capabilities.test.js`
  - `tests/integration/key-pages.test.js`

### 1.2 CI status (app + deno)
Executed in this session:
- `npm run lint` => **FAIL** (3 unused-import errors in admin/teacher/parent home components).
- `npm run typecheck` => **PASS**.
- `npm run test` => **PASS** (36 passed, 0 failed).
- `deno task test` => **FAIL** (`deno: command not found` in runner).

### 1.3 Security/permission validation results
- Security/permission validations remain **PASS (logic evidence)** from release gate matrix:
  - direct URL denial,
  - cross-tenant denial,
  - privilege escalation prevention,
  - AI capability scope denial defaults,
  - maker-checker constraints.
- Reinforced by this session test run (`npm run test` all green).

### 1.4 Phase 11 UX certification report
- `docs/ux-certification-2026-05-18.md` exists as the authoritative Phase 12 go/no-go UX artifact.
- Current UX cert statement: blocker/high UX = 0, pilot can be constrained, but medium-risk follow-up is required.

---

## 2) Mandatory launch gate validation

| Gate | Required | Actual | Status |
|---|---|---|---|
| Blocker defects | 0 | 0 (UX/security artifacts) | PASS |
| High defects | 0 or waiver | 0 open high in UX defect consolidation | PASS |
| Critical role journeys pass | pass required | Many journeys marked "PASS (provisional)" due missing fresh live walkthrough evidence | **CONDITIONAL / NOT FINAL** |
| Tenant isolation checks pass | pass required | PASS (automated hardening tests + release gate) | PASS |
| Maker-checker and audit controls pass | pass required | PASS (logic/tests), audit persistence still partial-live verification | **CONDITIONAL** |
| CI app + deno healthy | must be green for launch confidence | lint FAIL + deno unavailable | **FAIL** |

Gate conclusion: mandatory gates are **not fully satisfied** for pilot launch sign-off.

---

## 3) Final risk review output

### Known medium/low risks
1. Theme semantic-token drift in some status surfaces (THM-01, ADM-04, ADM-05).
2. Palette safety auto-adjust missing (THM-02).
3. Journey visual automation not yet CI-gating (JNY-01).
4. Lumi route-by-route visual stress pack incomplete (LUM-01).
5. Teacher long-list quick actions + timeline copy polish (TCH-01/TCH-02).

### Mitigations
- Complete THM-01/02 normalization and palette safety validator.
- Land JNY-01/LUM-01 automated visual regression packs and make them blocking in CI for pilot expansion.
- Re-run full manual staged role journeys (Admin, Teacher, Parent, Owner, Lumi) with screenshot evidence addendum.
- Resolve lint failures and ensure deno toolchain + deno checks run green in CI runner.

### Pilot monitoring signals (once unblocked)
- authorization denial-rate spikes by route/role,
- maker-checker approval latency and rejection reason trends,
- audit log completeness checks for high-risk operations,
- theme contrast/semantic confusion UX feedback incidence,
- Lumi route-exclusion violations or overlap complaints.

---

## 4) Explicit launch decision

- **Decision:** **NO-GO**
- **Decision timestamp (UTC):** 2026-05-18T00:00:00Z
- **Approvers:**
  - Release Manager — **Pending signature**
  - Security Lead — **Pending signature**
  - Product/UX Lead — **Pending signature**
  - Engineering Lead — **Pending signature**
- **Rationale:**
  1. App CI is not fully green (`npm run lint` failed).
  2. Deno validation cannot be executed in current runner (`deno` missing), leaving an evidence gap on required deno checks.
  3. Critical journey evidence remains partly provisional without fresh live staged walkthrough evidence.
  4. Audit control verification is logic-pass but still partial for live persistence checks.

This decision is evidence-backed and unambiguous: **pilot is blocked until remediation closure and sign-off re-run**.

---

## 5) NO-GO actions (opened remediation + pilot block)

### Pilot block
- Pilot launch status set to **BLOCKED** pending gate closure.

### Remediation tasks opened
1. **REL-001 (Engineering):** Fix lint failures in home components and re-run `npm run lint` to green. Due: 2026-05-18.
2. **REL-002 (Platform/DevEx):** Install/enable deno in CI runner and execute `deno task fmt`, `deno task lint`, `deno task test`. Due: 2026-05-19.
3. **REL-003 (QA):** Execute full staged role journeys with screenshot evidence addendum and sign-off checklist. Due: 2026-05-19.
4. **REL-004 (Security/Backend):** Validate live audit persistence and traceability for high-risk actions in staging. Due: 2026-05-19.

### Re-entry criteria for GO reconsideration
- REL-001..004 all closed with evidence links,
- all mandatory launch gates PASS without provisional blockers,
- formal re-approval by release/security/product/engineering leads.

---

## 6) Phase 12.2 trigger status
- Because decision is **NO-GO**, **Phase 12.2 pilot setup tasks are NOT triggered**.
- Trigger is explicitly deferred until re-entry criteria are met.
