# LIUMA Changelog

All notable changes to LIUMA are documented here.
Versions follow [Semantic Versioning](https://semver.org/).

---

## [1.8.0] - 2026-09-29

Sales-readiness pass: twelve fix packages (P0–P9, P11, P12) built in parallel,
each adversarially reviewed, integrated on one branch. Detail per package in
CLAUDE.md → "Pase de preparación para venta (2026-09-29)".

### Fixed (live production bugs)

- **`base44.functions.invoke` returns the axios response, not the body**
  (`interceptResponses: false` in the SDK). Every call site that read
  `result.record` / `response.text` / `result.users` / `error.data.code` got
  `undefined`: `guardedCreate` returned nothing and `CrearBitacora` crashed on
  `entry.id` before `notifyParents`; the member directory, Lumi's diary draft,
  the support intake and specific error messages were all silently broken.
  One helper now — `src/lib/functionResponse.js#invokeFunction` — used by every
  call in `src/`, tested (`tests/unit/function-response.test.js`).
- Onboarding could not create or join a school for anyone but the platform
  owner (client wrote platform-only entities). Now one service-role function,
  `provisionOnboardingProfile`, with short join codes (P6).
- Date-only fields rendered one day early in Mexico; attendance KPI always 0%;
  payment/emergency/escalation fan-outs read a `User.list()` that only returns
  the caller, so nobody was emailed (P0, P4, P8, P9).

### Security

- Write paths: `UserProfile` create and Notice/Homework/Attendance/DiaryEntry
  create/update are service-role only; `guardedEntityWrite` gains record-level
  rules and audit rows; new `guardedFamilyWrite`, `postTicketMessage`,
  `recordAuditEvent`; `notifyTicketCreated` pinned to `SupportTicket` (P7).
- License fails closed: no `SchoolSubscription` or expired trial → read-only on
  the server too (ADMIN emergency alert exempt) (P6).
- Lumi: no entity tools; reads through `lumiQuery` (profile-derived scope),
  writes through `lumiWrite` (preview + confirmation code); per-user daily AI
  caps (P2). `listSchoolMembers`, `approveProfile`, `sendBulkNotification`
  replace client directory reads and fan-outs (P8).
- CI runs `deno lint` + `deno check` over `base44/functions/` (P12).

### Added

- License notices before/after expiry with pay CTA; `JoinCodeCard`; public
  `/aviso-de-privacidad` and `/terminos` (**BORRADOR**, legal review pending);
  `/Ayuda` manual; login recovery/sign-up; route error boundaries; PWA
  manifest (P3, P6, P11). Lumi chat rewrite, lazy-loaded (P1).

### Changed

- Route access trimmed/extended (ADMIN on GestionSalon/GestionAlumno;
  SeedTestData platform-only); dark-mode status tints; sentence case; bundle
  split into vendor chunks, jsPDF/LumiChat lazy; 10 unused dependencies
  removed (P3, P5, P9, P12).

---

## [1.7.17] - 2026-09-28

### Security

- **Confirmed: `notifyParents` never checked that a record's student
  actually belongs to that record's own school.** A re-scan of v1.7.16's
  redeployed code (triggered after that pass's fixes went live) surfaced
  this: `guardedEntityWrite` ties `school_id` to the caller's own profile
  but took `student_id` from the request as-is, so a teacher could create
  an `Attendance`/`DiaryEntry` row in their own school pointing at a
  different school's student — and `notifyParents` would mail that
  student's real parents. Fixed in both places: `guardedEntityWrite`'s
  `create` now rejects a `student_id` that doesn't resolve to a `Student`
  in the target school (`400 STUDENT_NOT_IN_SCHOOL`) and its `update`
  strips `student_id` from any patch outright (same treatment `school_id`
  already gets); `notifyParents` independently verifies the student's
  school on both the absence and diary paths as defense in depth. Low
  severity per the scan (a foreign student id isn't enumerable through
  RLS), but confirmed and cheap to close. Full detail in
  `docs/security-audit-2026-09-28.md`.

Two further findings from the same re-scan (`plausible`, not confirmed —
`EmergencyContact` creation not verifying parent-student linkage in
`ContactosEmergencia.jsx`, and `SupportTicketMessage` creation not
verifying ticket ownership in `tickets.js`) plus one RLS recommendation
(tightening `UserProfile.create`/`update` to admin-only) are **deferred,
not fixed here** — each needs its own guarded backend function or an
onboarding-flow audit, larger than a same-day follow-up. Documented with
fingerprints in `docs/security-audit-2026-09-28.md` for a dedicated pass.

Verified: `npm run lint` (incl. `validate:functions`, 9/40), `npm run
typecheck`, `npm run build`, `npm run validate:rls` (33 entities), `npm
run validate:tenant-roles`, `npm test` (285/285), `npm run
test:permissions` (23/23), `npm run release:gate`, `npm audit` (0
vulnerabilities) — all pass.

## [1.7.16] - 2026-09-28

### Fixed

- **Production deploy was stale again — the same class of gap 1.7.14
  fixed.** The checkpoint carrying 1.7.15's own fixes (credit-protection
  functions below, and Module 24) had built successfully on Base44 but was
  never pushed live: `last_deployed_at` was `null` on that checkpoint while
  `main` sat two commits past the last real deploy (`713eb35`,
  2026-09-24T22:40). Redeployed via the Base44 platform API and confirmed
  by content, not just by hash: `User`'s live entity schema now shows
  `rls.write: false` on both `school_id` and `app_role` via
  `list_entity_schemas`, and the deployed checkpoint's `git_commit_hash`
  matches `main`'s HEAD (`6ecb2ec`). A merge to `main` still does not
  deploy anything by itself — every CLAUDE.md in this portfolio repeats
  that rule, and this is the third time in six weeks LIUMA's own deploy
  went stale under it.
- **`CHANGELOG.md` had fallen a release behind `package.json`/
  `VERSION_CONTROL.json`/`appConfig.js`**, which were already bumped to
  1.7.15 (credit-protection functions + Module 24's `User` RLS lock, see
  below) with no corresponding entry here. Backfilled.

### Security

Redeploying 1.7.15's code (see above) let Base44's security scan see it for
the first time — the previous "clean" scan predated these files. It came
back with three real findings, all in the service-role backend functions
that write on a user's behalf, all fixed here:

- **`guardedEntityWrite` wrote every field of `body.data` verbatim,
  including attribution fields the entity's own RLS normally pins to the
  caller** (`Attendance.recorded_by`, `DiaryEntry`/`Homework.teacher_id`,
  `Notice.author_id`, `PaymentRecord.recorded_by`) — the service-role write
  bypasses that RLS, so nothing stopped a caller from making a write look
  like it came from a different teacher. Now overridden server-side from
  the caller's own identity on create, and stripped from the patch on
  update (no real call site ever changes it after the fact).
- **Confirmed, medium severity: the PARENT/EVENTO `ChargeItem` carve-out
  trusted the client's `amount`/`original_amount`/`discount_amount`/
  `status`.** A parent accepting a paid event could submit
  `amount: 0, status: 'PAID'` directly to `guardedEntityWrite` instead of
  the app's own payload, and the service-role write would record the fee
  as already settled at zero cost — a silent, self-service way to erase a
  family's real balance from the school's billing records. Fixed by
  deriving every financial field from the referenced `Event` record itself
  (`cost_amount`, `cost_concept`, `confirmation_deadline`) instead of from
  the request; the carve-out check still verifies the parent is actually
  linked to the student.
- **`sendNotificationEmail`'s `new_user_pending` event let any registered
  user — including one with an already-ACTIVE profile — repeatedly email a
  school's admins with a self-chosen display name/email/role in
  `templateContext`, no rate limit.** Narrowed to callers whose profile is
  actually `PENDING` (the only real scenario); `userName`/`userEmail` are
  now checked against the caller's own identity instead of trusted as free
  text; `roleName` is derived server-side from the caller's `app_role`
  instead of read from the request; and the event is now idempotent **per
  recipient** via a new `UserProfile.pending_notification_recipients`
  array (`rls.write: false`) — a same-day Codex review on this fix's own
  PR caught that a single sent/not-sent flag would let the first
  successfully-notified admin block every other admin in a multi-admin
  school from ever being notified.
- **`notifyParents`'s diary path had no delivery-idempotency flag** (its
  own code comment said so) — replaying the same `recordId` within the
  10-minute window re-mailed the same parents every time. New
  `DiaryEntry.notified_parent_emails` array (`rls.write: false`) tracks
  delivery **per recipient**, so a call where only some parents' sends
  succeeded still lets the next call retry exactly the ones that failed
  instead of skipping the whole entry forever — another same-day Codex
  catch on the first version of this fix, which used a single record-level
  flag.

Scheduled full-review audit pass. Pre-flight: repo clean, HEAD ==
`origin/main`, zero open PRs, no secrets in tree. Two rounds of automated
review on the PR (Codex) caught real regressions in the first version of
the last two fixes above — both corrected same day, before merge; see
`docs/security-audit-2026-09-28.md` for the detail. Verified, before and
after every fix: `npm run lint` (incl. `validate:functions`, 9/40), `npm
run typecheck`, `npm run build`, `npm run validate:rls` (33 entities),
`npm run validate:tenant-roles`, `npm test` (283/283), `npm run
test:permissions` (23/23), `npm run release:gate`, `npm audit` (0
vulnerabilities) — all pass, matching every check `ci-node.yml` runs.
`deno` isn't available in this sandbox, so the three edited functions were
syntax-checked with a standalone `tsc --noResolve` pass (no errors beyond
the expected `npm:`/Deno-global resolution noise) rather than run — real
verification is `ci-deno.yml` plus this pass's own redeploy-and-rescan
loop. See `docs/security-audit-2026-09-28.md` for the full scan output and
the post-fix redeploy/rescan result. No entity RLS `create`/`read`/
`update`/`delete` rule changed — only two new, unrestricted-by-RLS fields
(service-role-only in practice, same as their siblings) and the
service-role functions above.

## [1.7.15] - 2026-09-24

### Security

- **Base44's security scan flagged unauthorized-credit-use risk (high):
  `Core.SendEmail`/`Core.InvokeLLM` called directly from the browser.** The
  client built the recipient, email body and LLM prompt itself and called
  the integration directly — any authenticated token could send mail to an
  arbitrary address or spend LLM credits on an arbitrary prompt. Moved all
  five call sites (`notifications/service.js`, `Asistencia.jsx`,
  `CrearBitacora.jsx`, `support/aiIntake.js`) behind three new backend
  functions: `sendNotificationEmail` (server-rendered templates, caller and
  recipient re-derived from `UserProfile`), `notifyParents` (absence/diary
  emails built from the stored record — absence is idempotent via
  `parent_notified`, diary is time-boxed to 10 minutes after creation), and
  `aiAssist` (prompts built server-side). `Core.UploadFile` and the Lumi
  agent were left unchanged (out of scope for this finding).
