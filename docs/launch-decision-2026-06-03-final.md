# Launch Decision — FULL GO (2026-06-03)

## Fecha/hora
- UTC: **2026-06-03T00:00:00Z**

## Contexto
Este documento promueve la decisión de lanzamiento de **LIMITED GO**
(`docs/launch-decision-2026-05-19-final.md`, `docs/final-decision-rollout-2026-05-19.md`)
a **FULL GO**, tras cerrar el único riesgo abierto: la evidencia de Deno CI en un
runner real.

El `FAIL` previo de G2 no era un defecto de la app: se debía a que el contenedor de
validación local no tenía el binario `deno` instalado ni acceso de red para instalarlo
(HTTP 403), por lo que no podía ejecutar `fmt/lint/test` de Deno. La ejecución en el
runner hospedado de GitHub Actions sí está disponible y se verificó en verde.

## Cierre del bloqueante G2 — Deno CI en runner real

Workflow: `.github/workflows/ci-deno.yml` (`deno fmt --check`, `deno lint`,
`deno test --no-prompt`) sobre `denoland/setup-deno@v2`.

Evidencia (GitHub Actions, conclusión `success`):

| Commit (`main`) | Fecha (UTC) | Resultado | Run |
|---|---|---|---|
| `0a253622` "Update base44 packages" | 2026-05-20 | ✅ success | actions/runs/26179958099 |
| `70ebc1e2` | 2026-06-03 | ✅ success | actions/runs/26856596881 |
| `02024b61` | 2026-06-02 | ✅ success | actions/runs/26799458590 |
| `a90b2aaa` | 2026-05-19 | ✅ success | actions/runs/26117071772 |

Todas las corridas recientes del workflow Deno CI (eventos `push` y `pull_request`,
en `main` y ramas) están en `success`. No hay corridas en `failure` en el historial
reciente.

## Estado consolidado de gates

| Gate | Estado | Evidencia |
|---|---|---|
| G1 — App CI (lint/type/test/build) | ✅ PASS | `npm run lint`, `npm run typecheck`, `npm test` (83/83), `npm run build` en verde (2026-06-03). |
| G2 — Deno CI en runner real (fmt/lint/test) | ✅ PASS | GitHub Actions `Deno CI` en `success` (ver tabla arriba). |
| G3 — Owner/Admin access (sin denegaciones falsas) | ✅ PASS | `tests/unit/route-access.test.js`, `tests/unit/policy.test.js`. |
| G4 — Tenant creation en Base44 test-data mode | ✅ PASS | `tests/unit/onboarding-tenant-creation.test.js`, `tests/unit/tenant-selection.test.js`. |
| G5 — Security boundaries (cross-tenant/role deny, maker-checker) | ✅ PASS | `tests/unit/tenant-danger-zone.test.js`, `tests/unit/role-boundary.test.js`, `tests/integration/authorization-stack.test.js`. |
| G6 — Blocker/high defects = 0 | ✅ PASS | `docs/launch-gate-rerun-2026-05-19.md` (blocker = 0, high = 0). |

## Confirmación de severidades
- **blocker = 0** ✅
- **high = 0** ✅

## Decisión
## **FULL GO**

Todos los gates (G1–G6) están en PASS. Se cierra el riesgo abierto de evidencia Deno CI.

## Acción sobre rollout
- Se levanta el freeze de expansión motivado por G2.
- Habilitar el despliegue escalonado (wave-by-wave, tenant-by-tenant) manteniendo el
  monitoreo de rollback ante cualquier nuevo blocker/high.

## Pendientes operativos (no bloqueantes, post-lanzamiento)
Procesos recurrentes definidos en `docs/execution-plan.md`:
- Review diario de confiabilidad (errores, latencia, denegaciones de permisos, fallos de Lumi).
- Checks semanales de seguridad (drift de permisos, maker-checker, logs de owner-override).
- Checks de UX bi-semanales (móvil/laptop + contraste de theming por tenant).
- Postmortems + tests de regresión obligatorios por cada incidente blocker/high.

## Aprobadores
- Product
- Engineering
- Security
- Operations
