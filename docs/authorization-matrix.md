# Authorization Matrix

**Last updated: 2026-09-29 · Version 1.7.17** (route matrix and consent rows; entity section unchanged since 2026-07-13)

This matrix is the authoritative reference for LIUMA role-based access control. It reflects the code in `src/lib/authorization/routeAccess.js` and `src/lib/authorization/policy.js`. Any change to access control must be reflected here.

---

## Route-access matrix

Source of truth: `src/lib/authorization/routeAccess.js → ROUTE_ACCESS`, enforced
by `GuardedRoute.jsx`. The platform owner reaches every ADMIN route through the
owner override (`getOwnerScopedAccess`), not through this table.

**This table is checked by a test.** `tests/unit/help-and-legal.test.js` parses
every `| /Route |` row below and fails if the set of routes, or the roles on any
of them, differs from `ROUTE_ACCESS`. The previous version of this document had
drifted (it was missing `/HistorialCambios` and `/SeedTestData`), so when you
change `routeAccess.js`, change the row here in the same commit.

| Route | ADMIN | TEACHER | PARENT | Description |
|---|---|---|---|---|
| /AlertaEmergencia | ✓ | — | — | Emergency alert broadcast |
| /Aprobaciones | ✓ | — | — | User approval queue |
| /Asistencia | — | ✓ | ✓ | TEACHER records attendance for assigned classrooms; PARENT views their children's history |
| /AuditoriaAdmin | ✓ | — | — | Audit log viewer |
| /Avisos | — | — | ✓ | Notices for linked children |
| /AvisosAdmin | ✓ | — | — | School-wide / classroom / student notices |
| /AvisosMaestro | — | ✓ | — | Teacher notice to classroom parents |
| /Ayuda | ✓ | ✓ | ✓ | In-app user manual: primeros pasos + role quick guides (static content, no tenant data) |
| /Bitacora | — | — | ✓ | Diary entries for linked children |
| /BitacorasMaestro | — | ✓ | — | Diary progress for assigned classrooms |
| /CalendarioEscolar | ✓ | ✓ | ✓ | School calendar (admin edits) |
| /ConfiguracionInicial | ✓ | — | — | Initial school setup checklist |
| /ContactosEmergencia | — | — | ✓ | Emergency contacts per child (drill-down from Mis hijos). ADMIN grant removed 2026-09-29: no entry point, page scopes by the caller's ParentStudent links |
| /CrearBitacora | — | ✓ | — | Create diary entry (4-step wizard) |
| /EventosParaPadres | — | — | ✓ | School events: RSVP (accepting a paid event creates a ChargeItem) |
| /GestionAlumno | ✓ | ✓ | — | Student detail + linked guardians ("Vincular"). ADMIN reaches it from Gestión de escuela (added 2026-09-29) |
| /GestionAusencias | ✓ | — | — | Absence review (approve/reject) — school-wide; TEACHER grant removed 2026-09-29 (no entry point) |
| /GestionDescuentos | ✓ | — | — | Discount management |
| /GestionDocumentos | ✓ | — | — | Official documents |
| /GestionEscuela | ✓ | — | — | Classrooms + students (license quota) |
| /GestionPedidosAdmin | ✓ | — | — | Uniform order fulfillment |
| /GestionSalon | ✓ | ✓ | — | Classroom: teachers + enrolled students. Assigning/removing teachers is ADMIN only |
| /HistorialCambios | ✓ | ✓ | ✓ | Plain-language changelog + version |
| /Home | ✓ | ✓ | ✓ | Dashboard (role-specific home component) |
| /LicenseAdmin | ✓ | — | — | License: school admin sees own school read-only; platform owner manages all tenants via owner override |
| /MisHijos | — | — | ✓ | Linked children profiles |
| /OperacionDiaria | ✓ | ✓ | ✓ | Daily operations timeline |
| /Pagos | — | — | ✓ | Payment view for the parent's own children (admin equivalent: PagosAdmin) |
| /PagosAdmin | ✓ | — | — | Payment concepts, charges and payments |
| /PanelSoporte | ✓ | — | — | Support triage dashboard |
| /PedidosUniformes | — | — | ✓ | Uniform order submission (admin equivalent: GestionPedidosAdmin) |
| /PermisosRoles | ✓ | — | — | Roles, per-user overrides, danger zone (export / deletion request) |
| /Reportes | ✓ | — | — | School reports + export |
| /ResumenAsistencia | ✓ | — | — | Attendance summary — school-wide; TEACHER grant removed 2026-09-29 |
| /SeedTestData | — | — | — | Developer test-data generator. No school role: `PLATFORM_OWNER_ROUTES`, only Base44 `user.role === 'admin'` (checked before the owner override) |
| /SolicitarAusencia | — | — | ✓ | Absence request submission (admin equivalent: GestionAusencias) |
| /Soporte | ✓ | ✓ | ✓ | Help desk: Lumi + ticket creation and tracking |
| /SoporteAdmin | ✓ | — | — | Support ticket console (school admin: own school; platform owner: all via owner override) |
| /Tarea | — | — | ✓ | Homework for linked children |
| /TareaMaestro | — | ✓ | — | Homework management (teacher) |

