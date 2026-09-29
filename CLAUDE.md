# Liuma — Project Notes

School management SaaS (Base44 backend + Vite/React front-end), multi-tenant via
`school_id` on every business entity. See `docs/authorization-matrix.md` and
`docs/security-role-governance-remediation.md`.

## Module 10 (dark theme) — added 2026-08-18

`tailwind.config.js` already had `darkMode: ["class"]` and `src/index.css`
already had a complete `.dark` token palette (shadcn boilerplate) — neither
was ever engaged. Fixed:

- **`src/lib/ThemeContext.jsx`** (new) — `ThemeProvider`/`useTheme`,
  `STORAGE_KEY = 'liuma-theme'`. Resolution order: stored preference →
  `prefers-color-scheme` → light.
- **`index.html`** — inline pre-mount `<script>` reading the same
  `localStorage` key + `prefers-color-scheme`, applying `.dark` before
  React mounts (no flash of wrong theme). Kept manually in sync with
  `ThemeContext.jsx`'s own resolution logic — both carry a comment pointing
  at the other.
- **`src/App.jsx`** — wrapped the whole provider tree in `<ThemeProvider>`.
- **`src/components/ThemeToggle.jsx`** (new) — Sun/Moon icon button, wired
  into two places: `SideNav`'s identity footer (the desktop rail, next to
  the Soporte link) and `CommandPalette`'s new footer row. The mobile
  `BottomNav` has no spare slot — its own header comment is explicit that
  all 4 are already spoken for (Inicio/Hoy/Avisos/Más) — so the command
  palette (opened from the "Más" tab, the one piece of persistent chrome
  every mobile screen has) is the only mobile-reachable spot for the
  toggle; desktop's `SideNav` isn't under that constraint.
- **Six pre-existing hardcoded-light spots** (`PendingApproval.jsx`,
  `ContinueAs.jsx`, `App.jsx`'s two loading skeletons, `Layout.jsx`'s
  footer, `PageNotFound.jsx`) that used `bg-white`/`text-slate-*`/
  `border-slate-*` with no `dark:` variant — each got the matching `dark:`
  classes.
- **Four more hardcoded spots checked and left as-is**: `LumiChat.jsx`'s
  header (`text-white`/`bg-white/20` on a `bg-gradient-to-r` tenant-brand
  band), `HomeChrome.jsx`'s `bg-white/10` blur decoration (on `bg-primary`,
  already theme-aware via the CSS custom property), `WelcomeTrialModal.jsx`/
  `SuspendedAccountModal.jsx`'s `bg-white/20` icon circles (on
  `bg-primary`/`bg-destructive` respectively), and `AdminHome.jsx`'s
  tenant-switcher "current" pill (`bg-white text-slate-900`, an
  intentional white chip against the brand-colored `HomeHeader` band, not
  a themed page surface). None of these are neutral page surfaces — a flat
  `dark:` inversion would have been wrong for all four, same reasoning
  `jospabloh/puntos`'s CLAUDE.md gives for its own opacity-suffixed
  overlay/scrim exclusions.

**Verified:** `npm run lint`, `npm run build`, `npm run validate:rls` (32
entities), `npm test` (276/276) all pass. Visually verified with Playwright
(Chromium) against a local dev server — `/login` (role-picker step,
pre-auth) and a 404 page, both in dark mode — text contrast, card
backgrounds, and borders all render correctly. **Not verified:** any
authenticated page (Home, Asistencia, GestionEscuela, etc.) — not reachable
without live Base44 auth in this environment. Risk is bounded: those pages
already use the same semantic tokens (`bg-card`, `text-foreground`, etc.)
the `.dark` palette in `index.css` was hand-tuned for, and the same call
was made (and held up) for `jospabloh/cateqhub`'s and `jospabloh/puntos`'s
equivalent module-10 gaps.

## Module 4 (multi-tenant RLS) — deployed live 2026-08-18, critical follow-on found and fixed same day

The repo-side fix (missing `{"user_condition":{"role":"admin"}}` service-role
branch on 20 entities, v1.7.3) was committed but explicitly flagged as **not
yet deployed** — a `.jsonc` change alone never touches the running Base44
backend. Completing that deploy via the Base44 MCP's `update_entity_schema`
surfaced something much bigger: **Base44's live RLS engine silently drops
any sibling key placed next to `"user_condition"`** in the same rule
object. `{"data.school_id": X, "user_condition": Y}` evaluates as
`user_condition` **alone** — `X` is discarded, not enforced. Confirmed
directly from `update_entity_schema`'s own validator error: *"user_condition
must be the only key in its rule — the engine drops the sibling clause(s)"*.

That shape was already the **deployed** form of most tenant-scoping rules in
this app — not something the 1.7.3 fix introduced. A full scan of all 32
entities found **29 affected, 84 instances**, almost all on the
`data.school_id` tenant-isolation clause. Practical impact: a user matching
only the role half of a rule (e.g. `data.app_role: ADMIN`) could read/write
across **every school in the platform**, not just their own, on nearly
every entity in the app — a live, portfolio-scale cross-tenant leak, not a
theoretical one. This is the same defect class `jospabloh/cateqhub`'s
changelog documents finding once, in one entity (`Parish`), with an explicit
note that it was "worth checking elsewhere" — this is elsewhere, at far
larger scale.

**Fixed:**
- Every affected rule object rewritten as an explicit `{"$and":
  [{"user_condition": ...}, {...rest}]}` — access semantics preserved
  exactly, nothing narrowed or widened beyond restoring the tenant scoping
  the original (broken) rule always intended. Verified per-entity that
  `properties`/`required` are byte-identical before/after — only `rls`
  changed.
- Two further live-engine constraints surfaced (and fixed) while pushing
  the corrected schemas: a nested `$or` directly inside another `$or` is
  **not evaluated on write rules** (create/update/delete) — *"the branch
  silently matches"* per the engine's own error — fixed by flattening (read
  rules tolerate nested `$or` fine and were left as-is, confirmed by a
  successful deploy). And the built-in record id must be addressed as
  `"id"`, never `"_id"` — `Classroom`, `School`, and `Student` used `"_id"`
  and were rejected on redeploy; renamed.
- All 29 corrected entities deployed live via the Base44 MCP
  (`update_entity_schema`, appId `696e967c430ceb6a2232ffd8`) and **re-fetched
  via `list_entity_schemas` to confirm the fix actually took effect in
  production** — not just that the repo file changed.
- `scripts/validate-rls.mjs` now has a third check
  (`user_condition` sibling keys) alongside its existing entity-path and
  user-template checks. This exact shape is syntactically valid
  Mongo-style implicit-AND, so nothing in the prior checks ever caught it —
  verified the new check is real (not a no-op) by confirming it fires on
  the pre-fix file content and passes clean after the fix.

**If you touch `base44/entities/*.jsonc` RLS again:** a rule object that
combines `"user_condition"` with any other key **must** use an explicit
`$and` — never rely on implicit multi-key-object AND the way plain Mongo
query merging would suggest. `npm run validate:rls` now catches this
statically, but the authoritative check is still whatever
`update_entity_schema` accepts, since that's the actual deploy-time engine
— when in doubt, redeploy and read its error, don't assume local validation
is complete.

Bumped to v1.7.5 (patch, security). Verified: `npm run lint`, `npm run
build`, `npm run validate:rls` (32 entities, new check included) all pass;
276/276 tests unaffected (none exercise entity RLS directly).

## Module 6 (in-app version/changelog) — added 2026-08-18

