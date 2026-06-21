# LIUMA Changelog

All notable changes to LIUMA are documented here.
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Security

- **C3 — RLS no longer trusts the self-grantable `is_super_admin` flag**: that
  field is undeclared and self-writable by any school admin, yet `School` and
  `SchoolSubscription` RLS used it to grant cross-tenant read/write/delete. All
  `is_super_admin` branches were removed; the real ACACIA owner retains access
  via the base44 account role (`role: admin`), which tenants cannot self-assign.
- **C4 — `SchoolSubscription` writes are now owner-only**: a school admin could
  set their own `subscription_status`/`license_tier`/expiry to bypass the
  paywall and read-only write-guard. `update`/`delete` RLS is restricted to the
  platform owner (`role: admin`); tenant admins keep read access. The only field
  a tenant admin legitimately wrote there — `welcome_message_shown` — moved to
  the self-writable `UserProfile`, so the admin-only trial welcome modal still
  works (now tracked per-user instead of per-school). Covered by
  `tests/unit/rls-super-admin-hardening.test.js` and
  `tests/unit/rls-subscription-owner-only.test.js`.

### Fixed

- **Accessibility sweep (round 2) — icon-only controls and reduced motion**:
  every icon-only button flagged by the navigation audit now has a Spanish
  `aria-label` so screen-reader users know what it does — the app-wide
  `PageHeader` back button ("Volver"), calendar month navigation ("Mes
  anterior"/"Mes siguiente") and event delete ("Eliminar evento"), the Avisos
  filter toggle, the Bitácora day navigation, the uniform-order remove-item
  button, and the emergency-contact delete button. The arrow glyphs in the
  calendar month nav are now `aria-hidden`. `EmptyState` now respects
  `prefers-reduced-motion` like the rest of the app's animated chrome. Covered
  by `tests/unit/icon-button-a11y.test.js`.

## [1.1.0] - 2026-06-21

### Added

- **In-app User Manual (`USER_MANUAL.md`)**: a truthful, role-organized manual
  generated from the actual application — every page in `src/pages/` with its
  route and who can access it (cross-referenced against
  `src/lib/authorization/routeAccess.js`), the core data entities, and a
  corrected description of the Lumi AI assistant. Notably corrects the prior
  claim that Lumi "only provides information": per `base44/agents/lumi.jsonc`,
  Lumi can **create `DiaryEntry` and create/update `Attendance`** in the teacher
  dictation flow.
- **Security audit (`docs/security-audit-2026-06-21.md`)**: a documented audit of
  the authorization layer and base44 RLS, ranking findings by whether RLS
  actually backs each client-side check. Captures four Critical server-side
  privilege-escalation paths (self-elevation to ADMIN, self-grant of the
  cross-tenant `is_super_admin` flag, self-activation of `SchoolSubscription`,
  and self-approval of `PendingChange`) with concrete remediation. These RLS
  changes are intentionally **not** auto-applied — they require staged review.
- **`VERSION_CONTROL.json`**: a versioning manifest describing the build
  architecture, page/entity/test inventory, roles, and quality gates.

### Fixed

- **Audit-trail integrity — `AuditLog.action` enum completed**: the enum listed
  only 12 operational actions, but the code emits ~20 more, including the
  security-critical `PERMISSION_CHANGE`, `POLICY_DECISION`, `owner_override`,
  `access_denied`, and the `ROLE_CHANGE*` family (from `src/lib/audit.js`,
  `GuardedRoute.jsx`, `PermisosRoles.jsx`). If base44 enforces the enum, those
  audit writes were failing silently, leaving security events untraced. The enum
  now covers every action string the app writes, guarded by
  `tests/unit/audit-action-enum.test.js`.
- **Scroll position resets on navigation**: navigating from a long dashboard into
  a deep page (or back) preserved the previous scroll offset, landing users
  mid-page. `App.jsx` now resets scroll to the top on every route change
  (`ScrollToTopOnNavigate`).
- **404 page no longer hard-reloads the app**: the "go home" control used
  `window.location.href = '/'` (a full page reload that drops the SPA, router
  state, and React Query cache). It now uses a client-side `<Link to="/">`. The
  page copy was also translated to Spanish (`Página no encontrada` / `Ir al
  inicio`) and the build-tooling hint is gated to development only.
- **Login redirect moved out of render**: `AuthenticatedApp` called
  `navigateToLogin()` directly in the render body (a side effect during render
  that can double-fire under StrictMode/concurrent rendering); it now runs in a
  `useEffect`.
- **Screen-reader badge counts on home tiles**: `BigTile`'s accessible name now
  folds in the pending count (e.g. "Avisos, 3 pendientes") instead of exposing
  only the title.

### Changed

- **Paywall master-switch documentation corrected**: `useFeatureGate.js` and
  `featureGates.js` comments described `VITE_PAYWALL_GATING_ENABLED` as
  off-by-default, but the code (`!== 'false'`) is **on-by-default**. The docs now
  match the code; whether on-by-default is the intended billing behavior is
  flagged for the owner in the security audit (no runtime behavior was changed).

### Added (1.0.x → 1.1.0 carried from prior unreleased work)

- **Distinctive visual design system ("the school is the hero")**: replaced the
  stock shadcn starter palette with a warm, calm surface system and a real type
  pairing — **Bricolage Grotesque** (display, used on page-level headings only)
  + **Inter** (body), loaded via `index.html` and exposed as `--font-display` /
  `--font-sans`. The tenant's own brand color is now the single loud element:
  the three home dashboards (parent/teacher/admin) lead with a branded greeting
  band and their tiles are grouped into labeled sections instead of an
  undifferentiated rainbow stack. New shared chrome in
  `src/components/home/HomeChrome.jsx` (`HomeHeader`, `HomeSection`). Reduced
  motion is now respected (global CSS floor + `useReducedMotion` in `BigTile` /
  `PageHeader`), and the app is titled **liuma**.

- **Onboarding privacy consent (LFPDPPP)**: the final onboarding step now
  requires two explicit acceptances before an account can be created — the
  **Aviso de Privacidad** (general) and **express consent for processing minors'
  sensitive data** (blood type, allergies, medical notes), with role-specific
  wording for parents vs. staff. The accepted notice version, scopes, timestamp,
  and user agent are persisted best-effort to a new `ConsentRecord` entity and,
  as a durable fallback, to `AuditLog` (`PRIVACY_CONSENT_ACCEPTED`) — so consent
  is recorded even before the entity exists in Base44. New pure module
  `src/lib/consent/privacyNotice.js` (+4 tests, 115 total). Publish the real
  Aviso de Privacidad and set `PRIVACY_NOTICE_URL` / `PRIVACY_NOTICE_VERSION`.

### Fixed

- **Home navigation tiles are now keyboard operable**: `BigTile` — the primary
  navigation control on every home dashboard (parent/teacher/admin) — rendered
  its non-link variant as a bare `<div role="button">` with no key handler, so
  Enter/Space did nothing and keyboard/AT users could not activate it. It now
  handles Enter/Space (with `preventDefault`), exposes an `aria-label` from its
  title on both the link and button branches, and shows a `focus-visible` brand
  ring — matching the accessible day-cell pattern already used in
  `CalendarioEscolar`. Covered by `tests/unit/bigtile-a11y.test.js`.

- **White-label theming now actually reaches the UI**: every shadcn component
  reads `--primary`, but `Layout.jsx` hardcoded it to indigo (`99 102 241`) as
  an RGB triple fed into Tailwind's `hsl(var(--primary))` — invalid CSS that
  disconnected each school's logo-extracted brand color from buttons, rings,
  badges, etc. `buildThemeCssVars` now derives `--primary`/`--ring`
  (HSL triplet), `--primary-foreground` (contrast-aware), and an RGB-channel
  `--tenant-primary-rgb` from the tenant palette, surfaced as a first-class
  Tailwind `brand` color so brand tints (`bg-brand/10`, `border-brand/40`)
  compile correctly. The stale `--primary` override was removed from `Layout`.

### Changed

- **Support owner detection hardened**: the cross-tenant support queue
  (`SoporteAdmin`) no longer depends solely on `UserProfile.is_super_admin` —
  which a live schema check (app `696e967c…`) showed is not a field on the
  deployed `UserProfile`. Ownership now also falls back to the authenticated
  Base44 `User.role === 'admin'` via a new pure helper
  `src/lib/support/owner.js` (`isPlatformOwner`), covered by 3 new tests (111
  total). `listQueueTickets` takes an explicit `isOwner` flag.

### Documentation

- **`docs/base44-entity-setup.md`**: copy-paste runbook (AI-chat prompt +
  manual field/RLS tables) to create the `SupportTicket` / `SupportTicketMessage`
  entities in the Base44 Builder, which a live entity-list check confirmed do
  not exist yet.

### Added

- **Support desk (two-tier help desk)**: parents, teachers and directors can now
  get help from inside the app.
  - **L0 — Lumi deflection**: a new `SUPPORT_REQUEST` Lumi capability answers
    common questions from the user manual before any ticket is created.
  - **L1 — ticketing**: when the AI can't help, a `SupportTicket` is opened with
    a human-friendly number (`LIUMA-2026-000042`), an SLA deadline, and a
    threaded conversation. Two-tier routing sends school questions to the
    requester's **director** and app/billing issues to the **platform owner**;
    a director's own tickets go to the owner.
  - **SLA (relaxed)**: first-response targets in business days — URGENT 1, HIGH 2,
    NORMAL 3, LOW 5. The clock stops at the first staff reply; the management
    console flags breaches.
  - **Consoles**: requester view (`Soporte`, all roles) and management queue
    (`SoporteAdmin`, ADMIN — owner sees all tenants) with status state machine,
    priority filters, and email + in-app notifications on escalation, reply and
    resolution.
  - **Authorization & audit**: `SupportTicket` / `SupportTicketMessage` added to
    the policy matrix and route-access map; ticket create/message/status changes
    are written to `AuditLog`.
  - **Backend dependency**: requires the `SupportTicket` and `SupportTicketMessage`
    Base44 entities (schemas + RLS documented in `docs/support-system.md`) to be
    created before go-live. App, lint and the test suite (108 tests) are green.

### Removed

- **Stripe dependencies removed**: `@stripe/react-stripe-js` and `@stripe/stripe-js`
  were listed in `package.json` but never imported anywhere in `src/` — the payments
  pages only read and display `ChargeItem` records, with no card-processing flow.
  Payment collection is handled through Mercado Pago, so the unused Stripe packages
  were dropped to slim the dependency tree and avoid implying a Stripe integration
  exists. No application code changed; the full 87-test suite and build remain green.

---

## [1.0.8] - 2026-06-15

### Documentation

- **Authorization matrix corrected**: The open-gaps table still listed "No automated Node.js CI pipeline | High | Open" even though that gap was closed in v1.0.7 by adding `.github/workflows/ci-node.yml`. Updated to "Fixed (v1.0.7)".
- **New security finding documented**: `esbuild` ≤ 0.28.0 (GHSA-gv7w-rqvm-qjhr) — Missing binary integrity verification in Deno module enables RCE via `NPM_CONFIG_REGISTRY`. This is a build-tool supply-chain advisory; the deployed runtime is not directly exposed. The upstream fix requires upgrading to vite ≥ 8 (a breaking major-version change). Risk accepted and deferred — documented in the authorization matrix open-gaps table and in this changelog.
- **Version metadata synchronised**: `docs/authorization-matrix.md` header and `docs/user-manual.md` header updated from 1.0.6 to 1.0.8 to match `package.json`.

### Security — CI / Build toolchain

- **`esbuild` GHSA-gv7w-rqvm-qjwr** (High — build toolchain only): `esbuild` ≤ 0.28.0 ships a Deno entry-point that performs binary downloads without integrity verification, enabling RCE if `NPM_CONFIG_REGISTRY` is pointed at a malicious registry during `npm install`. This affects only the build and CI environment, not the deployed application bundle. Mitigation: CI runs only on GitHub-hosted runners against the pinned `package-lock.json`; no custom registry is configured. The upstream fix (vite ≥ 8) is a breaking major-version change — deferred to the next planned dependency-update cycle.

---

## [1.0.7] - 2026-06-08

### CI / Tooling

- **Automated Node.js CI pipeline added** (`.github/workflows/ci-node.yml`):
  closes the release-readiness gap where the JavaScript/React frontend had no
  automated checks (only the Deno backend was covered by `ci-deno.yml`). The new
  workflow runs on every push and pull request and executes `npm ci`,
  `npm run lint`, `npm test` (the full 87-test suite), and the
  `npm run release:gate` permission gate on Node 22.

### Notes on deferred items

- **Security headers** (CSP / X-Frame-Options / Permissions-Policy) remain a
  host-level concern: LIUMA is served from the Base44 edge, so these headers
  cannot be enforced from the application repository and must be configured on
  the hosting platform.
- **`react-quill` / `quill` moderate advisory** remains an accepted, documented
  risk: the only fix offered by `npm audit` is a breaking downgrade, and the rich
  text editor is restricted to admin/teacher roles.

## [1.0.6] - 2026-06-08

### Documentation

- **Authorization matrix corrected**: `/Asistencia` route was incorrectly listed
  as PARENT-only in `docs/authorization-matrix.md`. The route access code
  (`routeAccess.js`) and the page itself (`Asistencia.jsx`) confirm it is
  accessible to both TEACHER and PARENT roles — teachers use it to record daily
  attendance; parents use it to view their children's records. Fixed the matrix
  and updated `docs/user-manual.md` to match.
- **Authorization matrix extended**: Added the four entities introduced in RLS
  hardening rounds 2–4 that were previously undocumented in the matrix:
  `OfficialDocument`, `NoticeDelivery`, `PendingChange`, and `PermissionOverride`.
- **Version metadata synchronised**: `package.json` was stuck at `1.0.1` while
  the CHANGELOG progressed through four security-hardening releases (1.0.2–1.0.5).
  All version references — `package.json`, `docs/authorization-matrix.md`, and
  `docs/user-manual.md` — are now aligned at 1.0.6.
- **Owner identity note added**: The authorization matrix now records that
  `VITE_OWNER_EMAIL` / `VITE_OWNER_USER_ID` are no longer embedded in the client
  bundle (fixed in v1.0.5 / PR #90). Owner status is derived from the
  server-persisted `UserProfile.is_super_admin` flag.

## [1.0.5] - 2026-06-04

### Security

- **RLS hardening round 4 (Base44 entity schemas)**: addressed 1 critical finding
  from a follow-up Base44 security scan. See
  `docs/rls-hardening-2026-06-04-round4.md`.
  - `OfficialDocument`: `read` is now limited by `target_audience` and role
    (admins all; teachers `TODOS`/`MAESTROS`; parents `TODOS`/`PADRES`) instead
    of being readable by any user in the school. `UNIFORM_CATALOG` documents stay
    readable by all in-school roles so the parent uniform-ordering flow keeps
    working regardless of the catalog's audience tag. `create`/`update`/`delete`
    remain admin-only.

## [1.0.4] - 2026-06-04

### Security

- **RLS hardening round 3 (Base44 entity schemas)**: addressed 2 further critical
  findings from a follow-up Base44 security scan. See
  `docs/rls-hardening-2026-06-04-round3.md`.
  - `ChargeItem`: restricted `update` back to school admins only. The round-2
    parent-update branch had no field restriction, so a parent could have
    modified financial fields (e.g. `amount`); admin-only update closes that hole.
    `src/pages/Pagos.jsx` no longer writes `OVERDUE` from the parent view — the
    "Vencido" state was already derived locally from `due_date`, so the now-
    unauthorized write was removed with no UI change for parents.
  - `NoticeRead`: added `school_id` and scoped `create`/`read` to the user's own
    tenant (was keyed on `user_id` only), preventing cross-tenant read-receipts.

## [1.0.3] - 2026-06-04

### Security

- **RLS hardening round 2 (Base44 entity schemas)**: addressed 8 more critical
  row-level security findings plus 2 ChargeItem authorization failures from a
  follow-up Base44 security scan. See `docs/rls-hardening-2026-06-04-round2.md`
  for the full per-entity record.
  - `DiaryEntry`, `Homework`: removed role-only read branches that let any
    teacher or parent read every row; reads are now scoped to assigned
    classrooms (teacher) and linked students/classrooms (parent).
  - `Event`: made the admin read branch explicit (admins read all school events).
  - `SchoolSubscription`: scoped `update`/`delete` to the school's own admin
    (was platform-`admin`-only and not tenant-scoped), restoring cross-tenant
    isolation.
  - `ChargeItem`: allowed parents to create `EVENTO` charges for their linked
    students and to update their children's charges (unblocks event-charge
    creation in `EventosParaPadres.jsx` and `PENDING→OVERDUE` updates in
    `Pagos.jsx`).
  - `NoticeDelivery`, `PendingChange`, `PermissionOverride`: formalized these
    previously schema-less (and RLS-less) entities with strict rules — own/
    teacher-classroom/admin reads for deliveries; admin-only for the other two.

## [1.0.2] - 2026-06-04

### Security

- **RLS hardening (Base44 entity schemas)**: addressed 9 critical row-level
  security findings from the Base44 security scan. See
  `docs/rls-hardening-2026-06-04.md` for the full per-entity record.
  - `ChargeItem`: removed an unscoped parent read branch that exposed every
    charge in the school; parents now read only their linked students' charges.
  - `UserProfile`: restricted reads to the owner and school admins; removed a
    malformed teacher branch that exposed all profiles in the school.
  - `SchoolSubscription`: restricted reads to school admins; removed the create
    rule so onboarding is not blocked.
  - `Classroom`, `Student`, `Notice`, `Event`: added explicit role + tenant
    validation on teacher/parent read branches; parents can now read their
    children's classroom events.
  - `AuditLog`: restricted create to admins and teachers within their school.
  - `School`: removed the create RLS rule; tenant creation is handled by the
    onboarding backend flow.
- Documented the two outstanding HTTP security-header recommendations
  (`X-Frame-Options`, `Permissions-Policy`) as host-level (Base44 edge)
  configuration. See `docs/rls-hardening-2026-06-04.md`.

---

## [1.0.1] - 2026-06-02

### Security

- Removed PII (actor email) from browser console output in access-denied audit events. Audit data continues to be persisted to the AuditLog entity; only the browser-console log was trimmed. The console now logs only `event`, `route`, and `reason`, and only in development mode.
- Applied all safe dependency updates via `npm audit fix`. Reduced npm vulnerability count from 26 to 2.
- Documented `requiresAuth: false` SDK setting to clarify that auth enforcement is handled by the Base44 backend and the app's `GuardedRoute` layer — not suppressed.

### Known open issues

- `react-quill` (rich-text editor) depends on `quill ≤ 1.3.7` which has a moderate XSS advisory. A fix requires a breaking upgrade to a different editor; deferred to a future release. Risk is reduced because the rich-text editor is accessible to authenticated admin and teacher users only.

---

## [1.0.0] - 2026-06-01

### Added

- **Multi-role access control**: ADMIN, TEACHER, PARENT roles enforced at route and entity level.
- **Tenant isolation**: every data query is scoped to `school_id` from the authenticated user profile.
- **GuardedRoute**: declarative route-level access guard enforcing ROUTE_ACCESS matrix.
- **Policy engine** (`src/lib/authorization/policy.js`): entity-level read/write decisions with row-level filtering for TEACHER (classroom) and PARENT (student).
- **Permission overrides**: admins can grant or deny per-resource permissions to individual user profiles via the Permissions & Roles page.
- **Admin safety**: self-permission changes and last-admin removal are blocked.
- **Tenant danger zone**: high-risk operations (delete tenant, reset data, transfer ownership) require second admin approval and explicit reason text.
- **Lumi AI assistant**: school-scoped AI chat for ADMIN, TEACHER, and PARENT roles with capability-level access control. PARENT access is further scoped to their linked students.
- **Onboarding flow**: school/tenant creation for ADMIN role; join-by-code flow for TEACHER and PARENT; pending approval for non-admin registrations.
- **Audit log**: all permission changes, access denials, AI interactions, and owner-override events are persisted to AuditLog.
- **Notification service**: in-app and email notifications with per-school and per-user channel preferences.
- **School subscription / trial management**: 30-day trial on new tenant creation; payment reminder banners and suspended account modal.
- **Emergency alerts**: school-wide urgent notice creation (ADMIN only).
- **Absence management**: absence requests by parents and admins, managed by ADMIN and TEACHER.
- **Attendance tracking**: daily attendance records per classroom; summary view for ADMIN and TEACHER.
- **Homework**: homework assignments created by TEACHER and ADMIN; visible to PARENT via their students' classrooms.
- **Daily diary (bitácora)**: diary entries per student created by TEACHER; visible to linked PARENT.
- **Notices / circulars**: scoped to SCHOOL, CLASSROOM, or STUDENT level.
- **Uniform orders**: parents can place uniform orders; ADMIN manages and fulfills orders.
- **Discounts**: ADMIN manages discount records per student.
- **School calendar**: shared calendar for school events (ADMIN, TEACHER, PARENT).
- **Events for parents**: event listings visible to PARENT.
- **Documents**: ADMIN-managed school document repository.
- **Payments**: per-student charge items with payment records; parent payment view.
- **Reports**: ADMIN-only consolidated reporting.
- **Tenant theme**: per-school color theme with contrast auto-correction.
- **Mobile layout**: viewport-safe layout with mobile touch-target optimizations.
- **Lazy-loaded pages**: all page components are lazy-loaded with Suspense fallback to reduce initial bundle size.

---

## [0.x] — Pre-release development

Internal development iterations prior to the 1.0.0 production launch milestone. Not publicly versioned.