- **Locked `User.school_id`/`User.app_role`** (`base44/entities/User.jsonc`,
  Module 24). `SchoolSubscription.read`'s platform-owner branch trusts
  `{{user.data.school_id}}`/`data.app_role` off the raw `User` record, and
  nothing previously stopped `updateMe` from writing them — not a live leak
  today (no code path ever wrote them; the real school/role live on
  `UserProfile`) but a self-assigned-ADMIN/cross-school read waiting to
  happen the day something did. `rls.write: false` on both fields, enforced
  by `npm run validate:tenant-roles` in CI going forward.

*(This entry was written retroactively by the 1.7.16 pass above — the
release itself shipped and was documented in `VERSION_CONTROL.json` at the
time, but `CHANGELOG.md` was never updated to match.)*

## [1.7.14] - 2026-09-21

### Fixed

- **Production deploy had drifted ~4 weeks behind the repository.** The
  Base44-hosted app's own checkpoint history showed no deploy since
  2026-08-24, while the repo had moved on to 1.7.13 — meaning the
  react-router-dom v6→v7 CVE fix (2026-08-31) and every change after it had
  never actually reached production users. Root cause: Base44's own side of
  the GitHub sync had diverged (a bot-authored RLS commit plus direct in-app
  edits from earlier sessions), which silently stopped new commits from
  applying. Pulled the latest commits, resolved the resulting
  `package-lock.json`-only merge conflict, and redeployed; the app is now
  running current `main`. See `docs/security-audit-2026-09-21.md`.
- **Stale audit claim corrected.** The module-14 finding
  (`exportSchoolData`/`governRoleChange` picking the caller's school via an
  unordered `.find()`) was actually fixed on 2026-09-10 — every audit since
  kept repeating that it was still open without re-checking the code.

### Security

- No new dependency advisory this cycle (`npm audit`: 0 vulnerabilities,
  unchanged from 1.7.13).

## [1.7.13] - 2026-09-14

### Security

- **`js-yaml` `4.3.1` → `4.3.2`** (`npm audit fix`, lockfile-only): closes
  GHSA-2883-xcg3-v3hh (unbounded CPU use via `maxTotalMergeKeys` on an
  untrusted YAML merge). Transitive `devDependency` of `eslint` (via
  `@eslint/eslintrc`) — build-time only, never shipped in the app bundle.
  `npm audit`: 1 high → 0.

### Verified

- Full scheduled audit pass: pre-flight (clean tree, HEAD == `origin/main`,
  no open PRs or stray audit branches, no secrets in tree), then
  `npm run lint`, `npm run typecheck`, `npm run build`,
  `npm run validate:rls` (32 entities), `npm test` (276/276),
  `npm run test:permissions` (23/23), `npm run release:gate` — all green
  both before and after the fix above. No RLS, entity, permission, or
  route-access code changed.

## [1.7.12] - 2026-09-07

### Security

- **4 dependency advisories closed** (`npm audit fix`, lockfile-only, no
  breaking changes): `browserslist` (high — unbounded memory growth and a
  crash via untrusted `browserslist-stats.json`), `@humanfs/node` (symlink
  traversal on recursive copy), `fflate` (infinite loop parsing malformed
  ZIP64 archives), `postcss-selector-parser` (AST-recursion denial of
  service). All four are transitive build-tooling `devDependencies`
  (pulled in by `eslint`/`vite`/`postcss`) — none ship in the production
  bundle. `npm audit`: 4 (1 high, 2 moderate, 1 low) → 0.

### Fixed

- **Release-metadata drift, again**: `package.json`, `src/lib/appConfig.js`
  and `VERSION_CONTROL.json` were still reading `1.7.9` — module 18
  (`1.7.10`) and the router-CVE fix below (opened as PR #174, never merged)
  both shipped without the version bump. `VERSION_CONTROL.json`'s
  `architecture.router` field was also still describing v6. Both corrected
  here.

## [1.7.11] - 2026-08-31

### Security

- **`react-router-dom` `6.30.6` → `7.18.3`** (2 moderate CVEs: an open-redirect
  bypass via a backslash in `<Link>`/`useNavigate`, and an arbitrary
  constructor injection in SSR hydration — GHSA-wrjc-x8rr-h8h6,
  GHSA-337j-9hxr-rhxg). No patched `6.x` release exists (`npm audit` offers
  only the major bump). Verified neither CVE was live here first — every
  `navigate()`/`<Link to>` target in `src/` goes through app-defined
  `createPageUrl()` strings or hardcoded routes, never raw user input, and
  the app has no SSR — before taking the major-version risk. The app only
  uses `BrowserRouter`/`Routes`/`Route`/`useNavigate`/`Link` (React Router's
  "declarative mode", stable across v6→v7), so the bump needed no code
  changes. `npm audit` now reports 0 vulnerabilities.

## [1.7.10] - 2026-08-26

### Added

- **Módulo 18** (jospabloh/acacia-app-standard): unirse a una segunda
  escuela ya no requiere navegar fuera de la app ni existía forma de
  llegar de vuelta a esa pantalla una vez onboardeado — `Home.jsx` gana un
  enlace "Unirme a otra escuela" siempre visible, y un selector real
  (clickeable, no decorativo) cuando el usuario tiene perfil ACTIVE en más
  de una. Reemplaza la fila de "pills" que vivía solo en `AdminHome.jsx`
  (sin `onClick`, solo para ADMIN) por un componente compartido por los
  tres roles.

### Fixed

- **Módulo 14, hallazgo cerrado**: las tres reglas distintas para "cuál es
  mi escuela actual" (`tenantSelection.js` ordenada, `exportSchoolData`/
  `governRoleChange` sin ordenar, `NavContext.jsx` con `[0]` sin ordenar) se
  unificaron en `selectCurrentUserProfile`. Era latente porque no existía
  forma de tener perfil en dos escuelas sin soporte manual; deja de serlo
  con el punto anterior.
- **CI verde de nuevo, y una regresión real detrás**: `read` de
  `SchoolSubscription` había vuelto a ser `{"user_condition":{"role":"admin"}}`
  puro — un ADMIN de escuela no podía leer su propia suscripción. No era
  del módulo 3 (2026-08-18) ni de este PR: `00d16e4` ("Apply RLS security
  recommendations", `base44-builder[bot]`, push directo a `main` sin PR ni
  review, 2026-08-24) deshizo la rama `$and[data.app_role:ADMIN,
  data.school_id]` que el propio módulo 4 había corregido y el módulo 14
  había confirmado desplegada — el mismo commit sólo tocaba escapes de
  acentos en las descripciones, así que la regresión pasó inadvertida.
  Restaurada exactamente a como estaba (misma forma `$and` que exige
  `validate-rls.mjs` desde el módulo 4 — nunca claves hermanas de
  `user_condition`); `update`/`delete` siguen sin tocar, sólo `role: admin`.
  `tests/unit/rls-subscription-owner-only.test.js` (de antes de este PR) es
  lo que lo capturó.

## [1.7.9] - 2026-08-24

### Fixed