### Public / unauthenticated routes

Not in `ROUTE_ACCESS` and not wrapped by `GuardedRoute`. None of them read an
entity, so none can leak tenant data.

| Route | Description |
|---|---|
| /login | Branded email/password sign-in form. Reachable only when `AuthenticatedApp` has no session and no remembered identity; authenticated users are redirected to `/` (`src/App.jsx`). |
| /aviso-de-privacidad | LIUMA Aviso de Privacidad (`PRIVACY_NOTICE_PATH`). **Public on purpose**: the onboarding consent checkbox links here and the reader has no `UserProfile` yet, so a guarded route would deny them the text they are asked to accept. Rendered by the top-level `<Routes>` in `src/App.jsx` *before* `AuthenticatedApp`. Currently a **BORRADOR pending legal review** (`PRIVACY_NOTICE_STATUS`). |
| /terminos | LIUMA Términos del servicio (`SERVICE_TERMS_PATH`) — trial, plans, read-only on non-payment, data processing on the school's behalf. Same public mount and same BORRADOR status. |

> P3's route changes (ADMIN on `/GestionSalon` and `/GestionAlumno`, `/SeedTestData`
> platform-owner only, unreachable grants trimmed) are reflected above since the
> 2026-09-29 integration.

---

## Entity authorization

Source of truth: `src/lib/authorization/policy.js → POLICY`

