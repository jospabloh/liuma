# Authorization Matrix

**Last updated: 2026-06-22 · Version 1.2.0**

This matrix is the authoritative reference for LIUMA role-based access control. It reflects the code in `src/lib/authorization/routeAccess.js` and `src/lib/authorization/policy.js`. Any change to access control must be reflected here.

---

## Route-access matrix

Source of truth: `src/lib/authorization/routeAccess.js → ROUTE_ACCESS`

### ADMIN-only routes

| Route | Description |
|---|---|
| /Aprobaciones | User approval queue |
| /AlertaEmergencia | Emergency alert broadcast |
| /AuditoriaAdmin | Audit log viewer |
| /AvisosAdmin | School notice management |
| /ConfiguracionInicial | Initial school setup |
| /GestionDescuentos | Discount management |
| /GestionDocumentos | Document management |
| /GestionEscuela | School settings |
| /GestionPedidosAdmin | Uniform order fulfillment |
| /LicenseAdmin | School subscription / license management (admin sees own school read-only; platform owner sees all tenants via owner override) |
| /PagosAdmin | Payment concept and record management |
| /PanelSoporte | Support triage dashboard (pending/urgent/SLA breached) |
| /PermisosRoles | Roles and permissions configuration |
| /Reportes | School reports |
| /SoporteAdmin | Support ticket management console (school admin sees own school; platform owner sees all via owner override) |

### TEACHER-only routes

| Route | Description |
|---|---|
| /AvisosMaestro | Teacher notice creation |
| /BitacorasMaestro | View all diary entries (teacher) |
| /CrearBitacora | Create diary entry |
| /GestionAlumno | Student detail (assigned classrooms) |
| /GestionSalon | Classroom management |
| /TareaMaestro | Homework management (teacher) |

### ADMIN + TEACHER routes

| Route | Description |
|---|---|
| /GestionAusencias | Absence management (review/approve) |
| /ResumenAsistencia | Attendance summary |

### TEACHER + PARENT routes

| Route | Description |
|---|---|
| /Asistencia | Attendance control: TEACHER records daily attendance for assigned classrooms; PARENT views their children's attendance records |

### PARENT-only routes

| Route | Description |
|---|---|
| /Avisos | Notices for linked children |
| /Bitacora | Diary entries for linked children |
| /EventosParaPadres | School events listing |
| /MisHijos | Linked children profiles |
| /Tarea | Homework for linked children |

### ADMIN + PARENT routes

| Route | Description |
|---|---|
| /ContactosEmergencia | Emergency contacts |
| /Pagos | Payment view (parent: own children; admin: all) |
| /PedidosUniformes | Uniform order submission |
| /SolicitarAusencia | Absence request submission |

### ADMIN + TEACHER + PARENT routes

| Route | Description |
|---|---|
| /Home | Dashboard (role-specific home component) |
| /OperacionDiaria | Daily operations |
| /CalendarioEscolar | School calendar |
| /Soporte | Help desk: Lumi AI deflection (L0) + ticket creation and tracking (L1) |

---

## Entity authorization

Source of truth: `src/lib/authorization/policy.js → POLICY`

| Entity | ADMIN | TEACHER | PARENT | Row-level scope |
|---|---|---|---|---|
| Notice | Read + Write | Read + Write | Read | school_id; CLASSROOM scope → classroom_id; STUDENT scope → student_id via parent-student link |
| Attendance | Read + Write | Read + Write | Read | school_id + classroom_id (teacher: only assigned classrooms); student_id (parent: only linked students) |
| Homework | Read + Write | Read + Write | Read | school_id + classroom_id (teacher: only assigned classrooms; parent: classrooms of linked students) |
| DiaryEntry | Read + Write | Read + Write | Read | school_id + classroom_id + student_id (teacher: assigned classrooms; parent: linked students) |
| ChargeItem | Read + Write | No access | Read + Create (EVENTO type, linked students only) | school_id + student_id (parent: only linked students) |
| PaymentConcept | Read + Write | No access | No access | school_id |
| PaymentRecord | Read + Write | No access | No access | school_id + student_id |
| OfficialDocument | Read + Write + Delete | Read (audience TODOS or MAESTROS) | Read (audience TODOS or PADRES) | school_id + target_audience; UNIFORM_CATALOG is readable by all roles regardless of audience; create/update/delete admin-only |
| NoticeDelivery | Read + Write + Delete | Read (assigned classrooms) + Create (assigned classrooms) + Update | Read + Update (own deliveries only) | school_id; recipient_user_id (users: own); classroom_id (teachers: assigned classrooms) |
| PendingChange | Admin only | No access | No access | school_id + app_role == ADMIN; all operations restricted to school admins |
| PermissionOverride | Admin only | No access | No access | school_id + app_role == ADMIN; all operations restricted to school admins |
| SupportTicket | Read + Write | Read + Write | Read + Write | school_id + requester_user_id; requesters see own tickets; school admins see all school tickets; platform owner sees all tickets; row-level enforcement in support data layer + Base44 RLS (see docs/support-system.md) |
| SupportTicketMessage | Read + Write | Read + Write | Read + Write | school_id + ticket_id; access tied to ticket access; write permitted for ticket participants only |

