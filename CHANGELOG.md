# LIUMA Changelog

All notable changes to LIUMA are documented here.
Versions follow [Semantic Versioning](https://semver.org/).

---

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
