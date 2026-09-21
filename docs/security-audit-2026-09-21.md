# LIUMA — Auditoría completa, 2026-09-21

Pase programado con alcance estándar del portafolio (inventario, RLS/aislamiento,
calidad de código, matriz de permisos, UI/UX, cross-device, performance, QA
automatizada, changelog/versión, PR + plan de rollback). Contra `main`/rama
asignada, `HEAD` == `origin/main` (`4c516a8`) al arrancar. Primera vez que esta
sesión tuvo acceso al MCP de Base44 para este repo — eso cambió el alcance real
de lo que se pudo verificar, ver abajo.

## Pre-flight

Árbol limpio, cero PRs abiertos, ninguna rama de auditoría previa sin cerrar.
Sin secretos en el árbol (`.env.example` sigue siendo el único `.env*`
versionado; grep de patrones de credenciales conocidos, sin resultados).

## Suite de verificación (antes de tocar nada)

`npm ci`, `npm run lint` (incl. `validate:functions`, 6/40 endpoints),
`npm run typecheck`, `npm run build`, `npm run validate:rls` (32 entidades),
`npm test` (276/276), `npm run test:permissions` (23/23), `npm run
release:gate`, `npm audit` (0 vulnerabilidades — ninguna advertencia nueva
desde 1.7.13). Todo en verde antes de empezar.

## Hallazgo 1 — documentación desactualizada (corregido)

El hallazgo del módulo 14 (`exportSchoolData:43`/`governRoleChange:86`
seleccionando la escuela del solicitante con su propio `.find(ADMIN &&
ACTIVE)` sin ordenar, en vez de la regla compartida
`selectCurrentUserProfile`) se venía repitiendo como "sigue abierto" en cada
pase desde el 2026-09-10 (el propio commit de retiro del módulo 18, y los
pases del 08-31, 09-07 y 09-14).