Weekly automated audit. Unlike the 2026-08-17 round (no commits since the
last audit), five real modules shipped on `main` between 2026-08-18 and
2026-08-23 — module 11 (deploy tooling: app-id binding, `deploy:site`),
module 12 (three-way light/dark/system theme switcher, replacing module
10's two-state toggle), the `npm run test:smoke` live-site suite, module 14
(multi-tenant isolation audit — one latent, not-live finding), and module
15 (per-app derived signing key for the Mission Control bridge) — **and
none of them bumped `package.json`, added a `CHANGELOG.md` entry, or
updated `VERSION_CONTROL.json`/`src/lib/appConfig.js`'s `APP_VERSION`**.
`APP_VERSION` was still reading `1.7.5`, three releases behind
`package.json`'s `1.7.8`, so the in-app `HistorialCambios` page has been
silently understating the shipped version for days. Closing that gap is
this entry — see `CLAUDE.md` for each module's own detailed writeup, this
is the release-metadata catch-up, same pattern as the 2026-07 `v1.7.0`
round.

- **`react-router` / `react-router-dom` 6.30.4 → 6.30.6** (`npm audit fix`,
  lockfile-only, no `package.json` range change). Closes
  `GHSA-jjmj-jmhj-qwj2` (open redirect leading to XSS). The other two
  advisories on this dependency (`GHSA-wrjc-x8rr-h8h6`,
  `GHSA-337j-9hxr-rhxg`) require a v6→v7 major upgrade and remain accepted
  risk, unchanged from every prior audit — see
  `docs/security-audit-2026-08-24.md` §3 for why they're not reachable
  here (client-only SPA, no SSR, no externally-controlled navigation
  target).
- `USER_MANUAL.md` had zero mentions of the theme switcher, the
  `HistorialCambios` page (module 6, shipped 2026-08-18), or the "Descargar
  mis datos" / "Solicitar eliminación de la escuela" danger-zone actions
  (module 7, shipped the same day) — all three are live, user-facing
  features. Added.
- New `docs/security-audit-2026-08-24.md` — full audit report, master
  format (see prior `docs/security-audit-*.md` files).

Verified: `npm run lint`, `npm run typecheck`, `npm run build`,
`npm run test` (276/276), `npm run test:permissions` (23/23),
`npm run validate:rls` (32 entities) all pass after the dependency bump.
No RLS, entity, permission, or route-access code touched this round.

## [1.7.8] - 2026-08-18

### Added

Portfolio-standard audit (module 10 — dark theme). `tailwind.config.js`
already had `darkMode: ["class"]` and `index.css` already had a complete
`.dark` token palette (shadcn boilerplate), but nothing ever applied the
`.dark` class — no toggle, no persisted preference, no
`prefers-color-scheme` fallback.

- New `src/lib/ThemeContext.jsx` (`ThemeProvider`/`useTheme`), a matching
  inline pre-mount `<script>` in `index.html` (no flash of the wrong theme
  before React hydrates), and a new `ThemeToggle` component wired into
  `SideNav`'s identity footer (desktop) and `CommandPalette`'s new footer
  row (mobile — the bottom nav's 4 slots were already spoken for).
- Six pre-existing hardcoded-light spots (`PendingApproval.jsx`,
  `ContinueAs.jsx`, `App.jsx`'s loading skeletons, `Layout.jsx`'s footer,
  `PageNotFound.jsx`) got matching `dark:` variants.
- Four more hardcoded spots were checked and correctly left as-is — all sit
  on brand-color/semantic-color surfaces already theme-aware via CSS
  variables, or are white-on-color decoration, not themed page surfaces.

Verified: `npm run lint`, `npm run build`, `npm run validate:rls` (32
entities), `npm test` (276/276) all pass, plus a Playwright visual check
(dark mode) of `/login` and a 404 page.

## [1.7.7] - 2026-08-18

### Added

Portfolio-standard audit (module 7 — cuenta y zona de peligro). `PermisosRoles.jsx`
already rendered a "Danger Zone" spec table (delete/suspend/reset/transfer
tenant) but it was read-only documentation — no working action, no data
export, no way to request deletion.

- New `base44/functions/exportSchoolData` — any ADMIN of a school can
  download everything their school owns (23 operational entities) as one
  JSON payload. Runs with the caller's own token to derive the school from
  their ACTIVE ADMIN `UserProfile`, never from client input; every read is
  explicitly scoped to that one `school_id` via `asServiceRole`.
- **"Solicitar eliminación de la escuela"** — **not** a direct delete.
  `School.delete`'s RLS requires `role: admin` (the ACACIA platform owner)
  — a school's own ADMIN cannot delete their own school via RLS at all, by
  design. This creates a `SupportTicket` (`category: ACCOUNT`,
  `priority: HIGH`), which `resolveSupportRouting` already always sends to
  the platform owner for an ADMIN's own tickets — same principle as every
  other irreversible, tenant-wide deletion in this portfolio going through
  a human rather than instant self-service.
- The pre-existing 4-operation maker-checker spec table is left as
  documentation, now explicitly labeled as a separate, larger, not-yet-built
  initiative — see `CLAUDE.md` for why building it for real is out of scope
  here.

No RLS or entity change beyond the new function. Verified: `npm run lint`,
`npm run build`, `npm run validate:rls` (32 entities), `npm test`
(276/276) all pass.

## [1.7.6] - 2026-08-18

### Added

Portfolio-standard audit (module 6 — in-app version/changelog). LIUMA had
no in-app changelog surface at all — only this repo-root `CHANGELOG.md`,
never seen by an end user.

- New `src/lib/appConfig.js` (`APP_VERSION`/`RELEASE_DATE`) and a new
  **`HistorialCambios`** page — plain-language Spanish summaries of recent
  releases plus a version stamp, reachable from every role's nav under the
  existing "Soporte" group (`src/components/nav/navRegistry.js`), wired
  through `routeAccess.js` and `pages.config.js` the same way every other
  page in this app is registered.
- No RLS, permission, or entity change — a new read-only page, purely
  additive.

Verified: `npm run lint`, `npm run build`, `npm test` (276/276) all pass.

## [1.7.5] - 2026-08-18

### Security (critical)

Completing 1.7.3's module-4 live deploy — pushing the fixed
`base44/entities/*.jsonc` RLS to the actual Base44 backend, since a repo
commit alone never changes runtime behavior — surfaced that Base44's live
RLS engine **silently drops any sibling key placed next to
`"user_condition"`** in the same rule object:
`{"data.school_id": X, "user_condition": Y}` evaluates as `user_condition`
**alone** — `X` is discarded entirely, not enforced. That shape was already
the *deployed* form of most tenant-scoping rules in this app, not something
1.7.3 introduced. A scan of all 32 entities found **29 affected, 84
instances**, almost all on the `data.school_id` tenant-isolation clause —
meaning a user matching only the role half of a rule (e.g.
`data.app_role: ADMIN`) could read/write across **every school**, not just
their own, on nearly every entity in the app. Same defect class
`jospabloh/cateqhub`'s changelog documents finding once, in one entity
(`Parish`) — this is the "worth checking elsewhere" that note called out,
at much larger scale here.

- **Fixed:** every affected rule object rewritten as an explicit
  `{"$and": [{"user_condition": ...}, {...rest}]}` — access semantics
  preserved exactly, nothing narrowed or widened beyond restoring the
  tenant scoping the original (broken) rule always intended.
- **Two further live-engine constraints** surfaced and fixed while
  redeploying: a nested `$or` directly inside another `$or` is not
  evaluated on write rules (create/update/delete) — flattened (read rules
  tolerate it fine, left as-is); and the built-in record id must be
  addressed as `"id"`, not `"_id"` — `Classroom`/`School`/`Student` used
  `"_id"` and were rejected on redeploy, renamed.
- All 29 corrected entities deployed live via the Base44 MCP and re-fetched
  to confirm the fix actually took effect in production.
- **`scripts/validate-rls.mjs` now catches the primary defect going
  forward** — flags any rule object mixing `user_condition` with sibling
  keys. This exact shape is syntactically valid Mongo-style implicit-AND,
  so the existing checks (which only ever verified valid syntax) never
  caught it; the new check verified real by confirming it fires on the
  pre-fix files and passes clean after.
- No entity field, property, or intended-access rule changed — every
  entity's `properties`/`required` confirmed byte-identical before/after.

Verified: `npm run lint`, `npm run build`, `npm run validate:rls` (32
entities, including the new check) all pass; 276/276 tests unaffected.

## [1.7.4] - 2026-08-18

### Security

Portfolio-standard audit (module 3 — server-side permission/billing
enforcement). `PermissionOverride` rows (per-user allow/deny beyond a role's
default write access, set via `PermisosRoles.jsx`) and
`SchoolSubscription.subscription_status` (the read-only billing gate) were
both only ever checked client-side — a user an admin explicitly denied
write access to `Notice`/`Attendance`/`Homework`/`DiaryEntry`/`ChargeItem`/
`PaymentConcept`/`PaymentRecord`, or a school in a read-only billing state,
could still write to any of them via a direct SDK call, since base RLS on
these 7 entities only checks role, not per-user overrides or billing status.

- **Added `base44/functions/guardedEntityWrite`** — the new sanctioned write
  path for all 7 entities. Re-derives the caller's role from their own
  school-scoped `UserProfile`, then checks role policy → matching
  `PermissionOverride` (`action:'write'`) → billing read-only status, before
  delegating the write. Preserves the one legitimate non-admin exception
  (a parent may create a `ChargeItem` for their own child when accepting a
  paid event) by re-deriving that linkage server-side instead of relying on
  a client-inaccessible RLS token.
- **Migrated 15 call sites across 8 pages** from direct
  `base44.entities.X.create/update/delete(...)` to the new function via a
  shared client wrapper, `src/lib/authorization/guardedWrite.js`.
- No behavior change for anyone whose role/override combination already
  granted access — this closes a bypass that only mattered for a user an
  admin had specifically restricted, or a school past its billing grace
  period. See `CLAUDE.md`'s module 3 section for the full writeup, including
  one internal-notification write-path intentionally left as-is and a
  separate, unrelated finding (an unwired "permission template" UI) noted
  for later.

## [1.7.3] - 2026-08-18

### Security

Portfolio-standard audit (module 4 — multi-tenant RLS). 20 of 32 entities
gated admin access only via the custom `data.app_role` field, which
`asServiceRole` (the identity every backend function uses) can never match —
a landmine for any future backend function that reads or writes one of
them, silently returning zero rows or rejecting the write instead of an
obvious error. Same failure mode already fixed once for `UserProfile`/
`PendingChange` via `governRoleChange`.

- **Added the missing service-role branch** (`{"user_condition":{"role":
  "admin"}}`) to all four RLS ops on: `AbsenceNotification`, `ChargeItem`,
  `Classroom`, `DiaryEntry`, `Discount`, `EmergencyContact`, `Event`,
  `EventResponse`, `Homework`, `Notice`, `NoticeDelivery`,
  `OfficialDocument`, `ParentProfile`, `ParentStudent`, `PaymentConcept`,
  `PermissionOverride`, `SchoolSetupGuide`, `TeacherClassroom`,
  `UniformOrder`, `WeeklyMenu`. Additive only — each op's original rule is
  preserved verbatim as one branch of a new outer `$or`; nothing narrowed.
- `scripts/validate-rls.mjs` doesn't check for this class of gap by design
  (documented in its own header) — it still won't catch a regression here.
  Adding that check is a natural follow-up, not done in this release.
- No entity field, permission default, or tenant-isolation rule changed —
  only the missing OR-branch was added. 276/276 tests pass (unaffected —
  none exercise entity RLS directly); `npm run validate:rls` passes clean
  (32 entities); lint and build both pass.
- **Still needed, cannot be done from this environment:** the repo change
  alone doesn't touch the deployed Base44 backend — this needs
  `update_entity_schema` (or the Base44 dashboard) run against all 20
  entities before it takes effect in production.

## [1.7.2] - 2026-08-10

### Security

Weekly automated audit. Closes a High-severity HTML/script-injection gap
(CWE-79) in parent- and staff-facing transactional emails, and five
dependency advisories.

- **HTML injection in transactional emails, fixed.** Several email
  templates — the absence-notification email and all seven templates in
  the shared notification library (new-user-approval, payment reminders,
  event confirmations, emergency alerts, and support-ticket emails) —
  interpolated user- or entity-controlled text directly into an HTML email
  body without escaping. The highest-risk path let an unauthenticated
  self-registering user's name/email reach a school admin's inbox
  unescaped. A partial fix had already landed for one of these emails in an
  untracked direct commit to `main`; this release completes it with a
  shared, tested `escapeHtml()` helper applied consistently across every
  affected template. See `docs/security-audit-2026-08-10.md` for the full
  writeup.
- **Dependency advisories closed** (non-breaking patch bumps): `nanoid`,
  `js-yaml`, `dompurify`, `socket.io-parser`, and `brace-expansion`
  (`GHSA-2v37-7h3g-55p8`, `GHSA-5p4m-2wfm-xmqj`, `GHSA-55q2-fjhq-7xh7`,
  `GHSA-2m8v-j782-fhvr`, `GHSA-mh99-v99m-4gvg` / `GHSA-rgw5-rvv9-x895`).
  The `brace-expansion` fix closes the High-severity item carried forward
  as accepted risk from the previous audit.
- **`react-router` / `react-router-dom`** (moderate) remains accepted risk,
  unchanged from the last two audits — requires a major v6→v7 upgrade; not
  reachable in this codebase (client-only SPA, all navigation targets are
  internally constructed). Deferred to a dedicated migration.

### Quality gates

276 tests pass (271 + 5 new regression tests for the escaping fix); lint
clean; typecheck clean; RLS validation green (32 entities); release gate
green (23/23); build succeeds.

---

## [1.7.1] - 2026-07-27

### Security

Weekly automated audit. No application code, entity schema, or RLS rule
changed since the last audit — only bot-driven dependency bumps had landed
on `main` in the interim. This pass's dependency install surfaced three new
upstream advisories, all closed with non-breaking patch bumps:

- **dompurify** — `CUSTOM_ELEMENT_HANDLING` sanitizer bypass for allowed
  custom elements (advisory `GHSA-c2j3-45gr-mqc4`). Patched 3.4.11 → 3.4.12.
- **js-yaml** — quadratic-CPU denial of service via YAML merge-key chains
  (advisory `GHSA-52cp-r559-cp3m`). Dev-only tooling dependency. Patched
  4.2.0 → 4.3.0.
- **postcss / nanoid** — arbitrary source-map file disclosure via path
  traversal in sourcemap auto-loading (advisory `GHSA-r28c-9q8g-f849`).
  Dev-only build-tooling dependency. Patched 8.5.15 → 8.5.23 (nanoid
  3.3.12 → 3.3.16).

Two advisories were reviewed and accepted as risk rather than force-fixed
this round — see `docs/security-audit-2026-07-27.md` for the full
reasoning:

- **react-router / react-router-dom** (moderate) — the only fix requires a
  major v6→v7 upgrade. Liuma is a client-only SPA (no server-side
  rendering), so the SSR-hydration half of the advisory does not apply; the
  open-redirect half was checked against every navigation call site in the
  app and found not reachable (all in-app navigation goes through a helper
  that only ever builds internal, `/`-prefixed paths — never an
  externally-controlled URL). Deferred to a dedicated major-version
  migration.
- **brace-expansion** (dev-only, via the ESLint toolchain) — the only fix
  path force-downgrades `eslint-plugin-react`, a regression trade for a
  denial-of-service advisory that only affects local/CI lint execution,
  never the shipped application. Left as-is.

### Quality gates

271 tests pass; lint clean; typecheck clean; RLS validation green (32
entities); release gate green (23/23); build succeeds.

---

## [1.7.0] - 2026-07-13

### Release-metadata catch-up

Two PRs merged after v1.6.1 shipped without a version bump. This release
synchronizes version/changelog/docs with what was already deployed and adds a
fresh audit pass over both:

- **Branded in-app login screen.** `/login` now renders a LIUMA-branded
  email/password form instead of bouncing to the Base44-hosted login page.
  Remembered-identity silent re-auth ("Continuar como") is unchanged. Audited
  for credential handling, XSS, open redirect, and tenant-isolation bypass —
  no issues found.
- **Critical onboarding/role-approval fix.** A backend row-level security
  rule was missing the branch that lets trusted server-side operations
  create/read/update records during signup and role-change approval. This
  had silently blocked new users (both first admins and people joining an
  existing school) from getting an account created, and blocked role-change
  approvals. Restored, with no change to the stricter per-field protections
  added in v1.6.0 that keep normal users from editing their own role or
  approving their own request — re-verified in this audit.
- CI now runs typecheck and build on every push/PR, in addition to the
  existing lint, RLS validation, test, and release-gate checks.

### Audit

Full security / privacy / school-isolation / AI-safety pass performed; see
`docs/security-audit-2026-07-13.md`. No unresolved Critical or High findings.
Two Medium-severity AI-assistant observations recorded as accepted risk
pending a product decision (see audit doc) — Lumi's free-text chat path
relies on backend row-level security rather than the app-level capability
check when no structured intent is set, and Lumi's dictation-based diary/
attendance writes commit immediately without a separate confirmation step.
Neither allows cross-school, cross-classroom, or cross-family data exposure.

### Quality gates

271 tests pass; lint clean; typecheck clean; RLS validation green (32
entities); release gate green (23/23); build succeeds; `npm audit` — 0
vulnerabilities.

---

## [1.6.1] - 2026-07-06

### Security

- **react-quill / quill XSS advisory closed (Moderate).** The `react-quill`
  dependency (`quill ≤ 1.3.7`, advisory `GHSA-4943-9vgg-gr5r`) was found to be
  completely **unused** in the application source. It has been removed from
  `package.json`. `npm audit` now reports **0 vulnerabilities**.

### Added

- **Session management (AppSession).** Each authenticated browser tab now
  creates an `AppSession` record with the user's email, display name, device
  label, and timestamps. A heartbeat updates `last_active_at` every 60 seconds
  and checks for a `revoked_at` signal from ACACIA Mission Control (force-logout).
  Session rows are user-scoped via `created_by_id` (Base44 RLS); the platform
  service role can list and revoke sessions via the `acaciaControl` bridge.

### Build

- `@base44/vite-plugin` updated to `1.0.25`.
- `baseUrl` removed from `jsconfig.json` (deprecated in TypeScript 5.9; paths
  still resolve correctly via `moduleResolution: "bundler"` + `paths`). Typecheck
  is now clean with zero warnings.

### Quality gates

271 tests pass; lint clean; typecheck clean; RLS validation green (32 entities);
release gate green (23/23); build succeeds; `npm audit` — 0 vulnerabilities.

---

## [1.6.0] - 2026-07-03

### Security (full closure of role-escalation findings C1 / C2)

Completes what v1.5.0 started. v1.5.0 moved the maker-checker to a server function
but the **raw-SDK bypass stayed open** because Base44 RLS gates rows, not fields.
This release closes it with **field-level RLS (FLS)** plus an onboarding reroute.

- **C1 — closed.** `UserProfile.app_role` now carries FLS `write` restricted to the
  service role (`{"user_condition":{"role":"admin"}}`). Tenant admins (built-in
  `role: user`) and regular users can no longer write `app_role` directly — only the
  service-role functions can. Other fields (`status`, `welcome_message_shown`, …) stay
  writable, so admin user-activation in `Aprobaciones` and self-writes in `Home` are
  unaffected.
- **C2 — closed (defense-in-depth).** `PendingChange` `status`, `approver_profile_id`,
  `approver_user_id`, and `approved_at` now carry FLS `update` restricted to the service
  role, so an approval can only be written by `governRoleChange`. A forged approval is
  rejected, and even if one slipped through, the FLS lock on `app_role` means it can no
  longer apply a role.

**Onboarding reroute (required by the field lock)**
- New backend function `base44/functions/provisionOnboardingProfile/entry.ts` — onboarding
  self-wrote `app_role`, which the FLS lock now blocks, so the initial role assignment
  moves to this service-role function. It provisions **only the caller's own** profile and
  enforces the single privileged rule: a user may be provisioned as **ADMIN only as the
  founder of a brand-new school** (a school they created, with no other active admin).
  Everyone else joins an existing school as TEACHER/PARENT with status **PENDING** and must
  be activated by an admin. Existing profiles are never re-roled by onboarding.
- Shared rules in `src/lib/authorization/onboardingProvision.js`, unit-tested in
  `tests/unit/onboarding-provision.test.js`. `onboardingTenantCreation.js` now calls the
  function instead of writing `UserProfile` directly.

**⚠️ Ordered owner deploy (see `docs/security-role-governance-remediation.md`)**
Deploy in this order or you WILL break production:
1. Deploy the functions first — `governRoleChange` (from v1.5.0, if not already live) **and**
   `provisionOnboardingProfile`. Functions do not auto-deploy from GitHub.
2. Then deploy the schema (the FLS changes on `UserProfile` + `PendingChange`).
3. Verify onboarding (founder + joiner) and a role change end-to-end against the live backend.
Deploying the FLS schema before the functions exist blocks onboarding and role changes.

All 271 tests pass; lint clean; RLS validation green (31 entities); release gate green;
typecheck clean; build succeeds.

---

## [1.5.0] - 2026-07-03

### Security (role-change governance — findings C1 / C2)

Moves LIUMA's maker-checker for `UserProfile.app_role` from client-only enforcement
to a server-authoritative Base44 backend function. Previously the request →
second-admin-approval → apply flow was enforced only in the `PermisosRoles` UI, so a
direct SDK call could bypass it.

- **C1 — privilege escalation to ADMIN.** The `UserProfile.update` RLS rule grants
  every admin — and, through its self-branch (`data.user_id == {{user.id}}`), *any*
  authenticated user — write access to `app_role`. A raw
  `UserProfile.update({ app_role: 'ADMIN' })` bypassed the approval flow. (Broader
  than originally reported, which described only admin→any elevation.)
- **C2 — self-approval of a `PendingChange`.** The "approver ≠ requester" rule lived
  only in the client; Base44 RLS cannot express a field-to-field comparison
  (`approver_profile_id != requester_profile_id`), so a requester could approve their
  own request via the SDK.

**Changes**
- New backend function `base44/functions/governRoleChange/entry.ts` — the sole
  sanctioned path for role mutations. It establishes the caller's identity from
  `base44.auth.me()`, re-reads state with the service role, enforces admin-only,
  approver ≠ requester (checked on both profile id and user id), last-admin
  protection, tenant isolation, and duplicate-open-request rejection, then applies
  the mutation with the service role.
- `src/lib/authorization/roleGovernance.js` — shared, framework-agnostic maker-checker
  predicates (mirrored inside the function), unit-tested in
  `tests/unit/role-governance.test.js` (17 cases).
- `PermisosRoles.jsx` now routes every role-change request and approval/rejection
  through `governRoleChange`; the client no longer writes `app_role` or
  `PendingChange` approvals directly. Self role-changes are no longer applied
  instantly — they go through the same approval flow.

**Requires owner deploy (see `docs/security-role-governance-remediation.md`):**
- Deploy `governRoleChange` to the Base44 backend **before** merging (functions do not
  auto-deploy from GitHub). Until it is live, the wired UI depends on it.
- Full closure of the raw-SDK bypass additionally needs a per-field RLS lock on
  `UserProfile.app_role` (and `PendingChange` status/approver fields) plus routing
  onboarding's initial role write through a service-role function. This schema change
  puts onboarding in the blast radius and is staged for owner review/verification
  against the live backend rather than blind-deployed.

All 263 tests pass; lint clean; RLS validation green (31 entities); release gate green.

---

## [1.4.2] - 2026-07-02

### Security (dependency updates)

Automated security audit resolved dependency vulnerabilities via `npm audit fix`.
No application behavior changes. All 246 tests pass; RLS validation green; release gate green.

- **`@babel/core` ≤ 7.29.0 — Arbitrary File Read (Low)** — `GHSA-4x5r-pxfx-6jf8`.
  Resolved via transitive update; `@babel/core` is a build-only toolchain dependency,
  not in the deployed runtime.
- **`dompurify` ≤ 3.4.10 — three Moderate advisories** resolved via transitive update:
  - `GHSA-vxr8-fq34-vvx9`: Trusted Types policy survives `clearConfig()`
  - `GHSA-gvmj-g25r-r7wr`: `SAFE_FOR_TEMPLATES` bypass in `<template>` content
  - `GHSA-cmwh-pvxp-8882`: Permanent `ALLOWED_ATTR` pollution via `setConfig()`

**Remaining accepted vulnerabilities (unchanged):**
- `quill` ≤ 1.3.7 / `react-quill` XSS (Moderate) — breaking fix requires replacing
  the rich-text editor; deferred. Risk is mitigated: the editor is accessible only to
  authenticated ADMIN and TEACHER users within their own school tenant.

---

## [1.4.1] - 2026-06-23

### Security (RLS hardening, round 5)

Closes 4 critical Base44 security-scan findings about missing **platform-owner**
(`role: "admin"`) coverage on platform-governed entities. Applied to the Base44
backend via the entity-schema API and mirrored in `base44/entities/*.jsonc`;
full detail in `docs/rls-hardening-2026-06-23.md`.

- **School** — `create`/`delete` (were `null`) restricted to the platform owner.
- **SchoolSubscription** — `create` (was `null`) restricted to the platform owner.
- **SupportTicket** — platform owner can now `read`/`update` across all schools;
  `delete` (was `null`) is platform-owner-only.
- **SupportTicketMessage** — platform owner can `read` all messages.

Existing access is preserved: parents still open/read their own tickets and
messages; school ADMINs still manage tickets and read their own school +
subscription. No tenant `create` path was widened.

---

## [1.4.0] - 2026-06-22

Adds a **test-data seeder**: a connected, role-isolated sample dataset across
every entity, generated through the app so Base44 tags it `is_sample:true`
(hidden when Test Data mode is off).

### Added

- **`src/lib/testData/`** — a pure, deterministic `blueprint.js` describing the
  full graph (30 seeded entities; `School` reused, `User` provisioned
  separately) with symbolic foreign keys; `isolation.js` deriving per-role
  scopes from the RLS rules; and `seedTestData.js` which resolves refs, persists
  via the app SDK, attempts to provision fictitious role users, and reports the
  derived `User.data` scope fields.
- **`SeedTestData` page** (ADMIN-only route) — one-click seeding with safety
  warnings (must enable Test Data first) and an on-screen report; guards against
  double-seeding since the data API has no delete.
- **`docs/test-data-report.md`** — coverage matrix, role-isolation results,
  impersonation steps, and a pre-mortem (failure modes + proposed fixes).

### Tests

- `tests/integration/test-data-blueprint.test.js` (13) — referential integrity,
  required-field/single-tenant invariants, and role isolation (teachers limited
  to assigned classrooms, parents to linked children, classroom-notice scoping,
  admin sees all).

### Notes

- The Base44 data API cannot set `is_sample`, create `User` records, or delete —
  so the data must be generated in-app with Test Data ON, and the three role
  accounts are invited in Base44 (steps in the report).

---

## [1.3.6] - 2026-06-22

Rolls the `.ui-table` / `.ui-field` treatment (introduced in 1.3.5) across the
remaining admin consoles. Presentation only; no behavior, API, or data changes.

### Changed

- **`AuditoriaAdmin` (Auditoría)** — the audit log, previously a stack of cards,
  now renders as a compact **`.ui-table`** (Acción · Entidad · Fecha · Rol ·
  Actor · Razón · Detalle). Long values truncate with a tooltip and the masked
  JSON context is tucked behind a per-row collapsible **Detalle** cell, so rows
  stay scannable; an empty state spans the table.
- **`Reportes`** — the three hand-styled native `<select>` filters adopt
  `.ui-field` (tenant-brand focus ring), matching the rest of the controls.

### Tests

- `tests/unit/premium-tables.test.js` extended — `AuditoriaAdmin` renders the
  `.ui-table` with a collapsible context cell + empty state, and `Reportes`
  filters use `.ui-field` (old hardcoded class gone).

---

## [1.3.5] - 2026-06-22

Premium polish on **admin data tables & list density** — applied to the
governance matrix. Presentation only; no behavior, API, or data changes.

### Added

- **`.ui-table`** component utility: one disciplined data-table treatment — a
  sticky uppercase header, comfortable density, **zebra striping**, and a brand
  hover so dense rows stay scannable. Theme-aware (keyed off `--muted` /
  `--accent` / `--border`); per-cell Tailwind utilities still win where needed.
- **`.ui-field`** utility: native `<select>` / `<input>` styled to match the
  shadcn controls, including the tenant-**brand** focus ring.

### Changed

- **`PermisosRoles` (Permisos y Roles)** — the five raw permission/governance
  tables now use `.ui-table`; the eight hand-styled native `<select>`s use
  `.ui-field`; the permission-matrix and AI-capability checkboxes are tinted
  with `accent-brand`. Pure restyle — all maker-checker / audit logic untouched.

### Tests

- `tests/unit/premium-tables.test.js` — `.ui-table` / `.ui-field` are defined
  and theme-aware (no hardcoded hex), and `PermisosRoles` adopts the treatment
  (and no longer carries the old hardcoded native-select class).

---

## [1.3.4] - 2026-06-22

Tooling: a dev-only **visual preview harness** for design review. No production
app behavior changes.

### Added

- **Preview harness** (`preview.html` → `src/preview/`): renders the real
  premium components (`SideNav`, `BigTile`, `Card`, `PageHeader`, `EmptyState`,
  `LoadingScreen`, `Skeleton`, form fields, `Dialog`) against mock data — no
  base44 backend or auth required — so they can be viewed and screenshotted.
  `SideNav` is rendered headless via a mocked `NavContext` inside a `transform`ed
  containing block.
- **`npm run preview:dev`** (interactive: brand + dark toggles, opens the real
  dialog) and **`npm run preview:shots`** (`PREVIEW=1 vite build` + a Playwright
  capture script → `docs/screenshots/*.png`). Playwright added as a devDependency.
- `docs/preview-harness.md` — how to run it.

### Changed

- `NavContext` is now exported (so the harness can mock it); the app still uses
  `NavProvider` / `useNav` exclusively.
- `vite.config.js` adds `preview.html` as a second build entry **only** when
  `PREVIEW=1`, so a normal `npm run build` is byte-for-byte unchanged.

### Tests

- `tests/unit/preview-harness.test.js` — harness files/scripts present, the
  preview entry is gated behind `PREVIEW`, `NavContext` is exported, and the
  gallery imports the real components.

---

## [1.3.3] - 2026-06-22

Premium polish on the **empty & loading states** — the fourth leg of the UI
elevation work. Cosmetic only; no behavior, API, or data changes.

### Changed

- **On-brand `LoadingScreen`:** the full-screen loader (shown on ~10 pages) was
  hardcoded to a violet/indigo mark on a slate gradient. It now rides the tenant
  **`brand`** token and theme surfaces — the mark mirrors the desktop nav rail's
  brand chip — so it re-skins per school. Spinner now honors reduced motion.
- **`EmptyState`:** flat grey icon circle replaced with a brand-tinted rounded
  chip (`bg-brand/10` + inset brand ring), matching the nav rail and home tiles.
- **`Skeleton`:** flat pulse replaced with a premium `ui-shimmer` sweep — a soft
  highlight keyed off the theme foreground (adapts to light/dark; neutralized
  under reduced motion).

### Added

- `ui-shimmer` utility + `@keyframes ui-shimmer` (theme-aware loading sweep).

### Tests

- `tests/unit/premium-empty-loading.test.js` — LoadingScreen is on-brand (no
  hardcoded hues) and honors reduced motion, EmptyState uses the brand chip, and
  Skeleton uses the theme-aware shimmer utility.

---

## [1.3.2] - 2026-06-22

Premium polish pass on the **form & dialog surfaces** — the third leg of the
UI elevation work (after the desktop rail and the shared card/header surfaces).
Cosmetic only; no behavior, API, or data changes.

### Changed

- **Unified brand focus state:** `Input`, `Textarea`, and the `Select` trigger
  now share one focus treatment keyed off the tenant **`brand`** token — a soft
  `ring-brand/25` ring + `border-brand` — instead of the generic grey ring, plus
  a subtle hover border. Fields are now `rounded-lg`, harmonized with `Button`
  (also `rounded-lg`).
- **Select menu:** softer `rounded-xl` popover with a lighter border and deeper
  shadow; items use brand-tinted focus (`bg-brand/10` / `text-brand`) and a
  brand check mark, matching the navigation's active-state language.
- **Dialogs:** premium modal treatment — a **blurred scrim** (`backdrop-blur`),
  `rounded-2xl` corners, a stronger `shadow-2xl` elevation, and a refined
  circular close button with a brand focus ring.

All color rides the tenant brand token — no hardcoded hex — so every school's
palette re-skins it.

### Tests

- `tests/unit/premium-forms.test.js` — inputs/textarea/select share the brand
  focus ring (no hardcoded hex), select items use brand-tinted focus + check,
  the dialog has a blurred scrim / rounded corners / strong elevation, and the
  button radius harmonizes with the fields.

---

## [1.3.1] - 2026-06-22

Premium UI polish pass extending the v1.3.0 desktop-rail redesign across the
shared surfaces. Cosmetic + one additive, optional prop; no behavior or data
changes.

### Changed

- **Premium card elevation:** the app-wide `Card` primitive now uses a shared
  `ui-elevation` surface — a two-layer soft shadow keyed off the theme
  `foreground` color (with alpha) so it adapts to light/dark instead of a flat
  grey drop shadow. Hairline border softened to `border-border/70`. Home tiles
  (`BigTile`) adopt the same resting elevation for a consistent, substantial
  feel.
- **PageHeader** refined: larger display title on wide screens, more breathing
  room, and subtle hover borders on the back/search controls.

### Added

- **`PageHeader` `eyebrow` prop** — an optional brand-tinted context label
  (e.g. *Administración*, *Plataforma*) above the title, with a small brand
  accent. Adopted on the Pagos (admin), Reportes, and Soporte admin consoles.
- `ui-elevation` / `ui-elevation-hover` utilities (theme-aware soft shadows).

### Tests

- `tests/unit/premium-ui.test.js` — Card uses `ui-elevation`, the elevation
  utilities are theme-aware, and PageHeader supports `eyebrow` while keeping its
  a11y controls and staying on the tenant brand token (no hardcoded hex).

---

## [1.3.0] - 2026-06-22

Additive UX + support pass. No breaking API or data changes; one optional,
backward-compatible field added to the `SupportTicket` entity.

### Added

- **Persistent desktop navigation rail** (`src/components/nav/SideNav.jsx`):
  on `md` and wider, the role's full menu now lives permanently on the left so
  switching sections no longer means bouncing back to the home grid. It reads
  the **same single source of truth** as the mobile bottom bar and the ⌘K
  command palette (`navRegistry`) — destinations are curated in exactly one
  place. The active item is marked with an accent left border + tinted brand
  background and `aria-current="page"`, mirroring the bottom bar's brand
  indicator. Navigation is client-side (`<Link>`), so router state and the React
  Query cache are preserved (no hard reload). Mobile is unchanged: it keeps the
  four-item `BottomNav`, and the rail is `hidden md:flex`.
- **Support ticket diagnostics ("smart hook")**
  (`src/lib/support/diagnostics.js`): opening a ticket now auto-bundles the
  technical context support would otherwise have to ask for — current route /
  screen, app version, browser/viewport/language, and a bounded ring buffer of
  recent client `console.warn`/`console.error` output. The requester still only
  types their complaint; their **role and identity were already captured**.
  Support staff see the bundle parsed in a collapsible *"Diagnóstico técnico"*
  panel inside the ticket thread (`TicketThread`). Capture is best-effort and
  never blocks ticket creation, and reads nothing sensitive (only the user's own
  console output and public environment facts).
- New optional `client_context` field on the `SupportTicket` entity
  (JSON-encoded string; not required; excluded from RLS predicates).
- Build-time `__APP_VERSION__` define (sourced from `package.json`), surfaced in
  the support diagnostics bundle.

### Changed

- `Layout.jsx` mounts the new desktop rail and offsets desktop content
  (`md:pl-60`) so the fixed rail never covers a page; installs the console
  capture once at boot.

### Tests

- `tests/unit/side-nav.test.js` — rail reuses `navRegistry`, navigates with
  client-side `<Link>` (no reload), marks the active item, is desktop-only, and
  is mounted + offset by `Layout`.
- `tests/unit/support-diagnostics.test.js` — context snapshot is
  JSON-serializable, the console ring buffer retains and bounds entries, and the
  staff summary formats (and tolerates empty input).

> Note: the sibling `claude-skills` repository contains generic Anthropic/Claude
> authoring skills (pdf, xlsx, brainstorming, math-olympiad, …). They are
> assistant tooling used to *build* LIUMA — **not** application features — and
> are intentionally not integrated into the product or its user manual.

---

## [1.2.0] - 2026-06-22

### Changed

- **Quality pass (`/simplify`) on the session's new code:**
  - **`useRunOnce` hook**: the app's two opportunistic "admin sweep" effects
    (auto-escalate breached tickets on the support queue; send due event
    reminders on the admin calendar) were near-identical hand-rolled
    once-per-load `useState`+`useEffect` latches. Extracted into one
    `useRunOnce(ready, run)` hook (ref-based, so flipping the latch doesn't
    re-render) and adopted in both places.
  - **Event reminders now go through `notificationService`** (retry +
    delivery-failure audit) using a new `event_confirmation_reminder` template,
    instead of calling `SendEmail` directly with an inline HTML body — the
    EventResponse lookup is batched (`$in`) and the per-parent sends run via
    `Promise.allSettled`.
  - **`getGroupedDestinations`** simplified to a single insertion-ordered `Map`.
  - **`PageHeader`** gained a `showSearch` opt-out and only renders the search
    button once a role is resolved (no dead control on pre-profile screens).
- **Bottom-nav active state (frontend-design pass):** replaced the plain
  color-swap active tab with a single brand-colored indicator that springs
  between tabs (shared `layoutId`) to mark location — the one deliberate
  flourish, with everything else kept quiet; derives its color from the tenant
  brand token and respects reduced motion. The command palette's empty state is
  now directional ("Nada con ese nombre. Prueba con otra palabra.") rather than a
  dead "Sin resultados."

### Added

- **Event-confirmation reminders, rebuilt correctly**: parents who haven't
  confirmed attendance for an event get a reminder when its `confirmation_deadline`
  is 3 days out. The previous implementation lived inside a parent page's read
  query and targeted `EventResponse` rows with `response: 'PENDING'` — which are
  never written (the form only writes `ACCEPTED`/`DECLINED`; non-responders have
  no row), so it could never actually remind anyone. The reminder now resolves
  the real **non-responders** per event scope (`SCHOOL` → all active students'
  parents; `CLASSROOM` → that classroom's parents, minus anyone with an existing
  response) and emails them. It runs opportunistically and idempotently from the
  admin calendar (no cron in this app), mirroring `autoEscalateBreachedTickets`:
  once per load, `reminder_sent` guards re-sends, each email is independently
  error-handled, and the deadline check compares at day granularity so it isn't
  thrown off by time-of-day. Pure selectors (`selectEventsNeedingReminder`,
  `selectNonResponders`) are unit-tested.

### Changed

- **`GlobalLumiBubble` reuses the shared profile hook**: replaced its own
  separately-keyed `globalLumiUserProfile` UserProfile fetch with
  `useCurrentProfile()`, so the assistant bubble shares the app-wide
  `['userProfile', user.id]` cache instead of issuing a duplicate request.

### Removed

- **Dead `user.data.linked_student_ids` fallback** in `getLinkedStudents`:
  `base44.auth.me()` returns the user flat on the client (`user.data` is always
  undefined), and `linked_student_ids` only exists as a server-side RLS token
  with no client-accessible source, so the fallback never executed. Removed it;
  parent→student linkage continues to come from the `ParentStudent` table.

### Fixed

- **Admin pages that silently never loaded** (`GestionPedidosAdmin`,
  `GestionDescuentos`, `GestionDocumentos`) and the uniform catalog in
  `PedidosUniformes` plus the parent **EventosParaPadres** list read their tenant
  scope from `user.data.school_id`. `base44.auth.me()` returns the user flat
  (`user.id`), so `user.data` was always `undefined` → those queries were
  permanently disabled and showed nothing. Now they read `userProfile.school_id`
  (the canonical scope used everywhere else), so the pages work. A unit test
  guards against any page reading `school_id` off the auth user again.
- **Parent events page no longer sends email on load**: `EventosParaPadres`'s
  read query contained a misplaced block that emailed all pending parents and
  flipped `Event.reminder_sent` as a side effect. It never ran in production
  (the query was disabled by the bug above), but the `school_id` fix would have
  activated unintended mass emails from a parent-facing page. Removed it; the
  page now only displays events. (The auto-reminder feature needs a proper
  admin/cron home — see follow-ups.)
- **Lumi bubble no longer overlaps the mobile bottom nav**: lifted to `bottom-20`
  on mobile (the nav is 64px tall) while staying at `bottom-6` on desktop.
- **Page headers truncate long titles** instead of crowding the search/action
  buttons (`min-w-0` + `truncate` + `shrink-0`).

### Changed

- **`useCurrentUser` / `useCurrentProfile` hooks** (full rollout): added a lighter
  `useCurrentUser` (user only, no profile fetch) and adopted the hooks across the
  remaining pages — including the imperative `setUser`/`setUserProfile`-in-queryFn
  pages (`Asistencia`, `ResumenAsistencia`, `CalendarioEscolar`) and the
  `school_id`-bug pages above. `useCurrentProfile` now builds on `useCurrentUser`;
  newly-activated pages gained a `profileLoading || isLoading` guard so they show
  a loader (not an empty flash) while the profile resolves. `Home` is the one
  intentional holdout — it uses `selectCurrentUserProfile` for multi-tenant
  selection plus a welcome-modal side effect the generic hook doesn't model.
- **`useCurrentProfile` hook** (maintenance / de-duplication): the authenticated
  user + `UserProfile` two-query pattern was copy-pasted verbatim into ~26 pages.
  Extracted into `src/hooks/useCurrentProfile.js` and adopted across **25 pages**
  (net −218/+54 lines). The hook reuses the existing `['currentUser']` /
  `['userProfile', user.id]` query keys, so the react-query cache is shared and
  there is **no behavior change**. Pages that destructure differently were
  preserved exactly: `Aprobaciones` keeps its `currentUser` name via
  `const { user: currentUser } = useCurrentProfile()`, and `PermisosRoles` maps
  its split loading flags to the hook's combined `isLoading`. Intentionally left
  untouched: pages with a different architecture (`Home`, `Asistencia`,
  `ResumenAsistencia`, `CalendarioEscolar` set state imperatively inside the
  query fn) and pages that never needed the profile query. (Note on the original
  "merge duplicate pages" request: the role-split Avisos/Pagos/Soporte pages are
  genuinely different views — consume vs. author, view vs. configure, file-ticket
  vs. triage-console — *not* duplicates, so they were deliberately not collapsed
  into single role-branched pages, which would have added complexity. Only the
  shared boilerplate was de-duplicated.)

### Added

- **Mobile bottom navigation + command palette** (UX simplicity): a persistent
  4-tab bottom bar — Inicio · Hoy · Avisos · Más — so any screen is one tap away
  instead of bouncing back to the home grid. The palette (search or browse the
  role's full menu) opens three ways: the **Más** tab, a visible **search button
  in every page header**, and the **⌘K** shortcut. Palette state lives in a
  `NavProvider` (mounted once from `Layout.jsx`) so the header, the tab and the
  shortcut all drive a single palette; `useNav` is safe to call without the
  provider. Tabs and palette share one pure, unit-tested role-aware registry
  (`src/components/nav/navRegistry.js`). The bar hides until a profile/role is
  available (keeping it off login/onboarding); the Avisos tab resolves per role
  (`Avisos`/`AvisosMaestro`/`AvisosAdmin`). Mobile-only (`md:hidden`); desktop is
  unchanged. First step toward thinning the 18-tile admin home.
- **Sequential L1 → L2 support handoff (director → soporte)**: completes the
  escalation chain so a ticket the school director can't resolve rolls up to
  soporte. Two triggers, both landing in the existing Tier-2 email + 48 h SLA:
  a manual **"Escalar a soporte"** action in the director's queue
  (`SoporteAdmin.jsx`, hidden for owners and non-school-tier tickets), and
  **automatic escalation** when a director-tier ticket's SLA lapses with no
  first response (`autoEscalateBreachedTickets`, run opportunistically on queue
  load since the app has no cron). `escalateTicketToSupport` re-tiers the ticket
  to PLATFORM, restarts the 48 h clock, posts a system note, emails soporte and
  audit-logs the handoff; the breach-selection logic
  (`selectTicketsToAutoEscalate`) is a pure, unit-tested function.
- **Tier-2 support escalation email**: the help desk escalates Lumi (L0) →
  school director (L1) → platform owner "soporte" (L2). The platform tier
  previously resolved its recipient via `UserProfile.filter({ is_super_admin })`,
  which returns nobody on deployments without that field — so Tier-2 escalations
  notified no one. Platform-tier escalations now always send an automated email
  to a fixed Tier-2 inbox (`SUPPORT_EMAIL = soporte@acaciaco.com.mx`, a committed
  constant in `src/lib/support/constants.js`) via a new
  `notificationService.sendEventEmailTo` helper, and platform-tier tickets get a
  fixed **48-hour SLA** (`computeSlaDueAt` is now tier-aware). Covered by
  `tests/unit/support-escalation-email.test.js`. Owner contact stays server-side;
  see `.env.example`.

### Security

- **C3 — RLS no longer trusts the self-grantable `is_super_admin` flag**: that
  field is undeclared and self-writable by any school admin, yet `School` and
  `SchoolSubscription` RLS used it to grant cross-tenant read/write/delete. All
  `is_super_admin` branches were removed; the real ACACIA owner retains access
  via the base44 account role (`role: admin`), which tenants cannot self-assign.
- **C4 — `SchoolSubscription` writes are now owner-only**: a school admin could
  set their own `subscription_status`/`license_tier`/expiry to bypass the
  paywall and read-only write-guard. `update`/`delete` RLS is restricted to the
  platform owner (`role: admin`); tenant admins keep read access. The only field
  a tenant admin legitimately wrote there — `welcome_message_shown` — moved to
  the self-writable `UserProfile`, so the admin-only trial welcome modal still
  works (now tracked per-user instead of per-school). Covered by
  `tests/unit/rls-super-admin-hardening.test.js` and
  `tests/unit/rls-subscription-owner-only.test.js`.

### Fixed

- **Accessibility sweep (round 2) — icon-only controls and reduced motion**:
  every icon-only button flagged by the navigation audit now has a Spanish
  `aria-label` so screen-reader users know what it does — the app-wide
  `PageHeader` back button ("Volver"), calendar month navigation ("Mes
  anterior"/"Mes siguiente") and event delete ("Eliminar evento"), the Avisos
  filter toggle, the Bitácora day navigation, the uniform-order remove-item
  button, and the emergency-contact delete button. The arrow glyphs in the
  calendar month nav are now `aria-hidden`. `EmptyState` now respects
  `prefers-reduced-motion` like the rest of the app's animated chrome. Covered
  by `tests/unit/icon-button-a11y.test.js`.

## [1.1.0] - 2026-06-21

### Added

- **In-app User Manual (`USER_MANUAL.md`)**: a truthful, role-organized manual
  generated from the actual application — every page in `src/pages/` with its
  route and who can access it (cross-referenced against
  `src/lib/authorization/routeAccess.js`), the core data entities, and a
  corrected description of the Lumi AI assistant. Notably corrects the prior
  claim that Lumi "only provides information": per `base44/agents/lumi.jsonc`,
  Lumi can **create `DiaryEntry` and create/update `Attendance`** in the teacher
  dictation flow.
- **Security audit (`docs/security-audit-2026-06-21.md`)**: a documented audit of
  the authorization layer and base44 RLS, ranking findings by whether RLS
  actually backs each client-side check. Captures four Critical server-side
  privilege-escalation paths (self-elevation to ADMIN, self-grant of the
  cross-tenant `is_super_admin` flag, self-activation of `SchoolSubscription`,
  and self-approval of `PendingChange`) with concrete remediation. These RLS
  changes are intentionally **not** auto-applied — they require staged review.
- **`VERSION_CONTROL.json`**: a versioning manifest describing the build
  architecture, page/entity/test inventory, roles, and quality gates.

### Fixed

- **Audit-trail integrity — `AuditLog.action` enum completed**: the enum listed
  only 12 operational actions, but the code emits ~20 more, including the
  security-critical `PERMISSION_CHANGE`, `POLICY_DECISION`, `owner_override`,
  `access_denied`, and the `ROLE_CHANGE*` family (from `src/lib/audit.js`,
  `GuardedRoute.jsx`, `PermisosRoles.jsx`). If base44 enforces the enum, those
  audit writes were failing silently, leaving security events untraced. The enum
  now covers every action string the app writes, guarded by
  `tests/unit/audit-action-enum.test.js`.
- **Scroll position resets on navigation**: navigating from a long dashboard into
  a deep page (or back) preserved the previous scroll offset, landing users
  mid-page. `App.jsx` now resets scroll to the top on every route change
  (`ScrollToTopOnNavigate`).
- **404 page no longer hard-reloads the app**: the "go home" control used
  `window.location.href = '/'` (a full page reload that drops the SPA, router
  state, and React Query cache). It now uses a client-side `<Link to="/">`. The
  page copy was also translated to Spanish (`Página no encontrada` / `Ir al
  inicio`) and the build-tooling hint is gated to development only.
- **Login redirect moved out of render**: `AuthenticatedApp` called
  `navigateToLogin()` directly in the render body (a side effect during render
  that can double-fire under StrictMode/concurrent rendering); it now runs in a
  `useEffect`.
- **Screen-reader badge counts on home tiles**: `BigTile`'s accessible name now
  folds in the pending count (e.g. "Avisos, 3 pendientes") instead of exposing
  only the title.

### Changed

- **Paywall master-switch documentation corrected**: `useFeatureGate.js` and
  `featureGates.js` comments described `VITE_PAYWALL_GATING_ENABLED` as
  off-by-default, but the code (`!== 'false'`) is **on-by-default**. The docs now
  match the code; whether on-by-default is the intended billing behavior is
  flagged for the owner in the security audit (no runtime behavior was changed).

### Added (1.0.x → 1.1.0 carried from prior unreleased work)

- **Distinctive visual design system ("the school is the hero")**: replaced the
  stock shadcn starter palette with a warm, calm surface system and a real type
  pairing — **Bricolage Grotesque** (display, used on page-level headings only)
  + **Inter** (body), loaded via `index.html` and exposed as `--font-display` /
  `--font-sans`. The tenant's own brand color is now the single loud element:
  the three home dashboards (parent/teacher/admin) lead with a branded greeting
  band and their tiles are grouped into labeled sections instead of an
  undifferentiated rainbow stack. New shared chrome in
  `src/components/home/HomeChrome.jsx` (`HomeHeader`, `HomeSection`). Reduced
  motion is now respected (global CSS floor + `useReducedMotion` in `BigTile` /
  `PageHeader`), and the app is titled **liuma**.

- **Onboarding privacy consent (LFPDPPP)**: the final onboarding step now
  requires two explicit acceptances before an account can be created — the
  **Aviso de Privacidad** (general) and **express consent for processing minors'
  sensitive data** (blood type, allergies, medical notes), with role-specific
  wording for parents vs. staff. The accepted notice version, scopes, timestamp,
  and user agent are persisted best-effort to a new `ConsentRecord` entity and,
  as a durable fallback, to `AuditLog` (`PRIVACY_CONSENT_ACCEPTED`) — so consent
  is recorded even before the entity exists in Base44. New pure module
  `src/lib/consent/privacyNotice.js` (+4 tests, 115 total). Publish the real
  Aviso de Privacidad and set `PRIVACY_NOTICE_URL` / `PRIVACY_NOTICE_VERSION`.

### Fixed

- **Home navigation tiles are now keyboard operable**: `BigTile` — the primary
  navigation control on every home dashboard (parent/teacher/admin) — rendered
  its non-link variant as a bare `<div role="button">` with no key handler, so
  Enter/Space did nothing and keyboard/AT users could not activate it. It now
  handles Enter/Space (with `preventDefault`), exposes an `aria-label` from its
  title on both the link and button branches, and shows a `focus-visible` brand
  ring — matching the accessible day-cell pattern already used in
  `CalendarioEscolar`. Covered by `tests/unit/bigtile-a11y.test.js`.

- **White-label theming now actually reaches the UI**: every shadcn component
  reads `--primary`, but `Layout.jsx` hardcoded it to indigo (`99 102 241`) as
  an RGB triple fed into Tailwind's `hsl(var(--primary))` — invalid CSS that
  disconnected each school's logo-extracted brand color from buttons, rings,
  badges, etc. `buildThemeCssVars` now derives `--primary`/`--ring`
  (HSL triplet), `--primary-foreground` (contrast-aware), and an RGB-channel
  `--tenant-primary-rgb` from the tenant palette, surfaced as a first-class
  Tailwind `brand` color so brand tints (`bg-brand/10`, `border-brand/40`)
  compile correctly. The stale `--primary` override was removed from `Layout`.

### Changed

- **Support owner detection hardened**: the cross-tenant support queue
  (`SoporteAdmin`) no longer depends solely on `UserProfile.is_super_admin` —
  which a live schema check (app `696e967c…`) showed is not a field on the
  deployed `UserProfile`. Ownership now also falls back to the authenticated
  Base44 `User.role === 'admin'` via a new pure helper
  `src/lib/support/owner.js` (`isPlatformOwner`), covered by 3 new tests (111
  total). `listQueueTickets` takes an explicit `isOwner` flag.

### Documentation

- **`docs/base44-entity-setup.md`**: copy-paste runbook (AI-chat prompt +
  manual field/RLS tables) to create the `SupportTicket` / `SupportTicketMessage`
  entities in the Base44 Builder, which a live entity-list check confirmed do
  not exist yet.

### Added

- **Support desk (two-tier help desk)**: parents, teachers and directors can now
  get help from inside the app.
  - **L0 — Lumi deflection**: a new `SUPPORT_REQUEST` Lumi capability answers
    common questions from the user manual before any ticket is created.
  - **L1 — ticketing**: when the AI can't help, a `SupportTicket` is opened with
    a human-friendly number (`LIUMA-2026-000042`), an SLA deadline, and a
    threaded conversation. Two-tier routing sends school questions to the
    requester's **director** and app/billing issues to the **platform owner**;
    a director's own tickets go to the owner.
  - **SLA (relaxed)**: first-response targets in business days — URGENT 1, HIGH 2,
    NORMAL 3, LOW 5. The clock stops at the first staff reply; the management
    console flags breaches.
  - **Consoles**: requester view (`Soporte`, all roles) and management queue
    (`SoporteAdmin`, ADMIN — owner sees all tenants) with status state machine,
    priority filters, and email + in-app notifications on escalation, reply and
    resolution.
  - **Authorization & audit**: `SupportTicket` / `SupportTicketMessage` added to
    the policy matrix and route-access map; ticket create/message/status changes
    are written to `AuditLog`.
  - **Backend dependency**: requires the `SupportTicket` and `SupportTicketMessage`
    Base44 entities (schemas + RLS documented in `docs/support-system.md`) to be
    created before go-live. App, lint and the test suite (108 tests) are green.

### Removed

- **Stripe dependencies removed**: `@stripe/react-stripe-js` and `@stripe/stripe-js`
  were listed in `package.json` but never imported anywhere in `src/` — the payments
  pages only read and display `ChargeItem` records, with no card-processing flow.
  Payment collection is handled through Mercado Pago, so the unused Stripe packages
  were dropped to slim the dependency tree and avoid implying a Stripe integration
  exists. No application code changed; the full 87-test suite and build remain green.

---

## [1.0.8] - 2026-06-15

### Documentation

- **Authorization matrix corrected**: The open-gaps table still listed "No automated Node.js CI pipeline | High | Open" even though that gap was closed in v1.0.7 by adding `.github/workflows/ci-node.yml`. Updated to "Fixed (v1.0.7)".
- **New security finding documented**: `esbuild` ≤ 0.28.0 (GHSA-gv7w-rqvm-qjhr) — Missing binary integrity verification in Deno module enables RCE via `NPM_CONFIG_REGISTRY`. This is a build-tool supply-chain advisory; the deployed runtime is not directly exposed. The upstream fix requires upgrading to vite ≥ 8 (a breaking major-version change). Risk accepted and deferred — documented in the authorization matrix open-gaps table and in this changelog.
- **Version metadata synchronised**: `docs/authorization-matrix.md` header and `docs/user-manual.md` header updated from 1.0.6 to 1.0.8 to match `package.json`.

### Security — CI / Build toolchain

- **`esbuild` GHSA-gv7w-rqvm-qjwr** (High — build toolchain only): `esbuild` ≤ 0.28.0 ships a Deno entry-point that performs binary downloads without integrity verification, enabling RCE if `NPM_CONFIG_REGISTRY` is pointed at a malicious registry during `npm install`. This affects only the build and CI environment, not the deployed application bundle. Mitigation: CI runs only on GitHub-hosted runners against the pinned `package-lock.json`; no custom registry is configured. The upstream fix (vite ≥ 8) is a breaking major-version change — deferred to the next planned dependency-update cycle.

---

## [1.0.7] - 2026-06-08

### CI / Tooling

- **Automated Node.js CI pipeline added** (`.github/workflows/ci-node.yml`):
  closes the release-readiness gap where the JavaScript/React frontend had no
  automated checks (only the Deno backend was covered by `ci-deno.yml`). The new
  workflow runs on every push and pull request and executes `npm ci`,
  `npm run lint`, `npm test` (the full 87-test suite), and the
  `npm run release:gate` permission gate on Node 22.

### Notes on deferred items

- **Security headers** (CSP / X-Frame-Options / Permissions-Policy) remain a
  host-level concern: LIUMA is served from the Base44 edge, so these headers
  cannot be enforced from the application repository and must be configured on
  the hosting platform.
- **`react-quill` / `quill` moderate advisory** remains an accepted, documented
  risk: the only fix offered by `npm audit` is a breaking downgrade, and the rich
  text editor is restricted to admin/teacher roles.

## [1.0.6] - 2026-06-08

### Documentation

- **Authorization matrix corrected**: `/Asistencia` route was incorrectly listed
  as PARENT-only in `docs/authorization-matrix.md`. The route access code
  (`routeAccess.js`) and the page itself (`Asistencia.jsx`) confirm it is
  accessible to both TEACHER and PARENT roles — teachers use it to record daily
  attendance; parents use it to view their children's records. Fixed the matrix
  and updated `docs/user-manual.md` to match.
- **Authorization matrix extended**: Added the four entities introduced in RLS
  hardening rounds 2–4 that were previously undocumented in the matrix:
  `OfficialDocument`, `NoticeDelivery`, `PendingChange`, and `PermissionOverride`.
- **Version metadata synchronised**: `package.json` was stuck at `1.0.1` while
  the CHANGELOG progressed through four security-hardening releases (1.0.2–1.0.5).
  All version references — `package.json`, `docs/authorization-matrix.md`, and
  `docs/user-manual.md` — are now aligned at 1.0.6.
- **Owner identity note added**: The authorization matrix now records that
  `VITE_OWNER_EMAIL` / `VITE_OWNER_USER_ID` are no longer embedded in the client
  bundle (fixed in v1.0.5 / PR #90). Owner status is derived from the
  server-persisted `UserProfile.is_super_admin` flag.

## [1.0.5] - 2026-06-04

### Security

- **RLS hardening round 4 (Base44 entity schemas)**: addressed 1 critical finding
  from a follow-up Base44 security scan. See
  `docs/rls-hardening-2026-06-04-round4.md`.
  - `OfficialDocument`: `read` is now limited by `target_audience` and role
    (admins all; teachers `TODOS`/`MAESTROS`; parents `TODOS`/`PADRES`) instead
    of being readable by any user in the school. `UNIFORM_CATALOG` documents stay
    readable by all in-school roles so the parent uniform-ordering flow keeps
    working regardless of the catalog's audience tag. `create`/`update`/`delete`
    remain admin-only.

## [1.0.4] - 2026-06-04

### Security

- **RLS hardening round 3 (Base44 entity schemas)**: addressed 2 further critical
  findings from a follow-up Base44 security scan. See
  `docs/rls-hardening-2026-06-04-round3.md`.
  - `ChargeItem`: restricted `update` back to school admins only. The round-2
    parent-update branch had no field restriction, so a parent could have
    modified financial fields (e.g. `amount`); admin-only update closes that hole.
    `src/pages/Pagos.jsx` no longer writes `OVERDUE` from the parent view — the
    "Vencido" state was already derived locally from `due_date`, so the now-
    unauthorized write was removed with no UI change for parents.
  - `NoticeRead`: added `school_id` and scoped `create`/`read` to the user's own
    tenant (was keyed on `user_id` only), preventing cross-tenant read-receipts.

## [1.0.3] - 2026-06-04

### Security

- **RLS hardening round 2 (Base44 entity schemas)**: addressed 8 more critical
  row-level security findings plus 2 ChargeItem authorization failures from a
  follow-up Base44 security scan. See `docs/rls-hardening-2026-06-04-round2.md`
  for the full per-entity record.
  - `DiaryEntry`, `Homework`: removed role-only read branches that let any
    teacher or parent read every row; reads are now scoped to assigned
    classrooms (teacher) and linked students/classrooms (parent).
  - `Event`: made the admin read branch explicit (admins read all school events).
  - `SchoolSubscription`: scoped `update`/`delete` to the school's own admin
    (was platform-`admin`-only and not tenant-scoped), restoring cross-tenant
    isolation.
  - `ChargeItem`: allowed parents to create `EVENTO` charges for their linked
    students and to update their children's charges (unblocks event-charge
    creation in `EventosParaPadres.jsx` and `PENDING→OVERDUE` updates in
    `Pagos.jsx`).
  - `NoticeDelivery`, `PendingChange`, `PermissionOverride`: formalized these
    previously schema-less (and RLS-less) entities with strict rules — own/
    teacher-classroom/admin reads for deliveries; admin-only for the other two.

## [1.0.2] - 2026-06-04

### Security

- **RLS hardening (Base44 entity schemas)**: addressed 9 critical row-level
  security findings from the Base44 security scan. See
  `docs/rls-hardening-2026-06-04.md` for the full per-entity record.
  - `ChargeItem`: removed an unscoped parent read branch that exposed every
    charge in the school; parents now read only their linked students' charges.
  - `UserProfile`: restricted reads to the owner and school admins; removed a
    malformed teacher branch that exposed all profiles in the school.
  - `SchoolSubscription`: restricted reads to school admins; removed the create
    rule so onboarding is not blocked.
  - `Classroom`, `Student`, `Notice`, `Event`: added explicit role + tenant
    validation on teacher/parent read branches; parents can now read their
    children's classroom events.
  - `AuditLog`: restricted create to admins and teachers within their school.
  - `School`: removed the create RLS rule; tenant creation is handled by the
    onboarding backend flow.
- Documented the two outstanding HTTP security-header recommendations
  (`X-Frame-Options`, `Permissions-Policy`) as host-level (Base44 edge)
  configuration. See `docs/rls-hardening-2026-06-04.md`.

---

## [1.0.1] - 2026-06-02

### Security

- Removed PII (actor email) from browser console output in access-denied audit events. Audit data continues to be persisted to the AuditLog entity; only the browser-console log was trimmed. The console now logs only `event`, `route`, and `reason`, and only in development mode.
- Applied all safe dependency updates via `npm audit fix`. Reduced npm vulnerability count from 26 to 2.
- Documented `requiresAuth: false` SDK setting to clarify that auth enforcement is handled by the Base44 backend and the app's `GuardedRoute` layer — not suppressed.

### Known open issues

- `react-quill` (rich-text editor) depends on `quill ≤ 1.3.7` which has a moderate XSS advisory. A fix requires a breaking upgrade to a different editor; deferred to a future release. Risk is reduced because the rich-text editor is accessible to authenticated admin and teacher users only.

---

## [1.0.0] - 2026-06-01

### Added

- **Multi-role access control**: ADMIN, TEACHER, PARENT roles enforced at route and entity level.
- **Tenant isolation**: every data query is scoped to `school_id` from the authenticated user profile.
- **GuardedRoute**: declarative route-level access guard enforcing ROUTE_ACCESS matrix.
- **Policy engine** (`src/lib/authorization/policy.js`): entity-level read/write decisions with row-level filtering for TEACHER (classroom) and PARENT (student).
- **Permission overrides**: admins can grant or deny per-resource permissions to individual user profiles via the Permissions & Roles page.
- **Admin safety**: self-permission changes and last-admin removal are blocked.
- **Tenant danger zone**: high-risk operations (delete tenant, reset data, transfer ownership) require second admin approval and explicit reason text.
- **Lumi AI assistant**: school-scoped AI chat for ADMIN, TEACHER, and PARENT roles with capability-level access control. PARENT access is further scoped to their linked students.
- **Onboarding flow**: school/tenant creation for ADMIN role; join-by-code flow for TEACHER and PARENT; pending approval for non-admin registrations.
- **Audit log**: all permission changes, access denials, AI interactions, and owner-override events are persisted to AuditLog.
- **Notification service**: in-app and email notifications with per-school and per-user channel preferences.
- **School subscription / trial management**: 30-day trial on new tenant creation; payment reminder banners and suspended account modal.
- **Emergency alerts**: school-wide urgent notice creation (ADMIN only).
- **Absence management**: absence requests by parents and admins, managed by ADMIN and TEACHER.
- **Attendance tracking**: daily attendance records per classroom; summary view for ADMIN and TEACHER.
- **Homework**: homework assignments created by TEACHER and ADMIN; visible to PARENT via their students' classrooms.
- **Daily diary (bitácora)**: diary entries per student created by TEACHER; visible to linked PARENT.
- **Notices / circulars**: scoped to SCHOOL, CLASSROOM, or STUDENT level.
- **Uniform orders**: parents can place uniform orders; ADMIN manages and fulfills orders.
- **Discounts**: ADMIN manages discount records per student.
- **School calendar**: shared calendar for school events (ADMIN, TEACHER, PARENT).
- **Events for parents**: event listings visible to PARENT.
- **Documents**: ADMIN-managed school document repository.
- **Payments**: per-student charge items with payment records; parent payment view.
- **Reports**: ADMIN-only consolidated reporting.
- **Tenant theme**: per-school color theme with contrast auto-correction.
- **Mobile layout**: viewport-safe layout with mobile touch-target optimizations.
- **Lazy-loaded pages**: all page components are lazy-loaded with Suspense fallback to reduce initial bundle size.

---

## [0.x] — Pre-release development

Internal development iterations prior to the 1.0.0 production launch milestone. Not publicly versioned.