LIUMA had no in-app changelog surface — `CHANGELOG.md` at the repo root was
kept current release-over-release, but nothing in the running app ever
showed it. New `src/lib/appConfig.js` (`APP_VERSION`/`RELEASE_DATE`,
mirroring the same file's role in stockflow/cateqhub/puntos/radar) feeds a
new `HistorialCambios` page — plain-language Spanish summaries of recent
releases, not the raw technical `CHANGELOG.md` entries, plus a version
stamp footer. Wired the same way every other page in this app is
registered (this repo has no page auto-discovery — `pages.config.js` is
edited by hand despite its "AUTO-GENERATED" header comment, which is
guidance for the Base44 IDE's own codegen tool, not a prohibition on
manual edits when that tool isn't available): a route in
`src/pages.config.js`, a `[ROLES.ADMIN, ROLES.TEACHER, ROLES.PARENT]` entry
in `src/lib/authorization/routeAccess.js` (this page carries no sensitive
data — every role sees it), and a nav destination for all three roles
under the existing "Soporte" group in `src/components/nav/navRegistry.js`
(+ a `History` icon added to `navIcons.jsx`'s string→component map).

Bumped to v1.7.6. Verified: `npm run lint`, `npm run build`, `npm test`
(276/276) all pass. No RLS, permission, or entity change — a new read-only
page, purely additive.

## Module 3 (server-side permission/billing enforcement) — fixed 2026-08-18

A portfolio-standard audit (`jospabloh/acacia-app-standard`, module 3) flagged
"server-side enforcement of `PermissionOverride`/`SchoolSubscription.
subscription_status`" as a gap. Investigated in detail first (see git history
of this section for the original "investigated, deferred" writeup), then
actually closed:

- **`PermissionOverride` itself was already correctly gated.** Its RLS
  (`base44/entities/PermissionOverride.jsonc`) requires
  `data.app_role: ADMIN` + tenant match on all four ops — a TEACHER/PARENT
  cannot create, read, update, or delete an override via a direct SDK call.
  This part was never a gap and needed no change.
- **The real gap: an override, once created, was never enforced.**
  `PermissionOverride` rows exist to grant/deny write access
  (`Notice`/`Attendance`/`Homework`/`DiaryEntry`/`ChargeItem`/
  `PaymentConcept`/`PaymentRecord`, per `PermisosRoles.jsx`'s override form —
  the only override `action` that form actually lets an admin set for these
  entities is `read`/`write`, matching `src/lib/authorization/policy.js`'s
  `POLICY_ACTIONS`) to specific users beyond their role defaults.
  `src/lib/authorization/overrides.js` evaluated them **client-side only** —
  nothing server-side read a `PermissionOverride` row before allowing a
  write to the entity it's supposed to gate. A user an admin explicitly
  denied `Homework:write` for could still call
  `base44.entities.Homework.create()` directly and RLS let it through (base
  `Homework` RLS grants TEACHER create by role, with no concept of a
  per-user override).
- **`SchoolSubscription.subscription_status` had the same shape of gap.**
  `useCanWrite()`/`ReadOnlyBanner.jsx` read it to block the UI, but no
  entity's RLS checked it — Base44's RLS rule language has no join/lookup (a
  `Notice` row can't reference a field on a different `SchoolSubscription`
  row), so this couldn't be closed declaratively.

**Fix:** new `base44/functions/guardedEntityWrite/entry.ts` — one
Safe function, parameterized by `entity` (one of the 7 above) and
`operation` (`create`/`update`/`delete`), now the sanctioned write path for
all of them. It re-derives the caller's role from their own school-scoped
`UserProfile` (never from the request — for `update`/`delete` the target
school comes from the **existing** record, not client input, so a client
can't submit a foreign `school_id` to dodge its own school's block), then
checks, in order: the base role policy (mirrors `policy.js`'s `POLICY`
table) → any matching `PermissionOverride` for `action:'write'` (deny wins
outright, allow grants access beyond the role default — mirrors
`getEffectivePolicyDecision()`) → the `SchoolSubscription.subscription_status`
read-only gate (`view_only`/`suspended`/`inactive`/`canceled` — same
statuses `licenseModel.js`'s `isReadOnlyStatus` already treats as read-only
client-side). Platform owner (`user.role === 'admin'`) bypasses all of it,
same as every other privileged function in this app.

One narrow carve-out needed its own logic: `ChargeItem`'s **deployed** RLS
(`base44/entities/ChargeItem.jsonc`) already lets a PARENT create a charge
for their own linked student when accepting a paid event
(`EventosParaPadres.jsx`, `concept_type:'EVENTO'` only) — a real exception
`policy.js`'s simplified `POLICY` table doesn't encode. RLS checks this via
`{{user.data.linked_student_ids}}`, which per `getLinkedStudents.js`'s own
comment has no client-accessible source (`base44.auth.me()` never populates
`user.data` on the client) — the new function re-derives the same linkage
server-side via the `ParentStudent` table instead, so this one legitimate
non-admin write path keeps working unchanged.

The 15 real call sites across 8 pages (`AvisosAdmin.jsx`, `AvisosMaestro.jsx`,
`Asistencia.jsx` ×4, `CrearBitacora.jsx`, `EventosParaPadres.jsx`,
`GestionAusencias.jsx` ×2, `PagosAdmin.jsx` ×5, `TareaMaestro.jsx`) were
migrated from direct `base44.entities.X.create/update/delete(...)` to a
shared thin wrapper, `src/lib/authorization/guardedWrite.js`
(`guardedCreate`/`guardedUpdate`/`guardedDelete`), which calls
`base44.functions.invoke('guardedEntityWrite', ...)` — same calling shape
(data in, record out) as the entity SDK it replaces, so each call site was a
near-mechanical swap. `POLICY_WRITE`/`READ_ONLY_STATUSES` are duplicated
inline in `entry.ts` (Deno functions can't import across directories, same
constraint `governRoleChange/entry.ts` already documents) — keep both in
sync by hand with `policy.js`'s `POLICY` and `licenseModel.js`'s
`READ_ONLY_STATUSES` if either changes.

**Deliberately NOT migrated:** `src/lib/notifications/service.js`'s two
`Notice.create` calls (`sendInApp`/`sendHighPriorityAlert`). These aren't a
user authoring a Notice — they're the app's internal in-app-notification
delivery mechanism, reused as a side effect of many different features (only
one direct caller today, `AlertaEmergencia.jsx`'s emergency broadcast, but
`sendByEvent`'s generic dispatcher is designed for many more). Routing an
infrastructure-level notification record through the same
resource/action-based override model as a user-authored Notice would be a
category error, and risked silently breaking notification delivery in paths
this session couldn't fully trace. Left on direct RLS-gated writes
(role-based only, same as before this fix) — not a regression, since no
`PermissionOverride` for `Notice:write` was ever enforced against these
calls anyway, and it's now explicitly documented as an accepted
architectural distinction rather than an oversight.

**Separate finding, not built here:** `PermisosRoles.jsx` also renders a
"role permission template" grid (`RESOURCES` × `ACTIONS`, `DEFAULT_TEMPLATE`,
add/edit/delete template) that looks like a real permission-management
feature but is pure `useState` local component state — never persisted to
any entity, never read anywhere else, resets on every page load. It has no
connection to `PermissionOverride` (the actual, now-enforced override
mechanism) or to `guardedEntityWrite`. Same shape of finding as module 7's
danger-zone table below — a UI built but never wired to anything real. Not
fixed here (out of this fix's scope, which was specifically the documented
`PermissionOverride`/`SchoolSubscription` gap); flagged for whoever next
touches `PermisosRoles.jsx`.

**Verification performed:** `npm run lint`, `npm run typecheck`,
`npm run build`, `npm run test` (276/276), `npm run test:permissions`
(23/23), and `npm run validate:rls` (32 entities) all pass. `deno` isn't
available in this sandbox (same limitation as every other Deno function in
this app) — `guardedEntityWrite` gets its first live check in this PR's CI,
and the ChargeItem/PARENT/EVENTO carve-out specifically is unverified
against a live restricted user. Risk is bounded: every migrated call site
preserves identical behavior for anyone whose role/override combination
already granted access (i.e. every admin, every teacher writing their own
entities, and the one parent event-payment path) — the only behavior change
is that a user an admin explicitly denied, or a school in a read-only
billing state, now correctly gets rejected server-side instead of the write
silently succeeding.

## Module 7 (cuenta y zona de peligro) — data export + request-deletion added 2026-08-18

`PermisosRoles.jsx` had a "Danger Zone" table (`DELETE_TENANT`,
`SUSPEND_TENANT`, `RESET_TENANT_DATA`, `TRANSFER_TENANT_OWNERSHIP` from
`src/lib/authorization/tenantDangerZone.js`) describing risk level,
confirmation requirements, and rollback policy for each operation, but it
was **read-only documentation** — no action column, no buttons, no click
handlers — and no data export existed anywhere. New:

- **`exportSchoolData`** (`base44/functions/`) — any ADMIN. Service role,
  but every read explicitly filtered by the caller's own `school_id`,
  re-derived server-side from their own ACTIVE ADMIN `UserProfile` (never
  trusted from the request — same authority-derivation pattern as
  `governRoleChange`). Returns `Student`, `Classroom`, `TeacherClassroom`,
  `ParentStudent`, `ParentProfile`, `Attendance`, `Homework`, `DiaryEntry`,
  `Notice`, `NoticeDelivery`, `AbsenceNotification`, `EmergencyContact`,
  `Event`, `EventResponse`, `PaymentConcept`, `ChargeItem`, `PaymentRecord`,
  `Discount`, `UniformOrder`, `OfficialDocument`, `WeeklyMenu`,
  `SchoolSetupGuide`, `SupportTicket`, `UserProfile` as one JSON payload; a
  failure on any single entity doesn't fail the whole export.
  `PermisosRoles.jsx` turns the response into a client-side download.
- **"Solicitar eliminación de la escuela"** — **not** a direct delete.
  `School.delete`'s RLS requires `role: admin` (the ACACIA platform owner) —
  a school's own ADMIN cannot delete their own school via RLS at all, by
  design. So this creates a `SupportTicket` (`category: ACCOUNT`,
  `priority: HIGH`) via the existing `createSupportTicket` helper;
  `resolveSupportRouting` already always routes an ADMIN's own tickets to
  the platform owner regardless of category, so no new routing logic was
  needed. Same principle as every other irreversible, tenant-wide deletion
  in this portfolio going through a human rather than instant self-service
  (see `jospabloh/radar`'s equivalent module-7 fix).

**The pre-existing 4-operation maker-checker spec table is unchanged and
deliberately left as documentation**, now explicitly labeled in the UI as a
separate initiative so it doesn't read as functional. `tenantDangerZone.js`
additionally exports `evaluateDangerZoneRequest`/`buildDangerZoneAuditEvent`/
`isHighRiskOperation` — still unused anywhere in `src/` or
`base44/functions/`. Building `DELETE_TENANT`/`SUSPEND_TENANT`/
`RESET_TENANT_DATA`/`TRANSFER_TENANT_OWNERSHIP` for real still needs the
same maker-checker rigor `governRoleChange` already proved out for role
changes (second-ADMIN approval, `PendingChange` audit trail, self-approval
rejection) applied to four much higher-blast-radius, irreversible,
tenant-wide operations — that remains out of scope for this pass, same
reasoning as before: building it rushed is a worse outcome than the actual
module-7 requirement (export + human-mediated deletion request), which is
now genuinely done.

Bumped to v1.7.7. Verified: `npm run lint`, `npm run build`, `npm run
validate:rls` (32 entities), `npm test` (276/276) all pass. `deno` isn't
available in this sandbox — `exportSchoolData` gets its first live check
once deployed to the Base44 backend (see the portfolio-wide note: a repo
commit alone never touches deployed functions, `npx base44 functions
deploy` from a machine with Base44 access is still required).

## Deploy: el id de la app vive en el repo (módulo 11, 2026-08-21)

El 2026-08-21, un `git pull` fallido dejó la terminal parada en `flowfin` y los
seis comandos siguientes desplegaron **el backend de FlowFin** en puntos, radar,
stockflow y ctrlhq: la CLI toma el origen del **directorio actual** y el destino
de `--app-id`, y nada comprueba que coincidan. En radar el `entities push` llegó
a completarse y borró el modelo de datos entero. Detalle en
`jospabloh/acacia-app-standard` → `docs/incidents.md`.

Por eso este repo ya no se deploya a mano:

```bash
npm run deploy            # funciones — lee el appId de base44.app.json
npm run deploy:site       # frontend — mergear a main NO lo hace por ti
npm run deploy:entities   # schema — DESTRUCTIVO, pide escribir "LIUMA"
npm run functions:audit   # quién llama a cada endpoint
```

**Mergear a `main` no deploya el sitio.** Se creyó lo contrario durante meses.
En flowfin se comprobó al revés: un fix se mergeó a `main` y, horas después, el
árbol que el app realmente servía seguía siendo el de antes del fix — mergear no
propaga nada (detalle en el CLAUDE.md de flowfin). El
frontend se deploya a mano con `npm run deploy:site`, igual que las funciones.
Y comprueba el resultado por **contenido**, no por hashes: el checkpoint del app
puede reportar un `git_commit_hash` igual al HEAD de `main` mientras el árbol que
de verdad se sirve está atrasado.

`scripts/base44-deploy.mjs` **rechaza** un `--app-id` por argumento, así que el
directorio y la app destino no pueden desalinearse. `deploy:entities` imprime la
lista de entidades y el nombre de la app antes de pedir confirmación — ver
"36 entidades de FlowFin" mientras crees estar desplegando otra app es la señal
de alto que faltaba.

`npm run validate:functions` (dentro de `npm run lint`) falla si los endpoints
pasan de `maxFunctions` en `base44.app.json` — hoy **40**, con
Base44 cortando en 50. El margen importa: por encima del tope el deploy falla a
media aplicación y la CLI **no** llega a su fase de poda, así que las funciones
viejas siguen ocupando los slots que harían falta para arreglarlo.

**Antes de consolidar o borrar cualquier función, corre `npm run functions:audit`.**
Una función sin llamadores en el repo casi nunca está muerta: el llamador vive
fuera, donde grep no ve — un entity hook de Base44, un cron del panel, un
`tool_config` de un agente, la URL de un webhook. El audit marca esas como
`REVISAR EN PANEL` en vez de adivinar; confírmalas contra
`npx base44 functions list` (anota `(N automation)`) antes de tocarlas.

## Selector de tema: claro / oscuro / dispositivo (módulo 12, 2026-08-21)

El tema se elige desde **un solo control**: un círculo pequeño anclado a una
esquina de la pantalla que muestra el modo vigente y, al pulsarlo, crece de lado
en una pista de tres ranuras (Claro · Oscuro · Sistema) con un indicador que se
desliza a la elegida. Tres estados, tres posiciones físicas — que es justo lo
que un botón sol/luna de dos estados no puede expresar en cuanto "seguir al
dispositivo" entra en la lista.

Lo que se guarda es la **preferencia** (`light` | `dark` | `system`), nunca el
color resuelto: con `system` la app sigue a `prefers-color-scheme` en vivo, sin
recargar. `index.html` trae un script pre-montaje que resuelve y aplica el tema
antes de que monte React, así que el primer frame ya sale del color correcto;
ese script y el proveedor comparten clave y valores, y cada uno lleva un
comentario apuntando al otro.

`src/components/ThemeSwitcher.jsx` es **idéntico byte a byte en todas las apps
del portafolio**. La fuente canónica vive en `jospabloh/acacia-app-standard` →
`shared/theme/`: cámbialo allí y cópialo, no lo edites aquí. Lo único propio de
esta app es `src/lib/useThemeMode.js` (de dónde sale el estado) y las variables
`--theme-switcher-bottom/right` en `src/index.css` (dónde se coloca).

`src/lib/ThemeContext.jsx` pasó de dos modos a tres y ahora escucha
`matchMedia` en vivo. Se quitaron el toggle del pie de `SideNav` y **el del pie
de `CommandPalette`**: ese existía sólo porque en móvil no había otro sitio
desde donde alcanzarlo (los 4 huecos de `BottomNav` están tomados), y la esquina
ya se alcanza desde cualquier pantalla. El control sube por encima de
`BottomNav` en móvil.

## `npm run test:smoke` — comprueba el sitio DESPLEGADO (2026-08-22)

`tests/smoke/smoke.spec.js` es la suite compartida del portafolio, idéntica byte
a byte en todos los repos; la fuente canónica está en
`jospabloh/acacia-app-standard` → `shared/smoke/`. Lo propio de esta app vive en
`tests/smoke/smoke.config.js` (URL, `<title>`, cómo representa el tema).

**No comprueba el build local: comprueba lo que se sirve.** Es la automatización
de la regla que cada CLAUDE.md repite — mergear no deploya nada, y hay que
verificar por contenido y no por hash. Afirma cuatro cosas, todas derivadas de
lo que el propio repo produce (nunca de copy adivinado, que se rompe al cambiar
una palabra y enseña a ignorar la suite):

1. responde 200 y el `<title>` es el de esta app — no un deploy viejo ni otro;
2. no lanza excepciones al pintar;
3. el tema llega resuelto desde el primer frame (el script pre-montaje viajó);
4. el selector de esquina está montado, cambia el tema y la preferencia
   sobrevive a un reload.

**No corre en el pipeline normal ni desde un sandbox de desarrollo**: la salida
HTTPS ahí va por un proxy con allowlist que no incluye estos dominios. Corre en
GitHub Actions (`.github/workflows/smoke.yml`): `workflow_dispatch` para
dispararla a mano justo después de un deploy, y un cron diario como red.

    npm run test:smoke                      # contra producción
    SMOKE_URL=https://… npm run test:smoke  # contra un preview

Desde el 2026-08-22 la suite añade una quinta afirmación, del **módulo 12**: el
selector no tapa nada y nada lo tapa, en móvil (390), tablet (834) y escritorio
(1440), plegado y desplegado. Un control anclado por encima de todo en una
esquina es justo lo que acaba sentado sobre una barra inferior o un botón
flotante, y entonces la app pierde una función al ancho que nadie abrió. La
comprobación distingue las dos direcciones — algo pintado encima del selector, y
el selector respondiendo por un control que hay debajo — y nombra el control
afectado. Se coloca con `--theme-switcher-bottom/right`; si otra cosa ya es dueña
de esa esquina, se mueve el selector, no el control.

## Módulo 14 — auditoría de aislamiento multi-tenant (2026-08-22)

Nuevo en `jospabloh/acacia-app-standard`. **No es releer las reglas de RLS** (eso
es el módulo 4): es recorrer, con fecha y por escrito, todo lo que puede cruzar
un inquilino con otro — cada entidad, cada función de backend (el inquilino se
re-deriva en el servidor, nunca del cuerpo de la petición, y en update/delete se
comprueba contra el registro **almacenado**), cada campo bloqueado, cada
exportación/reporte/búsqueda, cada destinatario de correo o webhook, y el cambio
de inquilino. Contra el **esquema desplegado**, no contra el archivo del repo.

Se repite cuando se añade una entidad, una función o un rol. El resultado se
anota aquí, incluyendo **lo que no se pudo verificar** desde el entorno de
trabajo — normalmente una sesión autenticada como usuario restringido de un
segundo inquilino. Decirlo vale más que insinuar una cobertura que no se logró.

Lo que motiva el módulo es que todos los fallos de aislamiento que este
portafolio llegó a desplegar eran **sintácticamente válidos**: la rama de rol sin
`$and` al inquilino en `Parish` de cateqhub, las 84 instancias de liuma donde el
motor descartaba la cláusula hermana de `user_condition`, los campos de licencia
escribibles por el propio inquilino en puntos y rumbo, y el `PermissionProfile`
que ningún RLS puede consultar porque vive en otra fila.

### Resultado — 2026-08-23, contra el esquema desplegado

Primera pasada del módulo 14 aquí. **No se encontró ningún cruce entre
escuelas.** Un hallazgo real, latente hoy, anotado abajo.

**Las funciones son la parte que importa en esta app y las seis están bien.**
Ninguna lee `school_id` del cuerpo de la petición — se comprobó por grep sobre
las seis, no por muestreo.

`guardedEntityWrite` es la implementación más sólida del portafolio, y vale la
pena decir por qué en vez de sólo marcarla como correcta:

- en update/delete el `school_id` sale del registro **almacenado** (línea 107‑109),
  no de la petición;
- en create sale de los datos enviados, pero acto seguido exige que el
  solicitante tenga un `UserProfile` ACTIVE **en esa escuela** — reclamar una
  escuela ajena no sirve de nada;
- en update **borra `school_id` del patch** antes de escribir (línea 160‑161).
  Eso cierra un agujero que casi nadie tapa: reasignar un registro existente a
  otro inquilino. **Corrección (2026-08-23):** la versión original de esta línea
  decía que ninguna otra app del portafolio lo hacía explícitamente. Es falso —
  el `guardedEntityWrite` de `jospabloh/rumbo` hace lo mismo (`delete
  data.tenant_id`) y además borra `sender_id` en un `Message`, para que un
  mensaje existente no pueda re-atribuirse. Se escribió antes de auditar rumbo y
  no se comprobó; el mérito de liuma sigue en pie, la exclusiva no.
- el carve-out PARENT/EVENTO de `ChargeItem` re-deriva el vínculo por
  `ParentStudent` en el servidor, porque `{{user.data.linked_student_ids}}` no
  tiene fuente accesible desde el cliente.

`exportSchoolData` y `governRoleChange` derivan la escuela del propio
`UserProfile` ADMIN ACTIVE del solicitante; `governRoleChange` además resuelve
el perfil objetivo **dentro** de `schoolProfiles`, ya filtrado por esa escuela,
así que un objetivo de otra escuela da 404. `notifyTicketCreated` comprueba
propiedad del ticket antes de firmar el HMAC. `acaciaControl` es el único camino
cross-tenant deliberado, cerrado por HMAC y sin contexto de usuario.

**Entidades.** `SchoolSubscription` tiene create/update/delete en `role: admin`
puro — una escuela no puede tocar su propia licencia, sin necesidad de candados
campo por campo. Se releyeron `ChargeItem`, `Guardian`-equivalentes y
`SchoolSubscription` del esquema vivo **después** del `entities push` del
2026-08-23: la corrección de `$and` del 2026-08-18 sigue desplegada, el push no
la revirtió. Las 32 entidades no se releyeron una por una en esta pasada —
`validate:rls` cubre la forma y corre en CI; lo que se verificó a mano fue que
el push no deshiciera el arreglo.

#### Hallazgo: tres reglas distintas para "en qué escuela estoy"

Esta app **sí** contempla usuarios con perfil en varias escuelas —
`src/lib/tenantSelection.js` existe justo para eso, con
`buildTenantSelectionContext` armando la lista de opciones y un `is_current`.
Pero la escuela vigente se elige de tres formas que no coinciden:

| dónde | regla |
|---|---|
| `tenantSelection.js` | ordenado, `ACTIVE && onboarding_completed` |
| `exportSchoolData:43`, `governRoleChange:86` | `.find(ADMIN && ACTIVE)` **sin ordenar** |
| `NavContext.jsx:26` | `[0]` **sin ordenar** |

No es una fuga: el usuario es dueño de todos los perfiles implicados. Es un
problema de corrección, y del tipo que este módulo pregunta explícitamente (el
cambio de inquilino). Para un admin de dos escuelas, "Descargar mis datos" puede
devolver en silencio la escuela que no está viendo, y `governRoleChange` puede
actuar sobre la otra. El orden por defecto de `filter()` en Base44 no está
especificado, así que además es no determinista.

**Latente, no vivo.** Se consultó producción: hay **un solo `UserProfile`, en una
sola escuela**. Nadie tiene hoy perfil en dos, así que la divergencia no puede
dispararse todavía. Se vuelve real el día que entre la segunda escuela o alguien
reciba un segundo perfil. El arreglo es que el backend use `selectCurrentUserProfile`
en lugar de su propio `.find()` — o que reciba la escuela vigente explícitamente
y la valide contra los perfiles del solicitante.

#### No verificado

Una sesión autenticada como TEACHER o PARENT de una segunda escuela. Con un solo
inquilino en producción no hay contra qué probarlo, y no se sembró uno: crear
inquilinos en producción para probar aislamiento es peor que declarar el hueco.
Lo de arriba es lectura de código, de esquema desplegado y una consulta a datos
reales — suficiente para descartar los defectos estructurales y para fechar el
hallazgo como latente, insuficiente para afirmar que el motor evalúa cada regla
como se lee.

## Módulo 15 — el puente con Mission Control: una llave por app (2026-08-23)

`INGEST_HMAC_SECRET` es **un solo valor compartido por todo el portafolio**, así
que una firma hecha con él demuestra «alguien tiene el secreto compartido» y
nunca «esto es LIUMA». Como el nombre de la app viaja en el cuerpo, cualquier
app podía firmar una carga diciendo ser otra y Mission Control la escribía con
esa atribución. Lo encontró la auditoría del módulo 14 de Mission Control.

El arreglo es dejar de usar el maestro directamente:

    appKey = HMAC-SHA256(maestro, "acacia.app.v1." + slug)

El prefijo es separación de dominio: garantiza que una llave derivada no puede
coincidir con una firma sobre un cuerpo, y el `v1` permite rotar el esquema sin
rotar el maestro.

`base44/functions/{acaciaControl,notifyTicketCreated}/_acaciaSign.ts`
es **idéntico byte a byte en todas las apps del portafolio**. La fuente
canónica vive en `jospabloh/acacia-app-standard` →
`shared/bridge/acaciaSign.ts`: cámbialo allí y cópialo, no lo edites aquí.
Dos copias idénticas: `acaciaControl` **verifica** y `notifyTicketCreated`
**firma** el ticket que sale.

**La migración tiene un orden y es el contrario del obvio.** La verificación
acepta las dos llaves mientras `ACCEPT_LEGACY_MASTER` sea `true`, así que da
igual quién despliegue primero. Pero Mission Control despliega al mergear y las
apps a mano, así que MC siempre va primero — por eso MC sigue **firmando** con
el maestro hasta que las nueve apps acepten derivada. **Los dos pasos ya están hechos** (2026-08-24): MC firma con `signFor` y
`ACCEPT_LEGACY_MASTER` está en `false` en los once sitios, así que una firma con
el maestro **ya no se acepta** — que es exactamente lo que cierra el agujero. `ACACIA_APP_SLUG=liuma` está puesto **y verificado** — ver abajo, porque
el valor que traía antes no era éste.

**Corrección del 2026-08-24: ese «ya estaba puesto» nunca se comprobó, y era
falso.** En la primera sincronización de las nueve apps de ese día, Mission
Control registró que **liuma rechazó la llave derivada y aceptó el maestro** —
junto con las otras tres que tampoco pasaron. Las cuatro son justo las que
traían el secreto de antes, de cuando se cableó el push de tickets; las cinco a
las que se les puso ese día verificaron derivada a la primera. O sea: aquí había
un `ACACIA_APP_SLUG`, pero con un valor que no producía la llave que MC calcula.

**No era un `acaciaControl` viejo**, que era la otra hipótesis: al redesplegar,
la CLI reportó `acaciaControl unchanged`, así que el código vivo ya traía
`_acaciaSign.ts` desde antes de esa sincronización. La única variable que
quedaba era el valor del secreto.

Corregido el mismo día. La sincronización de las 16:29 UTC dio nueve filas de
auditoría y **cero** advertencias `rejected the derived key`, y con esa medición
—no con una fecha— se apagó el flag en los once sitios y se borró el respaldo de
Mission Control.

Lo que hay que quedarse: **un secreto que nadie ha releído no está configurado.**
Este archivo afirmó por escrito durante días que lo estaba. El módulo 16 del
estándar existe por esto.

**Y ahora hay una prueba, que es lo que faltaba.** El helper no lo comprobaba
nada: cada PR de este módulo decía que recibía su primer type-check al
desplegar. `acaciaSign.test.ts` (canónico en el repo estándar) fija el vector
que la mitad Node de Mission Control ya fijaba —dos implementaciones de HMAC en
dos runtimes sólo siguen siendo iguales si algo lo afirma, y una divergencia se
ve en runtime como `bad signature` en cada llamada, que parece un secreto mal
puesto y no lo es— y afirma lo que este módulo promete: un cuerpo firmado por
una app que dice ser otra **no** verifica. No tiene imports externos ni toca la
red, así que corre en un sandbox donde `jsr.io` y `deno.land` están bloqueados.
El test canónico está en el repo estándar. **Actualizado 2026-09-29:**
`ci-deno.yml` ya corre `deno lint` y `deno check --node-modules-dir=none` sobre
`base44/functions/` (antes sólo miraba `deno/`); `deno fmt` y `deno test`
siguen acotados a `deno/`.

**La criptografía en línea que esto reemplaza ya no está.** Cada `acaciaControl`
llevaba su propio `stableStringify` / `hmacHex` / `timingSafeEqual`, copiados a
mano contra `api/_lib/ingestSign.js` de Mission Control. Dejarlos al lado del
helper no es desorden: es una segunda implementación de la misma rutina en el
mismo archivo, que es exactamente la deriva que este módulo quita.

## Auditoría completa 2026-08-31 — sin cruces de inquilino, un CVE de dependencia cerrado

Pase automatizado, con el mismo alcance que módulo 14 pero verificando
también build/lint/tests/RLS-de-archivo end to end, no solo aislamiento.
Contra el repo en `main` (`ca9c2bf`), sin desplegar nada al backend de
Base44 ni a producción — eso sigue siendo `npm run deploy`/`deploy:site`,
manual, aparte.

**Verificado limpio, sin cambios:** `npm run lint` (0 errores + `validate:functions`
6/40), `npm run build`, `npm run validate:rls` (32 entidades), `npm test`
(276/276), `npm run test:permissions` (23/23). Ningún secreto en árbol ni en
historial (`.env.example` es el único `.env*` versionado). No había rama de
auditoría ni PR abiertos previos a este pase.

**Hallazgo real, cerrado:** `react-router-dom` `6.30.6` traía dos CVEs
moderados (`GHSA-wrjc-x8rr-h8h6` open-redirect vía backslash en
`<Link>`/`useNavigate`, `GHSA-337j-9hxr-rhxg` constructor injection en
hidratación SSR). No existe versión `6.x` parcheada — la única corrección es
saltar a v7. Antes de tomar ese riesgo se comprobó que ninguna de las dos
tenía superficie viva aquí: todo `navigate()`/`<Link to>` en `src/` pasa por
`createPageUrl()` con strings definidos en el propio código o por rutas fijas
— ninguno recibe una URL cruda de un usuario — y la app es un SPA cliente
puro, sin SSR. Con eso, y viendo que el uso es solo API "declarativa"
(`BrowserRouter`/`Routes`/`Route`/`useNavigate`/`Link`, estable entre v6 y v7),
se subió a `7.18.3`. `npm audit` pasó de 2 vulnerabilidades moderadas a 0.
Verificado con la suite completa (arriba) más un chequeo de runtime con
Playwright contra el dev server local en `/`, `/login` y una ruta 404: cero
errores de router en consola (los únicos errores fueron el SDK de Base44 sin
poder alcanzar un backend, esperado en este sandbox — mismo patrón que el
módulo 10 ya documentó). Bump a v1.7.11, sin entrada en `HistorialCambios.jsx`
a propósito: es un parche de dependencia invisible para el usuario, mismo
criterio con el que los módulos 14/15/18 tampoco aparecen ahí.

**No verificado, mismo límite que cada pase anterior de este archivo:**
ninguna pantalla autenticada (Home, GestionEscuela, Pagos, etc.) ni UAT en
vivo — este entorno no tiene sesión Base44 real ni alcanza el backend
desplegado. Tampoco se releyó el esquema RLS *desplegado* en Base44 (eso es
módulo 4/14 con el MCP de Base44 y una sesión con esas credenciales, no
disponible aquí) — lo que se validó es el archivo `.jsonc` del repo, que es
lo que `validate:rls` cubre. Sin una segunda pestaña con un tenant/rol
distinto no hay forma de ejercer cross-device, performance real, ni
deliverability de correo.

**Conclusión:** ningún hallazgo de seguridad, aislamiento ni calidad además
del CVE de arriba. El estado que documentan los módulos 1–18 anteriores se
sostiene.

### Corrección y continuación — 2026-09-07

El PR de este pase (#174, rama `claude/dreamy-ride-ajb4or`) nunca se
mergeó: sus dos workflows de CI (`Node CI`, `Deno CI`) volvieron en rojo en
GitHub Actions el mismo 31 de agosto, pese a que el propio PR afirmaba
"lint ✅ · build ✅ · validate:rls ✅ · test ✅". La discrepancia se investigó
en vez de repetirse a ciegas: se recreó la rama en un worktree local y se
corrió cada paso que el workflow de Node ejecuta —`npm ci`, `lint`,
`typecheck`, `validate:rls`, `test`, `test:permissions`, `release:gate`
(este último el PR nunca lo mencionó, y es un paso real del pipeline) y
`build`— con el mismo Node 22 que fija `ci-node.yml`. Las ocho salieron en
verde. Los logs de aquella corrida ya habían expirado (404 al pedirlos, una
semana después) así que no hay forma de leer la causa exacta, pero un
contenido que reproduce limpio byte a byte contra el mismo runtime que CI
usa no respalda una regresión real — lee como flake de runner. Este pase
retoma el mismo contenido sobre la rama asignada de esta sesión en vez de
insistir sobre la rama vieja (que esta sesión no puede tocar), lo verifica
de nuevo desde cero, y añade lo que apareció entretanto:

- **4 vulnerabilidades nuevas** en `npm audit` desde que se escribió el PR
  #174: `browserslist` (alta — crecimiento de memoria sin límite y crash vía
  `browserslist-stats.json` no confiable), `@humanfs/node` (symlink
  traversal), `fflate` (loop infinito con ZIP64 malformado),
  `postcss-selector-parser` (DoS por recursión de AST). Las cuatro son
  `devDependencies` transitivas de herramientas de build (`eslint`/`vite`/
  `postcss`) — ninguna se empaqueta en el bundle de producción. Cerradas con
  `npm audit fix` (solo lockfile, sin bump mayor, sin cambio de código):
  4 → 0 vulnerabilidades.
- **`VERSION_CONTROL.json` llevaba tres releases sin tocarse** (seguía en
  `1.7.9`, sin la entrada de módulo 18 ni la del router) — el mismo patrón
  de deriva que el audit de 2026-08-24 ya había cerrado una vez y volvió a
  abrirse. Corregido junto con su campo `architecture.router`, que todavía
  describía v6.

Bump a v1.7.12. Ningún cambio de RLS, entidad, permiso o ruta en este pase.
Verificado: `npm run lint`, `npm run typecheck`, `npm run build`,
`npm run validate:rls` (32 entidades), `npm test` (276/276),
`npm run test:permissions` (23/23), `npm run release:gate`, `npm audit`
(0 vulnerabilidades) — todos en verde.

## Retirado: el selector de escuela (módulo 18) — 2026-09-10

**Una cuenta, una escuela.** El selector que dejaba a un mismo email moverse
entre escuelas y unirse a una segunda sin salir de la primera se quitó: el
feature nunca llegó a producción en el portafolio.

Lo que se fue: `src/components/home/SchoolSwitcher.jsx`, el estado
`joiningAnother` de `Home.jsx` (que reabría el onboarding desde dentro de la
app), `handleSwitchSchool`, la consulta de escuelas que sólo alimentaba las
pills, y de `src/lib/tenantSelection.js` tanto
`buildTenantSelectionContext` como el par
`get/setActiveSchoolOverride`. **La clave `liuma.activeSchoolId` de
`localStorage` ya no se lee ni se escribe**: un valor que haya quedado de antes
es inerte, no hay que limpiarlo.

**Lo que se queda, y es la mitad que importa:**
`selectCurrentUserProfile` sigue siendo la **única** regla de "qué escuela estoy
viendo", compartida por `Home.jsx`, `NavContext.jsx`, `useSubscription.js` y
`TenantThemeRuntime.jsx`. Perdió el parámetro `preferredSchoolId` (lo alimentaba
el selector) y conserva el orden determinista. Eso no es decoración: el hallazgo
del módulo 14 (2026-08-23, "tres reglas distintas para en qué escuela estoy")
fue precisamente que `filter()` de Base44 no garantiza orden y dos lectores
podían elegir perfiles distintos — "Descargar mis datos" devolviendo en silencio
la escuela que no estabas viendo. Hay un test nuevo que fija esa propiedad
(mismo conjunto, entrada invertida, misma respuesta).

**Ese hallazgo sigue abierto en el backend**, y conviene no darlo por cerrado
de rebote: `exportSchoolData:43` y `governRoleChange:86` siguen con su propio
`.find(ADMIN && ACTIVE)` sin ordenar. Quitar el selector lo hace **menos**
probable —ya no hay forma de conseguirse un segundo perfil desde la app, sólo
que un admin lo asigne— pero no imposible. El arreglo sigue siendo el que ese
módulo propuso: que el backend use `selectCurrentUserProfile`.

**Verificado:** `npm run lint` (incl. `validate:functions` 6/40),
`npm run typecheck` (exit 0), `npm run build`, `npm run validate:rls`
(32 entidades), `npm test` (276/276), `npm run test:permissions` (23/23) y
`npm run release:gate` — todos limpios. Sin cambios de RLS, entidad ni función:
esto es sólo frontend, así que requiere `npm run deploy:site` y **no**
`npm run deploy`. **No verificado:** el deploy ni una sesión de navegador.

## Auditoría completa 2026-09-14 — un CVE de dependencia cerrado, nada más

Pase programado de revisión completa (inventario, RLS/aislamiento, calidad de
código, matriz de permisos, UI/UX, cross-device, performance, QA automatizada,
changelog/versión, PR + plan de rollback), contra `main`/rama asignada en
`4420057` (sincronizada, sin diferencias). Cuatro días después del módulo 18
(2026-09-10) y con la auditoría de aislamiento completa más reciente en
2026-08-23/2026-08-31 — este pase no repite esas dos desde cero (ninguna
entidad, función, rol ni ruta cambió entretanto que las obligara), y se
concentra en lo que sí pudo cambiar solo: dependencias, y que la suite entera
siga en verde.

**Pre-flight:** árbol limpio, `HEAD` igual a `origin/main`, **cero PRs
abiertos** y ninguna rama de auditoría previa sin cerrar. Sin secretos en el
árbol (`.env.example` sigue siendo el único `.env*` versionado; grep de
patrones de credenciales conocidos, sin resultados).

**Hallazgo real, cerrado:** `npm audit` reportó **una** vulnerabilidad nueva
desde el 1.7.12 (2026-09-07): `js-yaml` `4.3.1`, alta —
[GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh),
uso de CPU sin límite en `maxTotalMergeKeys` al fusionar YAML no confiable.
Mismo patrón que cada advertencia cerrada en 1.7.9/1.7.11/1.7.12:
`devDependency` transitiva (`eslint` → `@eslint/eslintrc` → `js-yaml`),
herramienta de build, nunca se empaqueta en lo que carga un usuario. Cerrado
con `npm audit fix` (`js-yaml` → `4.3.2`, solo lockfile, sin cambio de
código ni bump mayor). `npm audit`: 1 alta → 0.

**Sin hallazgos nuevos de aislamiento, permisos, RLS-de-archivo ni calidad de
código.** El hallazgo del módulo 14 sigue en el mismo estado que dejó el
módulo 18: `exportSchoolData:43`/`governRoleChange:86` siguen con su propio
`.find(ADMIN && ACTIVE)` sin ordenar en vez de `selectCurrentUserProfile`,
latente (sigue sin existir un segundo `UserProfile` por usuario en
producción que lo dispare). No se releyó el esquema RLS **desplegado** en
Base44 en este pase — eso exige el MCP de Base44 contra credenciales de
producción, mismo límite que cada pase anterior — lo que sí se confirmó de
nuevo es que el archivo `.jsonc` del repo pasa `validate:rls` sin cambios.

**No verificado, mismo límite recurrente:** ninguna pantalla autenticada, UAT
en vivo, cross-device real, ni deliverability de correo — este entorno no
tiene sesión Base44 real ni alcanza el backend desplegado o el sitio
desplegado (`npm run test:smoke` está fuera del alcance del sandbox, ver la
sección de ese comando arriba).

Bump a v1.7.13 (patch, seguridad). Verificado, antes y después del fix:
`npm run lint` (incl. `validate:functions` 6/40), `npm run typecheck`,
`npm run build`, `npm run validate:rls` (32 entidades), `npm test`
(276/276), `npm run test:permissions` (23/23), `npm run release:gate`,
`npm audit` (0 vulnerabilidades) — todos en verde. Ningún cambio de RLS,
entidad, permiso o ruta en este pase.

## Auditoría completa 2026-09-21 — el deploy llevaba ~4 semanas de retraso (el hallazgo real), una afirmación desactualizada corregida

Primera vez que esta sesión tuvo acceso al MCP de Base44 para este repo, lo
que cambió lo que realmente se pudo verificar frente a cada pase anterior
desde el módulo 14. Detalle completo en
`docs/security-audit-2026-09-21.md`; resumen aquí.

**Corrección: el hallazgo del módulo 14 ya estaba cerrado.**
`exportSchoolData:43`/`governRoleChange:86` — el `.find(ADMIN && ACTIVE)`
sin ordenar que cada pase desde el 2026-09-10 seguía describiendo como
"abierto" — en realidad se corrigió ese mismo día, en el commit `4ec5e0c`
("Module 18: real school switcher…"), que añadió el ordenamiento
`-created_date` a ambas funciones citando explícitamente el hallazgo del
módulo 14. El commit que retiró el selector (`d6f217d`, mismo día) no tocó
`entry.ts` — su mensaje afirmó que el hallazgo "sigue abierto" sin releer el
código, y esa afirmación se repitió sin verificar en los pases del 08-31,
09-07 y 09-14. Corregido aquí comprobando el diff real (`git show d6f217d
-- base44/functions/{exportSchoolData,governRoleChange}/entry.ts`, vacío) y
el contenido actual de ambos archivos.

**El hallazgo real: producción no se había desplegado desde el
2026-08-24.** Con el MCP de Base44 se pudo leer el código que el sandbox de
la app tenía cargado y compararlo por **contenido** contra `main` (el
método que este archivo pide desde el módulo 11). El sandbox marcaba
`package.json` en `1.7.10` y `react-router-dom: "^6.26.0"` — sin el upgrade
a v7 que el audit del 2026-08-31 dio por cerrado — mientras el repo ya iba
en `1.7.13`. `GET /api/apps/{app_id}/app-checkpoints` confirmó la causa: el
último `last_deployed_at` no nulo era del 2026-08-24T20:43, casi un mes sin
deploy pese a que `main` había recibido el módulo 18 completo y tres
releases de parches. La causa raíz: un commit de `base44-builder[bot]`
("Apply RLS security recommendations", el mismo 08-24) más ediciones
directas de sesiones previas en el sandbox habían divergido de `main`, y el
sync automático con GitHub dejó de aplicar commits nuevos en silencio.

**Arreglado:** `github/sync` (conflicto de merge acotado a
`package-lock.json`) → `github/sync/resolve-conflicts` (Base44 resolvió con
su propio builder y publicó un merge en `main`, `504ca94` — diff real solo
en `package.json`/`package-lock.json`, bump de `@base44/sdk` y
`@base44/vite-plugin`, verificado con `git diff --stat` antes de aceptarlo)
→ rama rebasada sobre el nuevo `main`, suite completa corrida de nuevo →
`POST /deploy`, confirmado por el nuevo checkpoint (`git_commit_hash`
`504ca94`, `last_deployed_at` de este pase). **No verificado:** una petición
HTTP directa contra el sitio publicado — el proxy de este sandbox no
alcanza dominios `*.base44.app` (misma limitación que `npm run test:smoke`).

**RLS desplegado:** `list_entity_schemas` sobre `SchoolSubscription`
(elegida por tener una regresión documentada del 2026-08-26, `5d2e930`)
confirmó que la regla `read` desplegada ya lleva la rama `$and` correcta —
esa corrección sí había llegado a producción por una vía distinta
(probablemente `update_entity_schema` directo de una sesión anterior). No
se releyeron las 32 entidades una por una contra el esquema desplegado en
este pase.

Bump a v1.7.14 (patch, seguridad/operación). Verificado antes y después:
`npm run lint` (incl. `validate:functions` 6/40), `npm run typecheck`,
`npm run build`, `npm run validate:rls` (32 entidades), `npm test`
(276/276), `npm run test:permissions` (23/23), `npm run release:gate`,
`npm audit` (0 vulnerabilidades) — todos en verde. Ningún cambio de código
de entidad, RLS, permiso o ruta en este pase — el único cambio de código en
`main` es el bump de `@base44/sdk`/`@base44/vite-plugin` que el propio bot
de Base44 resolvió.

**Corrección post-merge:** el review automático de Codex en el PR de este
pase (#179) señaló, antes de mergear, que el checkpoint desplegado
(`504ca94`) era el padre del commit que añadía el propio bump a 1.7.14 —
así que "la app publicada corre `main`" se habría vuelto falso en cuanto
ese PR se mergeara. Correcto. Tras el merge (`860c741`) se repitió
`github/sync` + `deploy` y se releyó `package.json`/`appConfig.js` en el
sandbox para confirmar `1.7.14` por contenido — la app publicada corre
ahora sí el `main` actual.

## Módulo 24 — `User.school_id`/`app_role` bloqueados (2026-09-24)

`SchoolSubscription.read` da acceso a quien tenga `data.app_role: ADMIN` y
`{{user.data.school_id}}` igual a la escuela. Esos dos campos viven en `User`,
y este repo no tenía `User.jsonc`: nada impedía escribirlos. No es una fuga
viva: leídos del `User` real, **nadie** tiene esos campos, porque la escuela y
el rol viven en `UserProfile`. Se abriría el día que `updateMe` pudiera
escribirlos: bastaría con apuntarse a otra escuela y darse ADMIN para leer su
suscripción. Ahora `base44/entities/User.jsonc` los declara con
`rls.write: false`, y `npm run validate:tenant-roles` (checker canónico del
estándar, en CI) falla si una regla vuelve a depender de un campo de `User` sin
candado.

**Hallazgo aparte, no arreglado:** como esa rama nunca empareja, un ADMIN de
escuela **no puede leer su propia suscripción** desde el cliente.
`useSubscription` siempre ha devuelto `null` para ellos (`SchoolSubscription`
no tiene otra rama de lectura que no sea de plataforma), así que el aviso de
facturación nunca ha tenido datos. El arreglo es leerla en una función con
service role, filtrada por el `UserProfile` ADMIN ACTIVE del que llama. Es otro
cambio.

**Pendiente:** `npm run deploy:entities` después de mergear, y releer `User`
del esquema desplegado.

## Protección de créditos — SendEmail e InvokeLLM salen del navegador (2026-09-24)

Hallazgo del scan de seguridad de Base44, «Evitar el uso no autorizado de
créditos» (alto). El cliente llamaba directo a `Core.SendEmail` y
`Core.InvokeLLM` con prompt, cuerpo y destinatario armados en el navegador:
con cualquier token se podía mandar correo a cualquier dirección o gastar LLM
con un prompt arbitrario. Los cinco sitios pasan ahora por tres funciones:

- **`sendNotificationEmail`**: el cliente manda `eventType` + `templateContext`
  (sólo strings/números, cortados a 4000). Asunto y cuerpo se renderizan en
  `_templates.ts`, copia a mano de `src/lib/notifications/templates.js` (cada
  uno apunta al otro: **cámbialos juntos**). Quien llama necesita perfil en la
  escuela con el rol del evento; el destinatario tiene que ser un `User` con
  perfil en esa escuela y el rol del evento, o el buzón de soporte (sólo en
  `support_ticket_escalated`, que además acepta a los dueños `is_super_admin`
  de otra escuela — son los destinatarios de Tier-2).
- **`notifyParents`** (`absence` | `diary`): el cliente manda sólo el id. El
  correo se arma con el registro **guardado** y los padres salen de
  `ParentStudent`. Una ausencia se envía una vez (`parent_notified`, que sólo se
  marca si salió al menos un correo). La bitácora no tiene bandera propia, así
  que sólo se envía en los 10 minutos posteriores a su creación.
- **`aiAssist`** (`diary_draft` | `support_intake`): los prompts se arman en el
  servidor. `aiIntake.js` conserva su normalización y su respaldo, pero el
  prompt real vive en la función.

**Fuera de alcance, a propósito:** `Core.UploadFile` (3 sitios) y el agente
Lumi (`base44.agents.*`). Si el scan los vuelve a marcar, son otro cambio.

**No verificado:** no pude leer el resultado del scan (el token MCP no tiene
acceso a ese endpoint) ni correr `deno` aquí. Tampoco sé si Base44 sigue
aceptando `integrations.Core.*` directo desde un navegador autenticado: si lo
acepta, quitar nuestras llamadas satisface el scan pero no cierra la puerta.
Después de `npm run deploy` + `npm run deploy:site`, vuelve a correr el scan.
Prueba a mano: marcar una ausencia, crear una bitácora con envío a padres,
«Generar con Lumi», el intake de soporte y una alerta de emergencia.

## Onboarding, licencia y consentimiento por el servidor (P6, 2026-09-29)

El onboarding no podía funcionar para nadie más que el dueño de la plataforma:
el navegador creaba `School`/`SchoolSubscription` (sólo plataforma por RLS),
buscaba el código de escuela con un `School.filter` que la RLS vaciaba, el
chequeo de fundador leía un campo que el esquema descartaba, y el "bootstrap"
escribía en `Role`/`PermissionTemplate`/`AccessBinding`, que no existen.

- **Un solo camino:** `provisionOnboardingProfile` (service role) crea la
  escuela del fundador (`created_by_user_id` y `join_code` los pone el
  servidor), su prueba de 30 días con el reloj del servidor, el
  `ConsentRecord` y, al final, el `UserProfile` — el punto de confirmación.
  Todo lo anterior es idempotente al reintentar. El algoritmo vive probado en
  `src/lib/authorization/onboardingProvision.js#runOnboardingProvision`; el
  `entry.ts` es su copia a mano. Cámbialos juntos.
- **Código para unirse:** 8 caracteres sin ambiguos (`ABCD-EFGH`,
  `src/lib/onboarding/joinCode.js`), resuelto sólo en el servidor. El id de
  24 hex que se repartía antes sigue aceptándose como respaldo (unirse deja el
  perfil PENDING). `JoinCodeCard` lo muestra con Copiar / liga / WhatsApp; la
  liga `/?codigo=` rellena el onboarding.
- **Licencia, fallando cerrado:** sin `SchoolSubscription`, o prueba vencida
  → **solo lectura** (`resolveEffectiveLicense` en `licenseModel.js`, copiado
  en `getMySubscription` y `guardedEntityWrite`). Una licencia pagada vencida
  sigue escribiendo: la gracia de 8 días es de Mission Control. El plan
  `founder` de MC existe en el enum y nunca vence por fecha. Los avisos salen
  7 días antes (urgentes a 3) y después, con botón de pago
  (`VITE_LIUMA_PAYMENT_URL` o WhatsApp) sólo para el ADMIN.
- **Lecturas de la escuela:** `getMySubscription` re-deriva la escuela del
  `UserProfile` ACTIVE del que llama e ignora el cuerpo. La rama de lectura
  `data.app_role` de `SchoolSubscription` (muerta: ningún `User` tiene esos
  campos) se quitó.
- **Aviso de Privacidad y Términos: BORRADOR** redactado por Claude,
  publicado en `/aviso-de-privacidad` y `/terminos` (con y sin sesión) con la
  marca visible. Falta revisión legal. El texto vive en **un solo archivo**,
  `src/lib/legal/legalDocs.js` (el de P11; el de P6 se retiró al integrar).
  Al sustituirlo: `PRIVACY_NOTICE_STATUS = 'vigente'` y sube las versiones (en
  `privacyNotice.js` **y** en `provisionOnboardingProfile`).

**Orden de despliegue:** `deploy:entities` (School, SchoolSubscription,
ConsentRecord) → dar de alta `SchoolSubscription` a las escuelas existentes
(sin eso pasan a solo lectura en cuanto llegue `guardedEntityWrite`) →
`deploy` → `deploy:site`.

### Revisión adversarial del mismo paquete (2026-09-29)

Cuatro cosas que la suite original dejaba pasar, ya corregidas:

- **`base44.functions.invoke()` devuelve la respuesta de axios, no el cuerpo.**
  El cliente de funciones del SDK se construye con `interceptResponses: false`
  (a diferencia de `entities.*`), así que el JSON de la función está en
  `.data` — el propio ejemplo del SDK lee `result.data.total`. Leer
  `result.subscription` directo daba `undefined` → «sin licencia» → **toda
  escuela en solo lectura** en cuanto se desplegara. `unwrapFunctionResponse`
  (`src/lib/functionResponse.js`) acepta las dos formas; lo usan
  `useSubscription`, el onboarding y la exportación de `PermisosRoles` (la
  mitad «puedes exportar» de solo lectura). El doble de pruebas
  (`tests/fixtures/onboarding-backend.js`) ahora responde con la forma real.
  **Cerrado al integrar:** todas las llamadas de `src/` pasan ahora por
  `invokeFunction` — ver «Pase de preparación para venta» abajo.
- **La liga de invitación perdía el código al iniciar sesión.** `App.jsx`
  manda al usuario sin sesión a `/login` con `<Navigate replace>` y `Login`
  vuelve con `location.href = '/'`: el `?codigo=` desaparecía justo para quien
  lo necesitaba. `main.jsx` lo guarda al primer render
  (`rememberInviteCode`, `localStorage` `liuma.inviteCode`) y el onboarding lo
  borra al terminar.
- **El id de 24 hex (respaldo) nunca coincidía:** el campo pone todo en
  mayúsculas y los ids de Base44 son hex en minúsculas. El servidor lo baja.
- **La paleta de la escuela no se veía para nadie:** `TenantThemeRuntime` leía
  `School` (sólo plataforma). Ahora sale de `useSubscription().school`, igual
  que el nombre en `AdminHome`, `AlertaEmergencia` y (ya sin lectura) `PagosAdmin`.

Además: el aviso de privacidad listaba menos datos de los que las entidades
guardan (domicilio/ocupación de padres, contactos de emergencia de terceros,
bitácora de alimentación/sueño/higiene, motivos de ausencia, medidas de
uniforme, IP) y decía que la IA la usa «el personal», cuando Lumi responde
también a familias con datos del alumno. Corregido; el proveedor del modelo
queda marcado para revisión legal (LIUMA no lo elige en código).

**El candado de solo lectura en el servidor cubre sólo las 7 entidades de
`guardedEntityWrite`.** Lo demás (`Student`, `Classroom`, `Event`,
`OfficialDocument`…) se escribe directo por RLS y sólo lo frena la UI
(`useCanWrite`). Eso es del paquete del camino de escritura (P7).

## Pase de preparación para venta (2026-09-29) — v1.8.0

Doce paquetes construidos en paralelo desde `fix/P0-shared-date-helper`, cada
uno con revisión adversarial, integrados en `integration/sales-readiness`:
P0 fechas · P1 chat de Lumi · P2 agente Lumi · P3 armazón/rutas · P4
asistencia/reportes · P5 inicio del director/pagos · P6 onboarding/licencia ·
P7 caminos de escritura · P8 notificaciones/directorio · P9 oscuro/fechas ·
P11 legal/ayuda/manual · P12 CI/bundle · P10 lecturas por inquilino (sección
propia al final).

**Lo que hay que saber antes de tocar cualquiera de estas piezas:**

- **`functions.invoke` no devuelve el cuerpo.** El SDK arma el cliente de
  funciones con `interceptResponses: false`: resuelve a la respuesta de axios y
  rechaza con un `AxiosError` crudo (`error.response.data`, sin `error.data`).
  Todo `src/` llama `invokeFunction(base44, nombre, payload)` de
  `src/lib/functionResponse.js`, que devuelve el cuerpo y normaliza el error
  (`error.data`/`error.status`, como un `Base44Error`). Cuatro paquetes habían
  hecho su propio desenvoltorio; quedó uno. `tests/unit/function-response.test.js`
  falla si alguien vuelve a llamar `functions.invoke` directo. Del lado Deno,
  `lumiWrite` lleva su propio `unwrap` (Deno no importa de `src/`).
- **Fechas sin hora:** `src/lib/dates.js` (`parseLocalDate`, `isBeforeToday`,
  `formatLocalDate`…). `new Date('2026-09-29')` es medianoche UTC = día anterior
  en México. `tests/unit/date-only-sweep.test.js` y
  `dark-status-surfaces.test.js` ya no tienen lista de pendientes: un archivo
  nuevo cumple la convención o la prueba falla.
- **Escrituras:** `UserProfile` (create) y Notice/Homework/Attendance/DiaryEntry
  (create/update) son sólo service role; su único camino es `guardedEntityWrite`
  (reglas en `_policy.ts`). Registros de familia → `guardedFamilyWrite`;
  mensajes de ticket → `postTicketMessage`; `AuditLog` → `recordAuditEvent`.
  Envíos masivos (alerta, recordatorio de pago/evento, escalamiento) →
  `sendBulkNotification`; directorio de nombres/correos → `listSchoolMembers`.
  Nunca `User.list()` desde el cliente: sólo devuelve al propio usuario.
- **Licencia (decisión del dueño):** sin licencia o prueba vencida → **solo
  lectura**, en la UI y en `guardedEntityWrite` (`effectiveLicenseIsReadOnly`),
  con avisos antes (7 días, urgente a 3) y después, y botón de pago para el
  ADMIN (`VITE_LIUMA_PAYMENT_URL` o WhatsApp). Única excepción: la alerta de
  emergencia de un ADMIN. La gracia de una licencia pagada vencida es de
  Mission Control (8 días → `view_only`).
- **Lecturas de inquilino (P10, hecho):** toda lectura de datos de la escuela
  desde `src/` va por la función `schoolRead` (`src/lib/data/schoolRead.js`).
  Ver «Lecturas por inquilino (P10)» abajo.
- **Legal y Ayuda:** `/aviso-de-privacidad` y `/terminos` son rutas públicas
  montadas en `App` antes de `AuthenticatedApp`; el texto es **BORRADOR** (lo
  dice la página, con sus puntos pendientes de revisión legal) y vive sólo en
  `src/lib/legal/legalDocs.js`. Nombra sólo proveedores que el código usa
  (Resend no: todo correo sale por Base44). `docs/authorization-matrix.md`
  está atado a `ROUTE_ACCESS` por prueba: cambia los dos juntos.
- **CI:** `ci-deno.yml` corre `deno lint` y `deno check` sobre
  `base44/functions/`; `deno.lock` no se versiona. `npm run lint` ya no usa
  `--quiet` (las advertencias se ven, 0 errores es el listón).

**Orden de despliegue (reconcilia P6, P7, P8 y P2):**

1. **Alta de `SchoolSubscription`** para cada escuela real existente (MUNDO
   GURI, Colegio Montessori LIUMA; producción tenía 0). El dueño decide estado
   y plan. Sin esto, en cuanto llegue el nuevo `guardedEntityWrite` esas
   escuelas quedan en solo lectura. Es escritura de datos: no la hace una
   sesión sin permiso explícito.
2. **`npm run deploy:entities`** (escribe `LIUMA`), todas juntas: School,
   SchoolSubscription, ConsentRecord (P6); UserProfile, User, Notice, Homework,
   Attendance, DiaryEntry, EmergencyContact, AbsenceNotification, EventResponse,
   UniformOrder, SupportTicketMessage, AuditLog (P7); SupportTicket (P8).
3. **Inmediatamente** `npm run deploy` (20 funciones: + `schoolRead` y
   `markWelcomeShown` de P10) y `npm run deploy:site`. **`schoolRead` no puede
   salir antes que el `UserProfile` del paso 2** — ver «Despliegue» en P10.
   P7 pedía funciones+sitio antes o junto con entidades (si las entidades
   cierran primero, las escrituras directas del cliente viejo fallan en el
   hueco); P6 y P8 pedían entidades primero (campos nuevos que las funciones
   escriben). No hay orden que evite todo hueco: entidades → funciones → sitio
   **en la misma ventana, minutos**, y el paso 1 antes que nada.
4. **`npx base44 agents push`** (lumi.jsonc) **después** de las funciones
   (`lumiQuery`/`lumiWrite` tienen que existir).
5. Verificar por contenido: `list_entity_schemas` de las 16 entidades (User
   sin `required`), un ADMIN real ve su código de escuela y **no** está en
   solo lectura (prueba que el desenvoltorio funciona en vivo),
   `/aviso-de-privacidad` sin sesión muestra BORRADOR, `/manifest.json`
   devuelve JSON.

**No verificado:** nada de esto corrió contra Base44 en vivo — ni funciones
(sólo `deno check`/`deno lint`), ni RLS desplegada, ni una sesión real de
ADMIN/TEACHER/PARENT, ni si el token del usuario llega a las herramientas de
Lumi y de ahí a `guardedEntityWrite`. Tampoco si Base44 aplica `rls.write`
por campo a un usuario sobre su propia fila, ni si una creación con service
role llena `created_by_id`. Las pantallas autenticadas no se vieron en
navegador. Los textos legales no los ha revisado un abogado.

## Lecturas por inquilino (P10, 2026-09-29)

Cierra F01. Decisión del dueño: **la RLS de las entidades se queda estricta**
(dueño de plataforma, o las filas propias) y los usuarios de escuela leen por
una función con service role. No se aflojó ninguna regla `read`;
`tests/unit/school-read-client.test.js` falla si alguna empieza a mencionar
`school_id`, `app_role` o `{{user.data.*}}`.

- **`base44/functions/schoolRead`** — una sola función, hermana de lectura de
  `guardedEntityWrite`. Escuela y rol salen del `UserProfile` vigente del que
  llama (`selectCurrentProfile`, la misma regla que `selectCurrentUserProfile`);
  salones de `TeacherClassroom` activos, hijos de `ParentStudent` ACTIVE **y**
  cuyo `Student` sea de la misma escuela. Nada del cuerpo nombra la escuela: un
  `school_id` en el filtro tiene que ser el propio o es 403 `SCHOOL_MISMATCH`.
  Formas: `{entity, filter, sort, limit≤1000, skip}`, `{queries:[…≤12]}` (una
  derivación de alcance para varias listas) y `{action:'context'}` (rol,
  salones, hijos con sus filas).
- **`_scope.ts` es la lista blanca**, entidad × rol, y es **idéntico byte a
  byte** en `schoolRead/`, `lumiQuery/` y `lumiWrite/` (`_lumiCore.ts` lo
  reexporta): Lumi y las pantallas responden con las mismas reglas. ADMIN: toda
  su escuela. TEACHER: sus salones (alumnos, asistencia, bitácora, tarea,
  vínculos padre-alumno de sus alumnos), avisos/eventos de escuela o de sus
  salones, perfiles ACTIVE sin teléfono; nada de cobros, contactos de
  emergencia, descuentos, auditoría ni cambios pendientes. PARENT: sólo sus
  hijos y lo que cuelga de ellos, más lo dirigido a toda la escuela o a los
  salones de sus hijos. `created_by` (correo de otro adulto) y
  `notified_parent_emails` nunca salen para no-ADMIN.
- **Los filtros sólo estrechan.** Campos fuera de la lista, `$or/$and/$regex/
  $exists/$not` y objetos anidados se rechazan; sobre el campo por el que el rol
  está acotado, el valor se intersecta con su conjunto. Con una sola rama la
  condición del rol va en la consulta (limit/skip cuentan filas visibles); con
  varias (Notice/Event/OfficialDocument para no-ADMIN) se recorre la escuela en
  orden y se filtra, con tope de 5000 filas crudas (`truncated`). Toda fila se
  revisa (`rowVisible`) y se proyecta antes de salir.
- **Excepciones directas, a propósito y con prueba**: el propio `UserProfile`
  (`user_id: user.id`), las ramas del dueño de plataforma en soporte
  (`listQueueTickets`/`listTicketMessages` con `isOwner`), `LicenseAdmin`,
  onboarding de un PENDING y `SeedTestData`. Lista en
  `school-read-client.test.js`; cualquier otra lectura directa la hace fallar.
- `useCurrentProfile` ahora elige con `selectCurrentUserProfile` (antes
  `profiles[0]` sin orden): la escuela que manda la página tiene que ser la que
  deriva el servidor.

**Pruebas:** `school-read-scope.test.js` corre el planificador y el ejecutor
reales contra una base en memoria con dos escuelas y varias familias
(`tests/fixtures/fake-entity-db.js`, que lanza ante cualquier operador que no
soporte, para que un `$or` no pase en silencio): ningún rol cruza de escuela,
un padre no ve al compañero del mismo salón, un vínculo a un alumno de otra
escuela no da nada, un maestro no ve salones inactivos, el hilo de un ticket
propio incluye la respuesta del personal y el ajeno no.

**Despliegue — el orden importa, y no es el obvio:**

1. **`npm run deploy:entities` con `UserProfile` ANTES de `npm run deploy`.**
   `schoolRead` lee la escuela entera con service role guiándose sólo por el
   `UserProfile` del que llama (`school_id`, `app_role`, `status`). Con el
   esquema desplegado de hoy esos campos los puede escribir el propio usuario
   en su fila: si `schoolRead` sale primero, `UserProfile.update(propio,
   {school_id: otra, app_role: 'ADMIN', status: 'ACTIVE', onboarding_completed:
   true})` le da la otra escuela entera — datos médicos, contactos, cobros,
   auditoría. Antes de P10 esa edición no exponía nada (la RLS estricta no le
   daba filas ajenas). Desde la revisión de P10 el repo ya no depende sólo de
   los candados por campo: `UserProfile.rls.update` es **sólo service role** y
   el único cambio que el cliente hacía (`welcome_message_shown`, Home.jsx) va
   por la función `markWelcomeShown`.
2. **Sonda en vivo antes de dar por bueno el paso 1**, con un usuario de
   prueba que NO sea dueño de plataforma: `UserProfile.update(suPropioId,
   {school_id: 'x'})`, `{status: 'ACTIVE'}` y `{welcome_message_shown: true}`
   tienen que ser rechazados (o no cambiar nada). Si no, `schoolRead` no sale.
3. `npm run deploy` (`schoolRead`, `markWelcomeShown`, `guardedEntityWrite`,
   `lumiQuery`/`lumiWrite` con `_scope.ts`) **antes o junto con** `npm run
   deploy:site`: el sitio nuevo sin las funciones deja las pantallas en error
   (y el aviso de bienvenida sin poder cerrarse).

**Revisión adversarial de P10 (2026-09-29), lo que cambió:**

- `SupportTicket` y `NoticeDelivery` aceptan del cliente cualquier `school_id`
  (su RLS de `create` sólo fija solicitante/destinatario). La regla `members`
  de `_scope.ts` exige que ese usuario tenga un `UserProfile` **ACTIVE** en la
  escuela; si no, la fila no llega al personal. Se revisa fila a fila (no como
  un `$in` gigante en la URL), así que esas lecturas van en modo escaneo.
  Consecuencia aceptada: los avisos/tickets de alguien que dejó la escuela
  dejan de verse en las listas del personal.
- TEACHER ve `Attendance`/`DiaryEntry` sólo si el salón **y el alumno** son
  suyos, y `Student` sólo los ACTIVOS de sus salones (`studentIds`, lo mismo
  que usa Lumi). `guardedEntityWrite` rechaza en `create` de un no-ADMIN un
  salón que no tiene asignado o un alumno que no está en ese salón
  (`decideCreateTargets` en `_policy.ts`), y lo mismo para avisos CLASSROOM/
  STUDENT.
- Para no-ADMIN la salida es **lista blanca** (`SYSTEM_FIELDS` + `fields` −
  `hide`); un ADMIN de escuela ya no ve `ip_address` en la auditoría; un lote
  lleva como mucho `MAX_SCANS_PER_BATCH` (3) lecturas en modo escaneo (una
  prueba revisa cada `schoolReadMany` de `src/`); un 500 ya no devuelve el
  mensaje crudo.
- Reportes leía `Attendance`/`DiaryEntry` directo (pasando
  `base44.entities.X` a `fetchAllPages`) y el escaneo no lo veía: un director
  veía asistencia y bitácoras en ~0. Ahora van por `schoolRead` con
  `SCHOOL_READ_ALL` (todo o error «acota las fechas», nunca una cifra
  cortada), y el escaneo marca cualquier `entities.X` que no sea escritura.
  `read()` ya no pide un `skip` que el servidor rechaza.
- **No se cambió, a propósito:** un padre deja de ver sus propias ausencias,
  pedidos y respuestas a eventos cuando se desactiva el vínculo con el hijo.
  Añadir la rama `parent_id: self` las devolvería, pero también devuelve datos
  del niño a un adulto cuyo vínculo se revocó: **decisión del dueño**.

**No verificado:** nada contra Base44 en vivo — ni que la API acepte
`limit+1`/`skip` como el SDK documenta, ni tiempos con una escuela real (cada
llamada de maestro/padre re-deriva el alcance: 2–3 consultas extra). Siguen
abiertas las **escrituras** directas del cliente sobre entidades cuyo `create/
update/delete` es sólo del dueño de plataforma (Classroom, Student, Event,
Discount, OfficialDocument, SchoolSetupGuide, TeacherClassroom,
ParentStudent, PermissionOverride, PendingChange; NoticeDelivery salvo su
destinatario): leer ya funciona para un director; crear un salón o un
descuento todavía no. **Cerrado en P10b, abajo.**

## Escrituras por inquilino (P10b, 2026-09-29)

Hermano de escritura de P10, **sin función nueva**: `guardedEntityWrite` es
ahora el único camino de escritura de todo lo de la escuela cuya RLS es sólo
del dueño de plataforma. La RLS no se aflojó; se **endureció**:
`NoticeDelivery` create/update y `SupportTicket` create pasan a sólo service
role (antes cualquiera los creaba con el `school_id` que quisiera).

- **Dos caminos, una regla de identidad.** Las 7 entidades con
  `PermissionOverride` siguen en `entry.ts`; las demás (`SCHOOL_WRITES` en
  `_policy.ts`: Classroom, Student, TeacherClassroom, ParentStudent, Event,
  Discount, OfficialDocument, SchoolSetupGuide, PermissionOverride,
  PendingChange, la revisión de AbsenceNotification/UniformOrder,
  NoticeDelivery, SupportTicket) van a `runSchoolWrite` (`_schoolWrite.ts`,
  import-free). En los dos, escuela y rol salen de `resolveCallerProfile`
  (`selectCurrentProfile`, la misma regla que `schoolRead`, con prueba de
  igualdad): en create un `school_id` del cuerpo sólo puede confirmar la
  propia (si no, 403 `SCHOOL_MISMATCH`); en update/delete manda el registro
  **guardado** y tiene que ser de tu escuela. El dueño de plataforma nombra la
  escuela.
- **Qué se escribe:** lista blanca tipada por entidad (`fields`/`updateFields`;
  `url` sólo http(s), enums del esquema), sello del servidor (`uploaded_by`,
  `reviewed_by`, quién completó/confirmó un paso — sólo cuando cambia el
  estado, porque ConfiguracionInicial reenvía el paso entero —, requester/tier/
  SLA del ticket, tipo/estado/solicitante del `PendingChange`), y toda
  referencia (alumno, salón, aviso, perfil, maestro, padre) de la misma
  escuela; maestro/padre además ACTIVE y con ese rol.
- **Roles:** casi todo es sólo ADMIN. Vincular padre↔alumno y asignar
  maestro↔salón **dan lectura** (schoolRead deriva de ahí), así que sólo el
  ADMIN, y un vínculo existente no se re-apunta (se revoca y se crea otro). En
  GestionAlumno el maestro ya no ve «Vincular»/«Quitar». Alumno, salón y
  vínculos **no se borran** (no hay `delete`): `is_active:false` / `REVOKED`.
- **Avisos:** el cliente ya no arma destinatarios. `publishNoticeDeliveries(
  noticeId)` → el servidor lee el aviso guardado (un maestro, sólo los suyos) y
  crea una copia por vínculo ACTIVE de cada alumno ACTIVE de la escuela en su
  alcance, sin duplicar si se reintenta (`planNoticeDeliveries`). El
  destinatario marca leído/escalado su propia copia; eso y los tickets no los
  frena la licencia en solo lectura (pedir ayuda es justo la salida).
- **Tickets:** el director mueve sólo los de nivel `SCHOOL_ADMIN`; escalar a
  soporte lo sella el servidor (48 h, `OWNER`). Enrutamiento y SLA copiados de
  `src/lib/support/{routing,sla}.js`, con prueba de igualdad.
- Se quitó el canal in-app (`sendInApp`): escribía un `Notice` con scope
  `USER` que el esquema no tiene, directo a una entidad sólo service role;
  nunca funcionó.
- **Espejo del cliente:** `src/lib/authorization/guardedWritePolicy.js`
  (sólo para esconder botones; `guardedWrite.js` rechaza una entidad/operación
  que el servidor no ofrece). `tests/unit/write-path-p10b.test.js` corre el
  camino real contra dos escuelas en memoria (ids ajenos, `school_id`
  falsificado, maestro/padre en entidades de personal, licencia, tickets,
  avisos), compara las tablas, exige RLS sólo-dueño en cada operación de
  `SCHOOL_WRITES` y **falla si `src/` escribe directo a una entidad sólo del
  dueño** (excepción: `LicenseAdmin`, pantalla del dueño).

**Despliegue:** `npm run deploy` (guardedEntityWrite) y `npm run deploy:site`
**antes o en la misma ventana** que `deploy:entities` (NoticeDelivery,
SupportTicket): con la RLS nueva y el sitio viejo, crear tickets y repartir
avisos falla hasta que llegue el sitio. Encaja en el orden de P10 (UserProfile
primero): entidades → funciones → sitio, minutos.

**No verificado:** nada en vivo — ni la RLS nueva desplegada, ni que
`bulkCreate` exista en el SDK del servidor (hay respaldo a `create` uno por
uno), ni una sesión real de director/maestro/padre. **Sigue abierto:** el cupo
de alumnos por plan sólo lo aplica la UI (`useStudentQuota`, detrás de
`PAYWALL_GATING_ENABLED`); `WeeklyMenu` no tiene pantalla de escritura.