Era falso. El commit `4ec5e0c` (2026-09-10, "Module 18: real school
switcher…") ya había añadido el ordenamiento `-created_date` a ambas
funciones, con un comentario explícito citando el hallazgo del módulo 14. El
commit de retiro del selector (`d6f217d`, mismo día) **no tocó
`entry.ts`** — su propio mensaje de commit afirmó que el hallazgo seguía
abierto sin volver a leer el código. Confirmado con `git show d6f217d --
base44/functions/{exportSchoolData,governRoleChange}/entry.ts` (diff vacío)
y con el contenido actual de ambos archivos, que ya llevan el ordenamiento.

## Hallazgo 2 — el deploy llevaba ~4 semanas de retraso (corregido, el hallazgo real de este pase)

Con el MCP de Base44 disponible por primera vez en esta sesión, se pudo leer
el código que el *sandbox* de la app realmente tenía cargado — comparando
por **contenido**, siguiendo el mismo método que este archivo lleva pidiendo
desde el módulo 11 ("comprueba por contenido, no por hashes").

`package.json` en el sandbox marcaba versión `1.7.10` y
`react-router-dom: "^6.26.0"` — es decir, **sin** el upgrade a v7 que el
audit del 2026-08-31 dio por cerrado (cerraba dos CVEs moderados). El repo,
mientras tanto, ya iba en `1.7.13`.

`GET /api/apps/{app_id}/app-checkpoints` confirmó la causa: el checkpoint
más reciente con `last_deployed_at` no nulo era del **2026-08-24T20:43**
— casi un mes sin un solo deploy nuevo, pese a que `main` había recibido el
módulo 18 completo (construcción y retiro del selector de escuela), tres
releases de parches de dependencias (1.7.11/12/13) y la corrección del
hallazgo 1 de arriba.

Causa raíz: el lado de Base44 había divergido de `main` — un commit de
`base44-builder[bot]` ("Apply RLS security recommendations", 2026-08-24) más
ediciones directas en el sandbox de sesiones previas — así que el sync
automático con GitHub dejó de aplicar commits nuevos en silencio (el
`webhook_active: true` no implica que cada push se aplique sin conflicto).

**Arreglado en este pase:**

1. `POST /api/apps/{app_id}/github/sync` → conflicto de merge, acotado a
   `package-lock.json` únicamente (`theirs_tip` = `4c516a8`, HEAD de `main`
   en ese momento).
2. `POST /api/apps/{app_id}/github/sync/resolve-conflicts` → Base44 resolvió
   con una corrida de su propio builder y publicó un commit de merge en
   `main` (`504ca94`, autor `base44-builder[bot]`). Diff real sobre
   `4c516a8`: **solo** `package.json`/`package-lock.json`, bump de
   `@base44/sdk` (0.8.44→0.8.48) y `@base44/vite-plugin` (1.0.31→1.0.41) —
   herramientas propias de Base44, nada de la app. Verificado con
   `git diff 4c516a8..504ca94 --stat` antes de aceptar el resultado.
3. Rama de esta sesión rebasada sobre el nuevo `main`; `npm ci` + la suite
   completa (lint/typecheck/build/validate:rls/test/test:permissions/audit)
   corrida de nuevo — todo verde con las versiones de Base44 actualizadas.
4. `POST /api/apps/{app_id}/deploy` → nuevo checkpoint
   ("Resolve merge conflicts in package-lock.json"), `git_commit_hash`
   `504ca94` y `last_deployed_at` con el timestamp de este pase. La app
   publicada corre el código de `504ca94` — que era `main` en ese momento.

**Corrección (señalada por el review de Codex en el PR de este pase, antes
de mergear — correcta):** este mismo commit (el que añade este archivo y el
bump a 1.7.14) se apila **sobre** `504ca94`, así que en cuanto se mergee,
`main` vuelve a adelantarse al checkpoint ya desplegado. Decir sin más "la
app publicada corre el código de `main`" sería falso el instante en que este
PR se mergee — exactamente el patrón que este pase existe para cerrar. El
paso que falta, y que no podía hacerse antes de mergear (el sync de Base44
lee de la rama `main`, no de una rama de PR): **repetir `github/sync` +
`deploy` una vez que este PR esté en `main`**, y confirmar el nuevo
`git_commit_hash` contra el `main` resultante. Hecho como parte de este
mismo pase, después del merge — ver la entrada de CLAUDE.md.

**No verificado:** una petición HTTP directa contra `https://liuma-2232ffd8.
base44.app` — el proxy de este sandbox no alcanza dominios `*.base44.app`
(misma limitación que impide correr `npm run test:smoke` aquí). La
confirmación de que el deploy tomó es por contenido del checkpoint
(`git_commit_hash` + `last_deployed_at`), no por una respuesta HTTP en vivo.

**Impacto práctico mientras estuvo así:** los usuarios de producción
estuvieron corriendo, durante casi un mes, una build sin la corrección de
router (v6 con dos CVEs moderados aceptados como riesgo *después* de
verificar que no había superficie viva — ver el audit del 08-31 — pero la
build vieja tampoco tenía ese análisis nuevo aplicado como código, solo como
documentación) y sin el resto de los cambios de ese mes. No es una fuga de
datos ni un hallazgo de aislamiento — es un hallazgo operativo: el pipeline
de "mergear no deploya" que este archivo lleva documentando desde el módulo
11 se manifestó en la práctica, no solo en la teoría.

## RLS desplegado — verificación puntual, no exhaustiva

`list_entity_schemas` sobre `SchoolSubscription` (elegida por tener una
regresión documentada y corregida el 2026-08-26, commit `5d2e930`) confirmó
que la regla `read` desplegada **ya** lleva la rama `$and` correcta
(`ADMIN` + `school_id`) — el fix de esa regresión sí llegó a producción,
por una vía distinta (probablemente `update_entity_schema` directo de una
sesión anterior, el mismo patrón que el módulo 4 estableció). No se
releyeron las 32 entidades una por una contra el esquema desplegado en este
pase — mismo límite de alcance que cada auditoría de aislamiento anterior;
lo verificado aquí es puntual, sobre la entidad con historial conocido.

## Sin hallazgos nuevos de aislamiento, permisos ni calidad de código

Ningún archivo de `base44/entities/*.jsonc`, `base44/functions/*` (además de
lo ya descrito), ni de las capas de autorización del cliente cambió de
contenido en este pase — el único código tocado en `main` es el bump de
`@base44/sdk`/`@base44/vite-plugin` que Base44's propio bot resolvió.

## No verificado (límite recurrente)

Ninguna pantalla autenticada, UAT en vivo, cross-device real, ni
deliverability de correo — este entorno no tiene sesión Base44 real de
usuario final ni alcanza el sitio publicado por HTTP directo (ver arriba).

## Verificado, antes y después de todo lo anterior

`npm run lint`, `npm run typecheck`, `npm run build`, `npm run validate:rls`
(32 entidades), `npm test` (276/276), `npm run test:permissions` (23/23),
`npm run release:gate`, `npm audit` (0 vulnerabilidades) — todos en verde.

## Rollback

- **Código/repo:** `git revert` del commit de esta auditoría en `main`
  (solo toca versión/changelog/docs). El merge `504ca94` en sí es
  independiente de este PR y no se revierte por esto.
- **Deploy de Base44:** `POST /api/apps/{app_id}/deploy` con
  `checkpoint_id` apuntando al checkpoint anterior
  (`6a8cac875853bf6f2ec807a6`, 2026-08-24) si el deploy actual mostrara un
  problema en vivo — aunque eso reintroduciría el atraso de un mes que este
  pase acaba de cerrar, así que la opción preferida ante un problema es un
  fix hacia adelante, no un rollback del deploy.
- **Versión:** 1.7.14 → 1.7.13 revirtiendo el commit de este pase.