---

## AI / Lumi capability authorization

Source of truth: `src/lib/lumi/capabilities.js → CAPABILITY_RULES`

| Capability intent | Underlying entity | Allowed roles | Required scope |
|---|---|---|---|
| homework_lookup | Homework | ADMIN, TEACHER, PARENT | school_id (+ student_id for PARENT) |
| attendance_status | Attendance | ADMIN, TEACHER, PARENT | school_id (+ student_id for PARENT) |
| notices_summary | Notice | ADMIN, TEACHER, PARENT | school_id |
| payment_reminders | ChargeItem | ADMIN, PARENT | school_id (+ student_id for PARENT) |
| behavior_recap | DiaryEntry | ADMIN, TEACHER, PARENT | school_id (+ student_id for PARENT) |
| schedule_appointments | Notice | ADMIN, TEACHER, PARENT | school_id |
| support_request | SupportTicket | ADMIN, TEACHER, PARENT | school_id |

Additional AI rules enforced in `evaluateCapabilityAccess`:
- PARENT access is further restricted: if a `student_id` is specified in the request, it must match the user's `linked_students` list.
- Requests without a `school_id` are denied regardless of role.
- All AI interactions (allowed and denied) are logged to AuditLog with capability intent, role, and school scope.

### Lumi write capabilities

Lumi can perform write operations in the following flows (TEACHER-only dictation flow in CrearBitacora):
- **Create `DiaryEntry`** — teacher dictation flow; scoped to the teacher's assigned classrooms.
- **Create / update `Attendance`** — teacher voice attendance; scoped to the teacher's assigned classrooms.

No other write operations are performed by Lumi. Lumi does not write to payments, permissions, student records, school settings, support tickets, or any other entity.

---

## Granular permission overrides

Source of truth: `src/lib/authorization/overrides.js`; enforced in `PermisosRoles.jsx`

Overrides allow admins to grant or deny access to individual resources beyond the default role policy.

### Configurable resources

Students, Classrooms, Attendance, Homework, Diary, Notices, Payments, Documents, Reports, AI, Audit, Tenant Danger Zone, Calendar, Events, Uniforms, Discounts, Emergency Alerts, Absences.

### Configurable actions per resource

view, add, edit, delete, approve, export, manage_permissions.

### Override precedence (highest to lowest)

1. `explicit_deny` (POLICY explicit deny — cannot be overridden by override_allow)
2. `override_deny` (admin-set deny override)
3. `override_allow` (admin-set allow override)
4. `explicit_allow` (POLICY default allow)
5. `default_deny` (POLICY default deny)

### Safety constraints on overrides

- A user cannot change their own `manage_permissions` setting if they are the only active admin in the school.
- Self-approval of high-risk operations is blocked.

---

## Tenant isolation enforcement

Source of truth: `src/lib/authorization/policy.js` (`assertSameTenant`, `buildTenantScopeGuard`, `applyTenantScopeToQuery`); `src/components/GuardedRoute.jsx`

