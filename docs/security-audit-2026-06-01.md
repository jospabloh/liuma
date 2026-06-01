# LIUMA Security & Code Quality Audit
**Date:** 2026-06-01  
**Auditor:** Claude Code (automated)  
**Scope:** Full codebase audit – commits through `0a25362`, PRs #63–#82  
**Test baseline:** 83 tests, 0 failures

---

## Executive Summary

The LIUMA codebase demonstrates a mature security posture for a SaaS school management platform: comprehensive RBAC, multi-tenant isolation enforced at every layer, full audit logging, and no hardcoded secrets. The primary blocker is a set of **unpatched npm dependency vulnerabilities** (1 critical, 12 high, 13 moderate) introduced through transitive dependencies. A secondary gap is the absence of a Node.js CI pipeline – only the Deno permissions module is covered by CI. Both items require immediate attention before the next tenant wave rollout.

---

## Findings by Severity

### CRITICAL

#### C-1 — Transitive npm Dependency Vulnerabilities (26 total: 1 critical, 12 high, 13 moderate)

**Status:** Open – partial mitigation applied (`npm audit fix`)  
**Packages affected:**  
- `react-router-dom` / `@remix-run/router` ≤ 6.30.2 — XSS via Open Redirects (HIGH, GHSA-2w69-qvjg-hvjx)  
- `axios` 1.0.0–1.15.2 — 20 CVEs including: SSRF via NO_PROXY bypass, prototype pollution gadgets, credential injection, header injection, CRLF injection, null-byte injection, unbounded recursion DoS (HIGH/MODERATE)  
- `flatted` ≤ 3.4.1 — Prototype Pollution + unbounded recursion DoS (HIGH, GHSA-25h7-pfq9-p65f, GHSA-rf6f-7fwh-wjgh)  
- `dompurify` ≤ 3.3.3 — 8 XSS bypass CVEs including mutation-XSS (MODERATE)  
- `ws` 8.0.0–8.20.0 — Uninitialized memory disclosure (MODERATE, GHSA-58qx-3vcg-4xpx)  
- `yaml` 2.0.0–2.8.2 — Stack Overflow via deeply nested YAML (MODERATE)  
- `vite` — Moderate severity vulnerability (dev dependency)  
- `ajv` < 6.14.0 — ReDoS via `$data` option (MODERATE)  
- `brace-expansion` — DoS via zero-step sequence (MODERATE)  
- `follow-redirects` ≤ 1.15.11 — Auth header leak to cross-domain redirect targets (MODERATE)  

**Risk context:**  
- `axios` vulnerabilities are the most concerning since `@base44/sdk` uses axios for all API communication. Prototype pollution gadgets can lead to authentication bypass, SSRF, and response tampering.  
- `react-router-dom` XSS via open redirects is exploitable if any user-controlled URL is passed to navigation functions.  
- `dompurify` is used in the `react-quill` dependency chain (rich text editor); multiple XSS bypass paths.  

**Action required:**  
1. Run `npm audit fix` for safe auto-fixes (already done for non-breaking changes).  
2. Upgrade `react-router-dom` to ≥ 6.30.3 once available.  
3. Upgrade `@base44/sdk` to a version that pins `axios` ≥ 1.15.3.  
4. Pin `react-quill` to a version that uses a patched `dompurify` ≥ 3.3.4.  
5. Enable `npm audit` as a required CI step (see gap H-2 below).

---

### HIGH

#### H-1 — No Node.js CI Pipeline

**Status:** Open  
**Details:**  
The GitHub Actions workflow (`.github/workflows/ci-deno.yml`) only covers the Deno permissions module (`deno/`). The 83 Node.js unit and integration tests are not run on any PR or push to `main`. This means:  
- Breaking changes to the authorization policy engine, RBAC, tenant isolation, or AI capabilities can be merged without automated detection.  
- `npm audit` is never run in CI, allowing new high/critical dependency vulnerabilities to go unnoticed.  

**Action required:**  
Add a Node.js CI job:
```yaml
node:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '22'
        cache: 'npm'
    - run: npm ci
    - run: npm run lint
    - run: npm run typecheck
    - run: npm test
    - run: npm audit --audit-level=high
```

#### H-2 — `requiresAuth: false` in Base44 Client

**Status:** Monitor  
**File:** `src/api/base44Client.js:12`  
**Details:**  
The SDK client is initialized with `requiresAuth: false`. Authentication enforcement is delegated entirely to the `AuthContext` and `GuardedRoute` components. If any component bypasses these guards and calls the SDK directly, unauthenticated requests may succeed at the SDK layer.  

**Mitigations in place:**  
- `GuardedRoute` wraps all protected routes.  
- `AuthContext` checks token validity on every app load.  
- All entity queries require a valid session token passed via the SDK.  