> **Caveat (2026-09-28 audit):** this table is the *client* policy. The
> deployed Base44 RLS is currently narrower — most entities only let the row's
> author or the platform `role: admin` read them — so several "Read" cells
> below do not hold in production for school users yet. Fixing the tenant read
> path (service-role read functions keyed on the caller's ACTIVE `UserProfile`)
> is a separate package (P10); update this table when it lands.

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

> **2026-07-13 audit note (accepted risk, pending product decision):**
> 1. `evaluateCapabilityAccess` short-circuits to `{allowed:true}` when no
>    structured `intent` is set (`capabilities.js:73`), which is the case for
>    LumiChat's free-text messages. Row-level Base44 RLS on every entity Lumi
>    can touch (keyed off the server-verified session, not client input) is
>    the sole enforcement backstop for that path — verified adequate for
>    school/classroom/student scoping, but that path is not currently logged
>    with the same `policy_decision` detail as the structured intents.
> 2. The dictation-based `DiaryEntry.create` / `Attendance.create`+`update`
>    writes commit as soon as the agent decides to call the tool — there is
>    no separate "review before saving" step in `LumiChat.jsx`; the teacher's
>    dictated message is the only confirmation. This is long-standing,
>    intentional product behavior (voice-driven bitácora creation), not a new
>    regression, and rows remain scoped to the teacher's assigned classroom.
>
> Neither point allows cross-school, cross-classroom, or cross-family
> exposure. Recommendation for a future release: add `policy_decision`
> audit logging to the free-text path, and a lightweight post-save
> confirmation/undo affordance for dictation writes. Owner sign-off needed
> before changing this live workflow.

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
| `react-quill` XSS (quill ≤ 1.3.7) | Moderate | **Closed (v1.6.1)** — dependency found unused in source; removed from `package.json`. `npm audit` reports 0 vulnerabilities. |
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
| C1 — Escalation to ADMIN via direct `UserProfile.update` (in fact reachable by *any* user via the self-branch, not only admins) | Critical | **Closed (v1.6.0) — deploy verified live 2026-07-13.** Field-level RLS locks `UserProfile.app_role` `write` to the service role; role mutations go through `governRoleChange`, and onboarding's initial role assignment through `provisionOnboardingProfile` (founder-only ADMIN). v1.5.0 first moved the UI path server-side. Re-confirmed via direct comparison of `base44/entities/UserProfile.jsonc` against the live Base44 schema (`list_entity_schemas`) — identical. See `docs/security-role-governance-remediation.md`. |
| C2 — Requester can approve their own `PendingChange` | Critical | **Closed (v1.6.0) — deploy verified live 2026-07-13.** `governRoleChange` enforces approver ≠ requester server-side (v1.5.0), and field-level RLS locks `PendingChange` `status`/`approver_*`/`approved_at` `update` to the service role so an approval can't be forged. Re-confirmed via direct comparison of `base44/entities/PendingChange.jsonc` against the live Base44 schema — identical. See `docs/security-role-governance-remediation.md`. |
| Missing service-role admin branch on `UserProfile`/`PendingChange`/`School`/`AuditLog` broke onboarding and role-approval app-wide (production outage) | Critical | **Fixed (v1.7.0, PR #149) — deploy verified live 2026-07-13.** Restored the `{"user_condition":{"role":"admin"}}` branch that `asServiceRole` calls (`provisionOnboardingProfile`, `governRoleChange`) need to pass row-level RLS; this branch is un-matchable by any real end-user (real users carry built-in `role:"user"`, never `role:"admin"`), so it does not reopen C1/C2 — the field-level locks above are untouched and independently verified live. Confirmed by comparing all four `base44/entities/*.jsonc` files against the live Base44 schema via the Base44 MCP `list_entity_schemas` tool — byte-for-byte match, no drift. |
| `ConsentRecord` entity referenced in code but not created in Base44 | Medium | Open — the entity does not exist live, so `onboardingTenantCreation.js` silently skips it and the only consent trace is a best-effort `AuditLog` row (the 2026-09-28 audit found `AuditLog` empty in production). Creating the entity and writing it server-side belongs to the onboarding package (P6). |
| Consent checkbox linked to a non-existent privacy notice (`/aviso-de-privacidad` on the base44.app host fell to `PageNotFound`) | Critical | **Mitigated 2026-09-29** — the notice now exists as a public in-app route and `PRIVACY_NOTICE_URL` points at it; version bumped to `2026-09-29-borrador`. Still open: the text is a **draft pending legal review** (see the review notes on the page and in `src/lib/legal/legalDocs.js`). |
| Support routes / SupportTicket entity missing from authorization matrix | Low | Fixed (v1.2.0) — Soporte/SoporteAdmin/PanelSoporte/LicenseAdmin routes added; SupportTicket/SupportTicketMessage entities added; support_request Lumi capability added |
| `@babel/core` ≤ 7.29.0 Arbitrary File Read (`GHSA-4x5r-pxfx-6jf8`) | Low | Fixed (v1.4.2) — build-toolchain dependency; not in deployed runtime. Resolved via `npm audit fix`. |
| `dompurify` ≤ 3.4.10 Trusted Types / SAFE_FOR_TEMPLATES / ALLOWED_ATTR bypass (3 Moderate advisories) | Moderate | Fixed (v1.4.2) — transitive build dependency; resolved via `npm audit fix`. |

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
