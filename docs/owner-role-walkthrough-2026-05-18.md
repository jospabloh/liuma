# Owner role route walkthrough — 2026-05-18

## Assumptions and success criteria

- The owner is not a separate `app_role`; the owner is an authenticated user whose identity matches the configured owner email or user id and whose tenant `UserProfile` is an active admin profile.
- The owner home menu is therefore the admin home menu for the provisioned owner profile.
- Success means every registered guarded page route has a route-access rule, every owner-visible admin menu target is allowed, and denial controls capture both the owner policy decision and the final route guard decision.
- This walkthrough uses deterministic policy/guard execution instead of browser screenshots. Route evidence is the Node test log from `tests/integration/owner-route-walkthrough.test.js`; no browser screenshot artifact was produced in this environment.

## Walkthrough evidence

| Evidence | Reference |
|---|---|
| Automated owner route/menu walkthrough | `node --test tests/integration/owner-route-walkthrough.test.js` |
| Full regression suite | `npm test` |
| Production build | `npm run build` |

## Owner-visible menu walkthrough

| Menu source | Entry | Route | Condition | Result | Guard/policy decision | Evidence reference |
|---|---|---|---|---|---|---|
| AdminHome | Enviar alerta de EMERGENCIA | `/AlertaEmergencia` | Always visible | PASS | `allowed=true`; precedence is `route_role_allow` for owner admin role | `owner walkthrough covers every owner-visible admin menu route` |
| AdminHome | Aprobaciones | `/Aprobaciones` | Always visible | PASS | `allowed=true`; precedence is `route_role_allow` for owner admin role | `owner walkthrough covers every owner-visible admin menu route` |
| AdminHome | Escuela | `/GestionEscuela` | Always visible | PASS | `allowed=true`; precedence is `route_role_allow` for owner admin role | `owner walkthrough covers every owner-visible admin menu route` |
| AdminHome | Avisos | `/AvisosAdmin` | Always visible | PASS | `allowed=true`; precedence is `route_role_allow` for owner admin role | `owner walkthrough covers every owner-visible admin menu route` |
| AdminHome | Pagos | `/PagosAdmin` | Always visible | PASS | `allowed=true`; precedence is `route_role_allow` for owner admin role | `owner walkthrough covers every owner-visible admin menu route` |
| AdminHome | Reportes | `/Reportes` | Always visible | PASS | `allowed=true`; precedence is `route_role_allow` for owner admin role | `owner walkthrough covers every owner-visible admin menu route` |
| AdminHome | Asistencia | `/ResumenAsistencia` | Always visible | PASS | `allowed=true`; precedence is `route_role_allow` for owner admin role | `owner walkthrough covers every owner-visible admin menu route` |
| AdminHome | Calendario | `/CalendarioEscolar` | Always visible | PASS | `allowed=true`; precedence is `route_role_allow` for owner admin role | `owner walkthrough covers every owner-visible admin menu route` |
| AdminHome | Documentos Oficiales | `/GestionDocumentos` | Always visible | PASS | `allowed=true`; precedence is `route_role_allow` for owner admin role | `owner walkthrough covers every owner-visible admin menu route` |
| AdminHome | Pedidos de Uniformes | `/GestionPedidosAdmin` | Always visible | PASS | `allowed=true`; precedence is `route_role_allow` for owner admin role | `owner walkthrough covers every owner-visible admin menu route` |
| AdminHome | Descuentos | `/GestionDescuentos` | Always visible | PASS | `allowed=true`; precedence is `route_role_allow` for owner admin role | `owner walkthrough covers every owner-visible admin menu route` |
| AdminHome | Solicitudes de Ausencias | `/GestionAusencias` | Always visible | PASS | `allowed=true`; precedence is `route_role_allow` for owner admin role | `owner walkthrough covers every owner-visible admin menu route` |
| AdminHome | Configuración Inicial | `/ConfiguracionInicial` | Always visible | PASS | `allowed=true`; precedence is `route_role_allow` for owner admin role | `owner walkthrough covers every owner-visible admin menu route` |
| AdminHome | Auditoría | `/AuditoriaAdmin` | Always visible | PASS | `allowed=true`; precedence is `route_role_allow` for owner admin role | `owner walkthrough covers every owner-visible admin menu route` |
| AdminHome | Permisos y Roles | `/PermisosRoles` | Always visible | PASS | `allowed=true`; precedence is `route_role_allow` for owner admin role | `owner walkthrough covers every owner-visible admin menu route` |
| AdminHome | Operación Diaria | `/OperacionDiaria` | Always visible | PASS | `allowed=true`; precedence is `route_role_allow` for owner admin role | `owner walkthrough covers every owner-visible admin menu route` |

## Deep-link route walkthrough

All 33 registered guarded routes passed. The test asserts that `pagesConfig.Pages` and `ROUTE_ACCESS` contain the same route set before evaluating owner access.

| Route | Result | Guard/policy decision | Evidence reference |
|---|---|---|---|
| `/AlertaEmergencia` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/Aprobaciones` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/Asistencia` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/AuditoriaAdmin` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/Avisos` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/AvisosAdmin` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/AvisosMaestro` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/Bitacora` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/BitacorasMaestro` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/CalendarioEscolar` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/ConfiguracionInicial` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/ContactosEmergencia` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/CrearBitacora` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/EventosParaPadres` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/GestionAlumno` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/GestionAusencias` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/GestionDescuentos` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/GestionDocumentos` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/GestionEscuela` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/GestionPedidosAdmin` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/GestionSalon` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/Home` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/MisHijos` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/OperacionDiaria` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/Pagos` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/PagosAdmin` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/PedidosUniformes` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/PermisosRoles` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/Reportes` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/ResumenAsistencia` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/SolicitarAusencia` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/Tarea` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |
| `/TareaMaestro` | PASS | `allowed=true`; precedence `route_role_allow` or `owner_override` | `owner walkthrough covers every registered guarded deep-link route` |

## Denial controls captured

| Scenario | Owner policy decision | Final route guard decision | Failing condition | Evidence reference |
|---|---|---|---|---|
| Unknown route | Owner identity/profile is valid: `allowed=true` | `allowed=false`, `reason_code=default_deny`, `precedence=route_default_deny` | `routeName` is not present in `ROUTE_ACCESS` | `owner denial walkthrough records route guard and owner policy failure conditions` |
| Non-owner wrong-role route | `allowed=false`, `reason_code=owner_not_configured` | `allowed=false`, `reason_code=forbidden_action`, `precedence=route_default_deny` | Current user identity does not match configured owner email | `owner denial walkthrough records route guard and owner policy failure conditions` |
| Owner cross-tenant route | `allowed=false`, `reason_code=cross_tenant_denied` | `allowed=false`, `reason_code=forbidden_action`, `precedence=route_default_deny` | `actorSchoolId` differs from `targetSchoolId` | `owner denial walkthrough records route guard and owner policy failure conditions` |
| Owner inactive profile | `allowed=false`, `reason_code=inactive_profile` | `allowed=false`, `reason_code=forbidden_action`, `precedence=route_default_deny` | Matching owner `UserProfile` is not `ACTIVE` | `owner denial walkthrough records route guard and owner policy failure conditions` |

## Blocker status

The latest fix removes reported route blockers for calendar, attendance, and absence requests, and keeps payments reachable so admins can configure concepts before creating charges.