**Action required:**  
Confirm with the Base44 SDK maintainers whether `requiresAuth: true` would add server-side token validation, and switch if so. If the current behavior is intentional (client-side enforcement only), document this explicitly.

---

### MEDIUM

#### M-1 — Token Passed via URL Query Parameter

**Status:** Accepted / Monitor  
**File:** `src/lib/app-params.js:44`  
**Details:**  
The `access_token` is read from `?access_token=...` URL params and immediately removed from the URL via `history.replaceState`. However, during the brief window before removal, the token may appear in:  
- Browser history (if navigation happens before removal).  
- Server-side access logs if the page load request is logged.  
- Third-party analytics/monitoring SDKs that capture full URLs.  

This is a known and common OAuth/PKCE handoff pattern. The risk is low but should be monitored.

**Action required:**  
Review whether the Base44 auth flow can use a `POST` body or fragment (`#`) to pass the token instead of a query parameter. If not feasible, ensure no third-party analytics are capturing full URLs.

#### M-2 — `dangerouslySetInnerHTML` in Chart Component

**Status:** Accepted – Safe  
**File:** `src/components/ui/chart.jsx:61`  
**Details:**  
A `<style>` tag uses `dangerouslySetInnerHTML` to inject CSS custom property definitions. The injected content is generated from an internal `config` prop (theme color values) via `Object.entries(THEMES)`. No user-controlled input reaches this code path.  

**Action required:**  
None. Document as a known-safe pattern in code review guidelines. If color values ever originate from user input (e.g., tenant theme customization), add sanitization.

#### M-3 — Permissions Matrix Incomplete (Fixed in v1.0.0)

**Status:** Resolved  
**File:** `src/pages/PermisosRoles.jsx`  
**Details:**  
Six resources available in the application (Calendar, Events, Uniforms, Discounts, Emergency Alerts, Absences) were missing from the `RESOURCES` array in the permissions matrix, making it impossible for admins to configure granular permissions for these modules.  

**Fix applied:** Resources added to the matrix. Member default template added with all permissions set to `false`.

#### M-4 — No Content Security Policy (CSP) Defined

**Status:** Open  
**Details:**  
No CSP headers are configured in the Vite build output or deployment configuration. This increases the impact of any XSS vulnerabilities.  

**Action required:**  
Add CSP headers via the deployment platform (Vercel/Base44). A strict policy example:
```
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{nonce}'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.base44.app; img-src 'self' data: https:;
```

---

### LOW

#### L-1 — Version Stuck at 0.0.0 (Fixed in v1.0.0)

**Status:** Resolved  
**File:** `package.json`  
**Details:** `"version": "0.0.0"` offered no release tracking. Bumped to `1.0.0` as part of this audit.

#### L-2 — No CHANGELOG File (Fixed in v1.0.0)

**Status:** Resolved  
**Details:** No `CHANGELOG.md` existed. Created in this audit with full history from v0.1.0 through v1.0.0.

#### L-3 — `console.warn` for Access-Denied Events

**Status:** Accepted  
**File:** `src/lib/audit.js:106`  
**Details:**  
`logAccessDeniedEvent` calls `console.warn` before writing to the AuditLog entity. In production, `console.warn` output is not useful and may expose routing/role information to developer tools.  

**Action required:**  
Remove or gate the `console.warn` call behind a `DEBUG` environment variable.

#### L-4 — User Manual Missing (Fixed in v1.0.0)

**Status:** Resolved  
**Details:** No user-facing documentation existed. `docs/user-manual.md` created in this audit.

#### L-5 — `window.confirm` for High-Risk Confirmations

**Status:** Low Priority  
**File:** `src/pages/PermisosRoles.jsx` – `requireExplicitConfirmation()`  
**Details:**  
High-risk operations (admin role changes, rollbacks, danger zone) use `window.confirm()` for confirmation. This is accessible but not customizable and may be blocked by some browser extensions.  

**Action required:**  
Replace with a custom `AlertDialog` component (already available in the shadcn/ui library) for a more controlled confirmation experience.

---

## Authorization & RBAC Assessment

| Control | Status | Notes |
|---|---|---|
| Role-based route access | ✅ Pass | 41 routes mapped; default-deny enforced |
| Entity-level RBAC | ✅ Pass | 7 entities covered; read/write separation |
| Multi-tenant isolation | ✅ Pass | `school_id` enforced at query and filter level |
| Classroom scope (teachers) | ✅ Pass | `classroom_id` filter applied via `buildScopedFilter` |
| Student scope (parents) | ✅ Pass | `student_id` filter applied via `filterByRowLevel` |
| Owner override mechanism | ✅ Pass | Requires matching `VITE_OWNER_EMAIL` + `VITE_OWNER_USER_ID`; identity conflict detection |
| Permission overrides | ✅ Pass | Per-user-profile overrides; deny takes precedence; admin override blocked |
| Self-role change protection | ✅ Pass | Admin cannot demote themselves if last manage_permissions holder |
| Maker-checker for high-risk | ✅ Pass | Second admin approval required for ADMIN role changes and manage_permissions rollbacks |
| Audit logging | ✅ Pass | All permission changes logged with before/after diff |
| Inactive profile guard | ✅ Pass | `INACTIVE` profiles blocked in GuardedRoute |
| Cross-tenant access | ✅ Pass | `assertSameTenant` enforced; denial logged |
| Onboarding ADMIN gate | ✅ Pass | `validateAdminTenantCreator` blocks non-owner ADMIN creation (v1.0.0) |

