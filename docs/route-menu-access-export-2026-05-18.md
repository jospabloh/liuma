# Route, menu, and owner-access export (2026-05-18)

## Assumptions and source of truth

- This export documents the current React route and home-menu configuration; it does not change runtime authorization.
- Page routes are the entries registered in `src/pages.config.js` and mounted by `src/App.jsx` as `/<PageName>`.
- `/` and `*` are included as reserved routes because they are mounted separately from `pagesConfig.Pages`.
- Menu entries are home-screen tiles/actions in `AdminHome`, `TeacherHome`, and `ParentHome`. Contextual in-page buttons, detail links, and PageHeader back links are not treated as role menus.
- `OWNER` is not an `app_role`. Owner access is an email-based override evaluated by `GuardedRoute` with `getOwnerScopedAccess`.

## Guard functions and tenant scope

| Guard / policy | Applies to | Tenant scope | Allow rule | Deny rule |
|---|---|---|---|---|
| `AuthenticatedApp` auth flow | `/`, `/<PageName>`, `*` | Authenticated Base44 app session only | Auth state loaded and no `auth_required` / `user_not_registered` app error | Redirect to login for `auth_required`; show user registration error for `user_not_registered` |
| `GuardedRoute` | Every `/<PageName>` route from `pagesConfig.Pages` | Uses the current `UserProfile.school_id` as both `actorSchoolId` and `targetSchoolId` for owner override checks | Allows when `canAccessRoute({ role: profile.app_role, routeName })` is true, or owner override is allowed | Shows `RouteAccessDenied` and redirects to `/Home` when role access and owner override are both denied |
| `canAccessRoute` | Role-route matrix | Route-level only; no row-level tenant filtering | Route name exists in `ROUTE_ACCESS` and includes current `app_role` | Missing route, missing role, or role not listed |
| `getOwnerScopedAccess` | Owner override inside `GuardedRoute` | Same-tenant only: owner email must match `VITE_OWNER_EMAIL`, `targetSchoolId` must exist, and `actorSchoolId === targetSchoolId` | Allows route despite role mismatch with reason `owner_override` | Denies with `cross_tenant_denied` when tenant context is missing or mismatched; denies silently when the user is not owner |
| Entity policy helpers (`buildScopedFilter`, `filterByRowLevel`, `assertTenantScope`, etc.) | Data access inside pages/services | `school_id` plus optional `classroom_id` / `student_id`, depending on role and entity | Data rows satisfy entity policy and row-level scope | Cross-tenant, cross-classroom, or unrelated-student rows are denied/filtered |

## Full route list, including hidden/reserved

