# Owner Route/Menu Walkthrough Report

Date: 2026-05-19 (UTC)

## Scope
- Full owner route walkthrough across all registered guarded routes.
- Owner-visible Admin menu route walkthrough.
- Denial tracing through `GuardedRoute` → `getRouteAccessDecision` (`routeAccess`) → owner policy (`policy.js`).
- Owner provisioning checks in tenant data (`UserProfile` role/status/super-admin flags).
- Owner override tenant safety + auditability verification.

## Results Summary
- **Blocker issues:** 0
- **High issues:** 0
- **Forward rollout gate:** **PASS** (no blocker/high issues open).

## 1) Full owner route/menu walkthrough

### Registered guarded route coverage
All registered routes in `src/pages.config.js` are present in `ROUTE_ACCESS` and were allowed for owner walkthrough (`allowed=true`; precedence `route_role_allow` or `owner_override`).

| Route | Result |
|---|---|
| Home | PASS |
| OperacionDiaria | PASS |
| ContactosEmergencia | PASS |
| SolicitarAusencia | PASS |
| MisHijos | PASS |
| EventosParaPadres | PASS |
| Pagos | PASS |
| Avisos | PASS |
| Asistencia | PASS |
| Tarea | PASS |
| Bitacora | PASS |
| GestionSalon | PASS |
| GestionAlumno | PASS |
| BitacorasMaestro | PASS |
| CrearBitacora | PASS |
| TareaMaestro | PASS |
| AvisosMaestro | PASS |
| GestionAusencias | PASS |
| ResumenAsistencia | PASS |
| GestionEscuela | PASS |
| ConfiguracionInicial | PASS |
| CalendarioEscolar | PASS |
| GestionDocumentos | PASS |
| GestionDescuentos | PASS |
| PedidosUniformes | PASS |
| GestionPedidosAdmin | PASS |
| PagosAdmin | PASS |
| Aprobaciones | PASS |
| PermisosRoles | PASS |
| AuditoriaAdmin | PASS |
| AvisosAdmin | PASS |
| AlertaEmergencia | PASS |
| Reportes | PASS |

### Owner-visible Admin menu routes
All owner-visible admin routes defined in owner walkthrough test were allowed.

| Source | Menu label | Route | Result |
|---|---|---|---|
| AdminHome | Enviar alerta de EMERGENCIA | AlertaEmergencia | PASS |
| AdminHome | Aprobaciones | Aprobaciones | PASS |
| AdminHome | Escuela | GestionEscuela | PASS |
| AdminHome | Avisos | AvisosAdmin | PASS |
| AdminHome | Pagos | PagosAdmin | PASS |
| AdminHome | Reportes | Reportes | PASS |
| AdminHome | Asistencia | ResumenAsistencia | PASS |
| AdminHome | Calendario | CalendarioEscolar | PASS |
| AdminHome | Documentos Oficiales | GestionDocumentos | PASS |
| AdminHome | Pedidos de Uniformes | GestionPedidosAdmin | PASS |
| AdminHome | Descuentos | GestionDescuentos | PASS |
| AdminHome | Solicitudes de Ausencias | GestionAusencias | PASS |
| AdminHome | Configuración Inicial | ConfiguracionInicial | PASS |
| AdminHome | Auditoría | AuditoriaAdmin | PASS |
| AdminHome | Permisos y Roles | PermisosRoles | PASS |
| AdminHome | Operación Diaria | OperacionDiaria | PASS |

## 2) Denial trace (`GuardedRoute` + policy + routeAccess)

### Guard stack and precedence
1. `GuardedRoute` derives `ownerAccess` from `getOwnerScopedAccess(...)`.
2. `GuardedRoute` derives route decision from `getRouteAccessDecision({ role, routeName, ownerAccess })`.
3. If denied, `GuardedRoute` logs `access_denied` with structured reason + owner denial metadata.
4. If `owner_override` precedence, `GuardedRoute` logs explicit `owner_override` audit event.

### Verified denial scenarios
| Scenario | Policy ownerAccess | routeAccess decision | Result |
|---|---|---|---|
| Unknown route (`NoExiste`) | owner allowed | denied: `default_deny` / `route_default_deny` | PASS |
| Non-owner identity mismatch | denied: `owner_not_configured` | denied: `forbidden_action` / `route_default_deny` | PASS |
| Cross-tenant owner override attempt | denied: `cross_tenant_denied` | denied: `forbidden_action` / `route_default_deny` | PASS |
| Inactive owner profile in tenant | denied: `inactive_profile` | denied: `forbidden_action` / `route_default_deny` | PASS |

## 3) Owner provisioning verification (`UserProfile`)

Owner override requires one valid owner profile in target tenant with:
- `app_role === 'ADMIN'`
- `status === 'ACTIVE'`
- `is_super_admin === true` (when field exists)

Verified negative paths:
- Missing profile → denied (`missing_user_profile`).
- Non-admin profile → denied (`invalid_role`).
- Inactive profile → denied (`inactive_profile`).
- Duplicate active admin owner profiles in same tenant → denied (`duplicate_owner_profile`).
- Conflicting profiles in same tenant → denied (`conflicting_owner_profile`).

## 4) Tenant-safe + auditable owner override verification

### Tenant-safe
Owner override is blocked if `actorSchoolId !== targetSchoolId` (`cross_tenant_denied`) and route remains denied.

### Auditable
- Denials are logged via `logAccessDeniedEvent` including owner denial context (`owner_denied`, `owner_reason`, `precedence`).
- Owner overrides are logged via `logAuditEvent` with action `owner_override` and context including route + actor/target school IDs.

## 5) Re-test previously denied routes

All previously denied routes/scenarios from owner denial walkthrough remained denied as expected with explicit reason codes and precedence values.

## 6) Rollout gate

- Blockers: 0
- High: 0
- Gate decision: **UNBLOCK FORWARD ROLLOUT**