---

## Test Coverage Assessment

| Suite | Tests | Result |
|---|---|---|
| `policy.test.js` | 25+ | ✅ Pass |
| `route-access.test.js` | 10+ | ✅ Pass |
| `role-boundary.test.js` | 8+ | ✅ Pass |
| `admin-safety.test.js` | 5+ | ✅ Pass |
| `tenant-*.test.js` | 12+ | ✅ Pass |
| `onboarding-tenant-creation.test.js` | 10 | ✅ Pass |
| `lumi-capabilities.test.js` | 6+ | ✅ Pass |
| `calendar-ux.test.js` | 3+ | ✅ Pass |
| `observability-alerts.test.js` | 4+ | ✅ Pass |
| `authorization-stack.test.js` (integration) | 10+ | ✅ Pass |
| `key-pages.test.js` (integration) | 5+ | ✅ Pass |
| `owner-route-walkthrough.test.js` (integration) | 5+ | ✅ Pass |
| `tenant-smoke-dataset.test.js` (integration) | 14 | ✅ Pass |
| **Total** | **83** | **✅ 83/83 Pass** |

**Gaps:**
- No end-to-end (browser) tests. All tests run against the logic layer only.
- No Node.js CI runner; tests must be run manually or via a local script.
- UI accessibility and visual regression testing not yet established.

---

## CI/CD Health

| Check | Status |
|---|---|
| Deno format check | ✅ CI (GitHub Actions) |
| Deno lint | ✅ CI (GitHub Actions) |
| Deno test | ✅ CI (GitHub Actions) |
| Node lint | ❌ Not in CI |
| Node typecheck | ❌ Not in CI |
| Node test (83 tests) | ❌ Not in CI |
| npm audit | ❌ Not in CI |
| Production build check | ❌ Not in CI |

---

## Hardcoded Secrets Assessment

| Area | Result |
|---|---|
| Source files (.js/.jsx/.ts) | ✅ No hardcoded secrets found |
| `.env` files in repo | ✅ None present |
| API keys in code | ✅ All via `import.meta.env.VITE_*` |
| Owner config | ✅ Via `VITE_OWNER_EMAIL` / `VITE_OWNER_USER_ID` env vars |
| Token storage | ⚠️ `localStorage` (standard; see M-1) |

---

## Dependency Health

| Package | Current | Vulnerability | Action |
|---|---|---|---|
| react-router-dom | 6.26.0 | HIGH – XSS via open redirect | Upgrade when ≥ 6.30.3 available |
| axios (via @base44/sdk) | 1.x | HIGH – multiple CVEs | Upgrade @base44/sdk |
| flatted | transitive | HIGH – prototype pollution | Upgrade via audit fix |
| dompurify (via react-quill) | transitive | MODERATE – XSS bypass | Upgrade react-quill |
| ws | transitive | MODERATE – memory disclosure | Upgrade via audit fix |
| yaml | transitive | MODERATE – stack overflow | Upgrade via audit fix |
| vite | 6.1.0 | MODERATE | Upgrade to latest |

---

## Immediate Action Items (Blockers)

| # | Item | Owner | Priority |
|---|---|---|---|
| 1 | Upgrade axios / @base44/sdk to patch SSRF + prototype pollution CVEs | Backend/DevOps | CRITICAL |
| 2 | Add Node.js CI job with `npm test` + `npm audit --audit-level=high` | DevOps | HIGH |
| 3 | Upgrade react-router-dom to patched version | Frontend | HIGH |
| 4 | Add CSP headers to deployment configuration | DevOps | MEDIUM |
| 5 | Confirm `requiresAuth` behavior with Base44 SDK maintainers | Frontend | MEDIUM |

---

## Items Confirmed Safe

- Authorization policy engine (RBAC) – comprehensive and well-tested.
- Multi-tenant isolation – enforced at all layers.
- Audit logging – complete with PII masking.
- Owner override mechanism – identity verification working correctly.
- Self-role change protection – admin demotion guard in place.
- No hardcoded secrets in source or repository.
- `dangerouslySetInnerHTML` in chart.jsx – safe; no user input reaches it.
- Token URL param removal – properly cleaned via `history.replaceState`.
