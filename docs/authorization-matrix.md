# Authorization Matrix

**Last updated: 2026-06-02 · Version 1.0.1**

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
| /PagosAdmin | Payment concept and record management |
| /PermisosRoles | Roles and permissions configuration |
| /Reportes | School reports |

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

### PARENT-only routes

| Route | Description |
|---|---|
| /Asistencia | Child attendance view |
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

---

## Entity authorization

Source of truth: `src/lib/authorization/policy.js → POLICY`

| Entity | ADMIN | TEACHER | PARENT | Row-level scope |
|---|---|---|---|---|
| Notice | Read + Write | Read + Write | Read | school_id; CLASSROOM scope → classroom_id; STUDENT scope → student_id via parent-student link |
| Attendance | Read + Write | Read + Write | Read | school_id + classroom_id (teacher: only assigned classrooms); student_id (parent: only linked students) |
| Homework | Read + Write | Read + Write | Read | school_id + classroom_id (teacher: only assigned classrooms; parent: classrooms of linked students) |
| DiaryEntry | Read + Write | Read + Write | Read | school_id + classroom_id + student_id (teacher: assigned classrooms; parent: linked students) |
| ChargeItem | Read + Write | No access | Read | school_id + student_id (parent: only linked students) |
| PaymentConcept | Read + Write | No access | No access | school_id |
| PaymentRecord | Read + Write | No access | No access | school_id + student_id |

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

Additional AI rules enforced in `evaluateCapabilityAccess`:
- PARENT access is further restricted: if a `student_id` is specified in the request, it must match the user's `linked_students` list.
- Requests without a `school_id` are denied regardless of role.
- All AI interactions (allowed and denied) are logged to AuditLog with capability intent, role, and school scope.

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
| No automated Node.js CI pipeline | High | Open — tests run manually; CI setup deferred |
