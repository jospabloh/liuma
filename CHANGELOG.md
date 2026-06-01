# Changelog

All notable changes to LIUMA are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and [Semantic Versioning](https://semver.org/).

---

## [1.0.0] – 2026-06-01

### Added
- **Permissions page extended** – Calendar, Events, Uniforms, Discounts, Emergency Alerts, and Absences are now included in the resource permission matrix (affects all tenants).
- **Member default template** – New "Plantilla Miembro (Por Defecto)" pre-fills all permissions to `false`, requiring the admin to grant access explicitly. Admin template retains all permissions as `true`.
- **Tenant smoke dataset** – Reproducible seed with small/medium/complex school profiles covering edge cases (pending/suspended users, overdue charges, low-contrast logos).
- **Owner onboarding fail-fast** – `validateAdminTenantCreator` pre-validates that non-owner users cannot select the ADMIN role during school creation when `VITE_OWNER_EMAIL` is set, returning a deterministic `FORBIDDEN` error before any backend write (PR #82).
- **Lazy page loading** – All route pages are now loaded with `React.lazy` and wrapped in `Suspense`, reducing initial bundle size and improving time-to-interactive (PR #78).

### Changed
- **Lumi chat viewport safety** – Chat sheet uses `100dvh` and `visualViewport` API for keyboard-inset compensation; safe-area insets applied for notched/landscape devices (PR #79).
- **Mobile hook initialisation** – `useIsMobile` now reads initial state directly from `window.matchMedia(...).matches` to eliminate the first-paint flash between desktop and mobile layouts (PR #81).
- **Global CSS scoped** – Touch-target and iOS zoom-prevention rules moved from global element selectors to opt-in utility classes (`mobile-touch-target`, `mobile-input-no-zoom`), applied explicitly to LumiChat and PageHeader (PR #80).
- **UX Phase 1 improvements** – Shared `Button` minimum height raised to `h-11` (44 px) for touch-target compliance; `EmptyState` and `RouteAccessDenied` migrated to semantic Tailwind tokens; Lumi quick-action panel is now role-aware (PR #70).
- **Base44 packages updated** – `@base44/sdk` and `@base44/vite-plugin` bumped to latest compatible versions (commit `0a25362`).

### Fixed
- **SSR safety in useIsMobile** – All `window` references now guarded inside `useEffect` and the lazy state initialiser to prevent crashes in SSR or test environments.
- **LumiChat message list scrolling** – Added `min-h-0` to the flex messages pane so the list can shrink and scroll when the on-screen keyboard is open.

### Security
- **Dependency audit run** – 26 vulnerabilities identified (1 critical, 12 high, 13 moderate). Safe non-breaking fixes applied via `npm audit fix`. Remaining issues tracked in the Security Audit Report (2026-06-01).
- **Onboarding ADMIN gate** – Non-owner users are now blocked from ADMIN tenant creation at the JS layer before any entity write.

### Documentation
- Production launch decision recorded (`docs/go-decision-2026-05-19.md`) – FULL GO after Sprints 1-3 completion with blocker/high = 0.
- Five-gate status page published (`docs/one-page-gate-status-2026-05-19.md`).
- Ops health & governance review cadences defined (`docs/ops-health-and-governance-review-2026-05-19.md`).
- E2E role/route validation matrix report added (`docs/e2e-role-route-validation-2026-05-19.md`).
- UX Phase 1 report published (`docs/ux-report-phase1-2026-05-19.md`).
- Security audit report published (`docs/security-audit-2026-06-01.md`).
- User manual published (`docs/user-manual.md`).

---

## [0.9.0] – 2026-05-19

### Added
- **Release gate validation** – Five gates (Security, Owner/Admin, Core Flows, UX, Ops) evaluated and documented (PR #76).
- **Ops review cadences** – Daily, weekly, and biweekly governance checklists with mandatory postmortem policy for blocker/high incidents (PR #75).
- **Launch gate re-run artifact** – Post-remediation gate re-run decision recorded as LIMITED GO (PR #63).

### Changed
- **Final rollout decision promoted to FULL GO** after Sprints 1-3 confirmed complete and all blocker/high severity items resolved (PR #73).

---

## [0.8.0] – 2026-05-18

### Added
- **Comprehensive RBAC policy engine** – `policy.js` with tenant-scoped, classroom-scoped, and student-scoped access control; row-level filtering; owner override mechanism; per-user-profile overrides.
- **Route access control** – 41 routes mapped to allowed roles with default-deny; owner override fallback; access-denied audit logging.
- **Audit logging system** – Structured audit events for policy decisions, permission changes, owner overrides, and access denials; PII masking in context.
- **Observability & alerting** – Alert rules for repeated owner-denied events and tenant creation failure rates; on-call routing.
- **Multi-tenant theming** – Per-school color palettes with contrast validation and semantic token preservation.
- **Lumi AI integration** – 50+ intent catalog; capability-based response envelope; role-aware quick actions.
- **Notification service** – Email, SMS, and in-app delivery with 3-retry mechanism and failure logging.
- **Tenant onboarding flow** – School creation wizard with owner provisioning, subscription setup, and setup guide seeding.
- **Payments & subscriptions** – Stripe integration for payment processing; subscription status checks; payment reminder banner.
- **Emergency alerts** – AlertaEmergencia page for school-wide emergency broadcasts (admin only).
- **Uniform orders** – PedidosUniformes for parents, GestionPedidosAdmin for admins.
- **Approval workflows** – Maker-checker for role changes and high-risk permission rollbacks.
- **Danger zone operations** – Controlled delete/suspend/reset/transfer with explicit confirmation and audit trail.
- **Deno permission policy** – TypeScript mirror of the JS RBAC engine for edge function authorization.
- **CI pipeline** – GitHub Actions workflow for Deno format, lint, and test checks.

### Fixed
- Owner identity conflict detection when both email and user ID are configured.
- Cross-tenant access denial with structured reason codes.
- Inactive profile access guard in GuardedRoute.

---

## [0.1.0] – 2026-04-01

### Added
- Initial Base44 scaffold with React 18, Vite 6, Tailwind CSS 3, and shadcn/ui component library.
- Core educational entities: School, Classroom, Student, UserProfile, Attendance, Homework, DiaryEntry, Notice.
- Basic role routing: Admin, Teacher, Parent home screens.
- Base44 SDK integration for entity CRUD and authentication.