| Route | Page / component | Menu exposure | Required role(s) | Tenant scope | Guard function(s) | Expected owner behavior |
|---|---|---|---|---|---|---|
| `/` | `Home` (`mainPage`) | Reserved landing route; not a role menu entry | Authenticated user; role-specific content chosen by `Home` | `Home` loads `UserProfile.school_id` for tenant-specific content | `AuthenticatedApp`; `Home` profile/status checks | No owner override is evaluated on `/`. Owner with no profile sees onboarding; owner with `PENDING`/`SUSPENDED` profile sees that status; active owner sees the home component for their provisioned `app_role`. |
| `/AlertaEmergencia` | `AlertaEmergencia` | Admin emergency action | `ADMIN` | Route-level current-profile tenant; page data should remain `school_id` scoped | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/Aprobaciones` | `Aprobaciones` | Admin tile | `ADMIN` | Route-level current-profile tenant; page data should remain `school_id` scoped | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/Asistencia` | `Asistencia` | Teacher tile; hidden from parent/admin menus | `PARENT` | Route-level current-profile tenant; page data should remain `school_id` plus `student_id` / `classroom_id` scoped | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/AuditoriaAdmin` | `AuditoriaAdmin` | Admin tile | `ADMIN` | Route-level current-profile tenant; audit rows should remain `school_id` scoped | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/Avisos` | `Avisos` | Parent tile | `PARENT` | Route-level current-profile tenant; notices should remain `school_id` plus parent/student scope | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/AvisosAdmin` | `AvisosAdmin` | Admin tile | `ADMIN` | Route-level current-profile tenant; notices should remain `school_id` scoped | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/AvisosMaestro` | `AvisosMaestro` | Teacher tile | `TEACHER` | Route-level current-profile tenant; notices should remain `school_id` plus assigned-classroom scope | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/Bitacora` | `Bitacora` | Parent tile; contextual link from `MisHijos` | `PARENT` | Route-level current-profile tenant; diary rows should remain `school_id` plus linked-student scope | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/BitacorasMaestro` | `BitacorasMaestro` | Teacher tile | `TEACHER` | Route-level current-profile tenant; diary rows should remain `school_id` plus assigned-classroom scope | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/CalendarioEscolar` | `CalendarioEscolar` | Admin, Teacher, and Parent tiles | `ADMIN` | Route-level current-profile tenant; events should remain `school_id` scoped | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/ConfiguracionInicial` | `ConfiguracionInicial` | Admin tile | `ADMIN` | Route-level current-profile tenant; setup data should remain `school_id` scoped | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/ContactosEmergencia` | `ContactosEmergencia` | Hidden from home menus; contextual parent/admin student contact route | `ADMIN`, `PARENT` | Route-level current-profile tenant; contacts should remain `school_id` plus selected/linked `student_id` scoped | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/CrearBitacora` | `CrearBitacora` | Hidden from home menus; contextual teacher create route | `TEACHER` | Route-level current-profile tenant; write must remain assigned-classroom/student scoped | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/EventosParaPadres` | `EventosParaPadres` | Parent tile | `PARENT` | Route-level current-profile tenant; event confirmations should remain linked-student scope | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/GestionAlumno` | `GestionAlumno` | Hidden from home menus; contextual teacher/admin student route | `TEACHER` | Route-level current-profile tenant; student data should remain assigned-classroom scope | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/GestionAusencias` | `GestionAusencias` | Admin tile | `TEACHER` | Route-level current-profile tenant; absence requests should remain assigned-classroom/student scope | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/GestionDescuentos` | `GestionDescuentos` | Admin tile | `ADMIN` | Route-level current-profile tenant; discounts should remain `school_id` scoped | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/GestionDocumentos` | `GestionDocumentos` | Admin tile | `ADMIN` | Route-level current-profile tenant; documents should remain `school_id` scoped | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/GestionEscuela` | `GestionEscuela` | Admin tile | `ADMIN` | Route-level current-profile tenant; school/classroom/student data should remain `school_id` scoped | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/GestionPedidosAdmin` | `GestionPedidosAdmin` | Admin tile | `ADMIN` | Route-level current-profile tenant; orders should remain `school_id` scoped | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/GestionSalon` | `GestionSalon` | Hidden from home menus; contextual classroom route | `TEACHER` | Route-level current-profile tenant; classroom/student data should remain assigned-classroom scope | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/Home` | `Home` | Shared home route | `ADMIN`, `TEACHER`, `PARENT` | Route-level current-profile tenant; home data loads by role and `school_id` | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess`; `Home` profile/status checks | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. After route allow, visible menu still follows provisioned `app_role`. |
| `/MisHijos` | `MisHijos` | Parent tile | `PARENT` | Route-level current-profile tenant; students should remain linked-student scope | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/OperacionDiaria` | `OperacionDiaria` | Admin, Teacher, and Parent tiles | `ADMIN`, `TEACHER`, `PARENT` | Route-level current-profile tenant; timeline rows are filtered by `school_id` plus role-specific classroom/student scope | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/Pagos` | `Pagos` | Parent tile | `ADMIN`, `PARENT` | Route-level current-profile tenant; charges should remain `school_id` plus linked-student scope for parents | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/PagosAdmin` | `PagosAdmin` | Admin tile when payment setup is ready | `ADMIN` | Route-level current-profile tenant; payment rows should remain `school_id` scoped | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/PedidosUniformes` | `PedidosUniformes` | Parent tile | `ADMIN`, `PARENT` | Route-level current-profile tenant; orders should remain `school_id` plus student scope for parents | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/PermisosRoles` | `PermisosRoles` | Admin tile | `ADMIN` | Route-level current-profile tenant; permission data should remain `school_id` scoped | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/Reportes` | `Reportes` | Admin tile | `ADMIN` | Route-level current-profile tenant; report rows should remain `school_id` scoped | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/ResumenAsistencia` | `ResumenAsistencia` | Admin tile | `TEACHER` | Route-level current-profile tenant; attendance rows should remain assigned-classroom scope | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/SolicitarAusencia` | `SolicitarAusencia` | Parent tile | `ADMIN`, `PARENT` | Route-level current-profile tenant; absence requests should remain `school_id` plus linked-student scope for parents | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/Tarea` | `Tarea` | Parent tile | `PARENT` | Route-level current-profile tenant; homework rows should remain `school_id` plus linked classroom/student scope | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `/TareaMaestro` | `TareaMaestro` | Teacher tile | `TEACHER` | Route-level current-profile tenant; homework writes should remain assigned-classroom scope | `GuardedRoute`; `canAccessRoute`; `getOwnerScopedAccess` | Allow if owner email matches and current profile has same-tenant `school_id`; deny if owner profile/tenant context is missing or cross-tenant. |
| `*` | `PageNotFound` | Reserved fallback route | Authenticated user after auth flow | No route-level tenant scope | `AuthenticatedApp` only; no `GuardedRoute` | No owner override is evaluated. Owner sees the same not-found page as any authenticated user. |

## Menu entries by role

### Admin

| Menu entry | Route | Visible when | Route allowed for Admin? | Notes |
|---|---|---|---|---|
| Enviar alerta de EMERGENCIA | `/AlertaEmergencia` | Always on Admin home | Yes | Header action, not a `BigTile`. |
| Aprobaciones | `/Aprobaciones` | Always on Admin home | Yes | Shows pending-user badge. |
| Escuela | `/GestionEscuela` | Always on Admin home | Yes | School/classroom/student management. |
| Avisos | `/AvisosAdmin` | Always on Admin home | Yes | Shows urgent unread badge. |
| Pagos | `/PagosAdmin` | Always on Admin home | Yes | Opens payment setup and charge management; concepts can be configured inside the module. |
| Reportes | `/Reportes` | Always on Admin home | Yes | Reports dashboard. |
| Asistencia | `/ResumenAsistencia` | Always on Admin home | Yes | Attendance summary. |
| Calendario | `/CalendarioEscolar` | Always on Admin home | Yes | Calendar management. |
| Documentos Oficiales | `/GestionDocumentos` | Always on Admin home | Yes | Official documents. |
| Pedidos de Uniformes | `/GestionPedidosAdmin` | Always on Admin home | Yes | Admin order management. |
| Descuentos | `/GestionDescuentos` | Always on Admin home | Yes | Discount configuration. |
| Solicitudes de Ausencias | `/GestionAusencias` | Always on Admin home | Yes | Review absence requests. |
| Configuración Inicial | `/ConfiguracionInicial` | Always on Admin home | Yes | Initial setup guide. |
| Auditoría | `/AuditoriaAdmin` | Always on Admin home | Yes | Audit traceability. |
| Permisos y Roles | `/PermisosRoles` | Always on Admin home | Yes | Administrative access controls. |
| Operación Diaria | `/OperacionDiaria` | Always on Admin home | Yes | Combined timeline. |

### Teacher

| Menu entry | Route | Visible when | Route allowed for Teacher? | Notes |
|---|---|---|---|---|
| Bitácoras de hoy | `/BitacorasMaestro` | Always on Teacher home | Yes | Shows missing-diary badge. |
| Tarea | `/TareaMaestro` | Always on Teacher home | Yes | Assign homework. |
| Avisos | `/AvisosMaestro` | Always on Teacher home | Yes | Shows urgent unread badge. |
| Asistencia | `/Asistencia` | Always on Teacher home | Yes | Daily attendance capture. |
| Calendario | `/CalendarioEscolar` | Always on Teacher home | Yes | School calendar view. |
| Operación Diaria | `/OperacionDiaria` | Always on Teacher home | Yes | Teacher-scoped daily timeline. |

### Parent

| Menu entry | Route | Visible when | Route allowed for Parent? | Notes |
|---|---|---|---|---|
| Mis hijos | `/MisHijos` | Always on Parent home | Yes | Shows linked-student count. |
| Bitácora | `/Bitacora` | Always on Parent home | Yes | Daily diary view. |
| Tarea | `/Tarea` | Always on Parent home | Yes | Homework view. |
| Avisos | `/Avisos` | Always on Parent home | Yes | Shows urgent unread badge. |
| Pagos | `/Pagos` | Always on Parent home | Yes | Shows overdue badge. |
| Calendario | `/CalendarioEscolar` | Always on Parent home | Yes | School calendar view. |
| Uniformes | `/PedidosUniformes` | Always on Parent home | Yes | Parent uniform orders. |
| Eventos | `/EventosParaPadres` | Always on Parent home | Yes | Event attendance confirmations. |
| Solicitar Ausencia | `/SolicitarAusencia` | Always on Parent home | Yes | Absence request flow. |
| Operación Diaria | `/OperacionDiaria` | Always on Parent home | Yes | Parent-scoped daily timeline. |

### Owner

| Menu entry | Route | Visible when | Route allowed for Owner? | Notes |
|---|---|---|---|---|
| No owner-specific menu | N/A | N/A | N/A | Owner is not a standalone `app_role`; owner sees the Admin/Teacher/Parent home menu matching their provisioned `UserProfile.app_role`. |
| Direct URL to any guarded `/<PageName>` route | Any `/<PageName>` route in `pagesConfig.Pages` | User manually navigates or follows an existing link | Yes, same tenant only | `getOwnerScopedAccess` allows when the authenticated email equals `VITE_OWNER_EMAIL` and the owner profile has a current `school_id` matching the target tenant context. |
| `/` and `*` | Reserved routes | Standard router behavior | Same as any authenticated user | These routes do not call `GuardedRoute`, so owner override is not evaluated. |

## Hidden or reserved page routes

These mounted routes are not primary home-menu entries for any role, although some are reachable through contextual buttons or direct URL:

- `/` (reserved landing route)
- `/ContactosEmergencia`
- `/CrearBitacora`
- `/GestionAlumno`
- `/GestionSalon`
- `*` (reserved fallback route)

## Current mismatches to verify before release

No current home-menu route mismatches are expected for Calendario, Asistencia, Pagos, or Solicitudes de Ausencias. The release gate should fail if a visible home-menu route returns `forbidden_action` for its owning role.