- All entity queries include `school_id` from the authenticated user's profile.
- `assertSameTenant` is called before any cross-tenant reference is processed.
- `rejectsCrossTenantReference` returns true if source and target school IDs differ.
- GuardedRoute resolves owner access with `actorSchoolId === targetSchoolId` — an owner cannot bypass isolation to access another school.
- **Owner identity (v1.0.5+)**: `VITE_OWNER_EMAIL` and `VITE_OWNER_USER_ID` are no longer embedded in the client bundle. Owner status is derived exclusively from the server-persisted `UserProfile` (`is_super_admin: true`, `app_role: ADMIN`, `status: ACTIVE`) within the target tenant. This prevents client-side owner bypass and bundle leakage of the owner's email/ID.

---

## Parent-student link

For `PARENT`, every `student_id`-scoped query must be derived from active parent-student links (`parent_id = current user profile`, `status = ACTIVE`). This is enforced by:
- `buildScopedFilter` in `policy.js`
- `filterByRowLevel` in `policy.js`
- `evaluateCapabilityAccess` in `lumi/capabilities.js`
- `getLinkedStudents` in `src/lib/relations/getLinkedStudents.js`

---

## Default role templates

| Template | Effect |
|---|---|
| Admin Template | All permissions `true` — scoped to own school only |
| Member Default Template | All permissions `false` — admin must explicitly grant access |

These templates are pre-loaded in `PermisosRoles.jsx` and applied via the permission override system.

---

## Permission matrix — enforcement verification

| Permission check type | Enforced in | Verified |
|---|---|---|
| Route access by role | `GuardedRoute.jsx` + `routeAccess.js` | Yes — unit + integration tests |
| Entity read by role | `policy.js → resolvePolicyDecision` | Yes — unit tests |
| Entity write by role | `policy.js → resolvePolicyDecision` | Yes — unit tests |
| Row-level tenant filter | `policy.js → buildTenantScopeGuard` | Yes — unit tests |
| Row-level teacher classroom filter | `policy.js → filterByRowLevel` | Yes — unit tests |
| Row-level parent student filter | `policy.js → filterByRowLevel` | Yes — unit tests |
| AI capability by role | `lumi/capabilities.js → evaluateCapabilityAccess` | Yes — unit tests |
| AI parent student scope | `lumi/capabilities.js → evaluateCapabilityAccess` | Yes — unit tests |
| Override allow/deny precedence | `policy.js → getEffectivePolicyDecision` | Yes — unit tests |
| Self-permission change blocked | `overrides.js → assertOverrideSafety` | Yes — unit tests |
| Last admin removal blocked | `adminSafety.js → hasOtherActiveAdminWithManagePermissions` | Yes — unit tests |
| Danger zone second-admin approval | `tenantDangerZone.js → evaluateDangerZoneRequest` | Yes — unit tests |
| Cross-tenant denial | `policy.js → assertSameTenant` | Yes — unit + integration tests |

---

## Open permission gaps

