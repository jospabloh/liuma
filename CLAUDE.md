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