| Gap | Severity | Status |
|---|---|---|
| `react-quill` XSS (quill ≤ 1.3.7) | Moderate | Accepted — editor is admin/teacher only; breaking fix deferred |
| No HTTP Content Security Policy headers | Medium | Open — requires hosting/deployment configuration outside app code |
| `X-Frame-Options` / `Permissions-Policy` headers | Medium/Low | Open — host-level (Base44 edge) config; see `docs/rls-hardening-2026-06-04.md` |
| No automated Node.js CI pipeline | High | Fixed (v1.0.7) — `.github/workflows/ci-node.yml` added; runs lint, full 87-test suite, and release gate on every push/PR |
| `esbuild` GHSA-gv7w-rqvm-qjhr (build toolchain) | High | Accepted — build-tool supply-chain advisory; deployed runtime not directly exposed. Upstream fix (vite ≥ 8) is a breaking change; deferred to next planned dependency-update cycle. CI runs only on GitHub-hosted runners with no custom registry configured. |
| `/Asistencia` route listed as PARENT-only in docs | Medium | Fixed (v1.0.6) — corrected to TEACHER + PARENT to match `routeAccess.js` |
| `package.json` version behind CHANGELOG | Low | Fixed (v1.0.6) — synchronized to 1.0.6 |
| Missing entity entries in this matrix | Low | Fixed (v1.0.6) — OfficialDocument, NoticeDelivery, PendingChange, PermissionOverride added |
| `VITE_OWNER_EMAIL` / `VITE_OWNER_USER_ID` in client bundle | High | Fixed (v1.0.5 / PR #90) — owner identity moved to server-persisted UserProfile; env vars removed |
| C3 — `is_super_admin` self-grantable field enabled cross-tenant bypass | Critical | Fixed (v1.2.0 / PR #109) — all `is_super_admin` branches removed from `School` and `SchoolSubscription` RLS; platform owner identified via base44 account `role: admin` which tenants cannot self-assign |
| C4 — `SchoolSubscription` writes were tenant-admin-writeable (paywall bypass) | Critical | Fixed (v1.2.0 / PR #109) — update/delete restricted to platform owner (`role: admin`); tenant admins retain read access; `welcome_message_shown` moved to `UserProfile` (self-writable) |
| C1 — Single admin can self-elevate any profile to ADMIN via direct `UserProfile.update` | Critical | Open — requires a base44 backend function to validate an approved `PendingChange` before applying; naive RLS deny breaks the legitimate flow. See `docs/security-audit-2026-06-21.md`. |
| C2 — Requester can approve their own `PendingChange` | Critical | Open — `update` RLS only checks `school_id + app_role == ADMIN`; approver ≠ requester rule is client-only. Fix requires RLS field check or backend function. See `docs/security-audit-2026-06-21.md`. |
| `ConsentRecord` entity referenced in code but not created in Base44 | Low | Open — `privacyNotice.js` writes consent to `ConsentRecord` best-effort with `AuditLog` as fallback; consent is recorded even before the entity exists. Owner action: create `ConsentRecord` entity in Base44 Builder (schema in `src/lib/consent/privacyNotice.js`). |
| Support routes / SupportTicket entity missing from authorization matrix | Low | Fixed (v1.2.0) — Soporte/SoporteAdmin/PanelSoporte/LicenseAdmin routes added; SupportTicket/SupportTicketMessage entities added; support_request Lumi capability added |

> **2026-06-04 — Backend RLS hardening:** the Base44 entity-schema RLS rules were
> tightened to fix 9 critical findings from the Base44 security scan (ChargeItem,
> UserProfile, SchoolSubscription, Classroom, Student, Notice, Event, AuditLog,
> School). These rules are enforced by the Base44 backend in addition to the
> app-side `policy.js` layer. Full record: `docs/rls-hardening-2026-06-04.md`.
>
> **2026-06-04 — Backend RLS hardening (round 2):** a second Base44 security scan
> flagged 8 more critical RLS issues plus 2 ChargeItem authorization failures.
> Fixed: DiaryEntry/Homework read scoping (removed role-only branches that exposed
> all rows), explicit Event admin read, SchoolSubscription update/delete scoped to
> the school's admin (cross-tenant isolation), ChargeItem create/update opened to
> parents for their linked students (unblocks event-charge creation and
> PENDING→OVERDUE updates), and three previously schema-less, RLS-less entities
> formalized with strict rules: NoticeDelivery (own/teacher-classroom/admin),
> PendingChange (admin-only), PermissionOverride (admin-only). Full record:
> `docs/rls-hardening-2026-06-04-round2.md`.
>
> **2026-06-04 — Backend RLS hardening (round 3):** a follow-up scan flagged 2
> more issues. `ChargeItem.update` was restricted back to admins-only (the
> round-2 parent-update branch allowed financial-field tampering); the parent
> payments view (`Pagos.jsx`) no longer persists `OVERDUE` since the UI derives
> it locally from `due_date`. `NoticeRead` gained a `school_id` field with
> create/read scoped to the user's tenant. Full record:
> `docs/rls-hardening-2026-06-04-round3.md`.
>
> **2026-06-04 — Backend RLS hardening (round 4):** `OfficialDocument.read` was
> limited by `target_audience` + role (admins all; teachers `TODOS`/`MAESTROS`;
> parents `TODOS`/`PADRES`) instead of any-user-in-school, with a carve-out so
> `UNIFORM_CATALOG` stays readable by all in-school roles (parent uniform
> ordering). Full record: `docs/rls-hardening-2026-06-04-round4.md`.
