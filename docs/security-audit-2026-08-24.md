# LIUMA Security, Privacy, Tenant-Isolation & Release-Readiness Audit — 2026-08-24

## 1. Summary

Weekly automated audit. Unlike the 2026-08-17 round (`main` hadn't moved at
all since 2026-08-10), **`main` moved a lot this week**: five modules landed
between 2026-08-18 and 2026-08-23 — module 11 (deploy tooling), module 12
(three-way light/dark/system theme switcher), the `npm run test:smoke`
live-site suite, module 14 (a dedicated multi-tenant isolation audit), and
module 15 (per-app derived signing key for the Mission Control bridge). All
five are already documented in detail in `CLAUDE.md`; this audit's job was
to re-verify the app is still healthy on top of them, not to redo that work.

**Findings by severity:** Critical 0 · High 0 · Moderate 1 (process, not
code — see §9) · Low 0. The `react-router`/`react-router-dom` open-redirect
advisory that carried forward as accepted risk in every prior round got a
partial fix this time (see §3) — a point release closing one of its three
CVEs became available since 2026-08-17; the other two still need a v7
major upgrade and remain accepted risk, unchanged.

**One PR this round**, all metadata/docs plus the one dependency patch —
see §12.

## 2. What changed since the last audit (f6ca4e3..HEAD before this PR)

- Módulo 11 — deploy tooling: `scripts/base44-deploy.mjs` now rejects a
  `--app-id` passed by argument (binds the app id to the repo instead,
  closing the cross-app-deploy incident class described in
  `jospabloh/acacia-app-standard`'s `docs/incidents.md`); `npm run
  deploy:site` added.
- Módulo 12 — `ThemeContext.jsx` went from two modes to three
  (`light`/`dark`/`system`) with a live `matchMedia` listener; the
  portfolio-shared `ThemeSwitcher.jsx` replaced the old `ThemeToggle`
  footer buttons in `SideNav` and `CommandPalette`.
- `tests/smoke/` — new Playwright suite, shared byte-for-byte across the
  portfolio, that checks the **deployed** site rather than the local
  build. Runs via `.github/workflows/smoke.yml`, not in this sandbox
  (outbound HTTPS here doesn't reach the deployed domain).
- Módulo 14 — first pass of the multi-tenant isolation audit. Found no
  live cross-tenant leak. One latent (not currently exploitable, one
  `UserProfile` per user in production today) correctness finding: three
  different, non-deterministic rules for "which school is current" across
  `tenantSelection.js`, `exportSchoolData`/`governRoleChange`, and
  `NavContext.jsx`. Not re-litigated here — see `CLAUDE.md`'s module 14
  section for the full writeup and the open fix (`selectCurrentUserProfile`
  everywhere).
- Módulo 15 — `acaciaControl`/`notifyTicketCreated` now verify/sign with a
  key derived per-app (`HMAC(master, "acacia.app.v1." + slug)`) instead of
  the portfolio-wide shared secret directly, closing the cross-app ticket
  attribution gap Mission Control's own module 14 found. `ACCEPT_LEGACY_MASTER`
  is still `true` here (confirmed: `base44/functions/acaciaControl/entry.ts:32-35`)
  — by design, until all nine apps in the portfolio accept the derived key;
  not this app's action item to close alone.
- None of the above bumped `package.json`, added a `CHANGELOG.md` entry, or
  updated `VERSION_CONTROL.json`/`appConfig.js`'s `APP_VERSION` — see §9.

## 3. Security audit

- **Fresh `npm install`** (634 packages, one new dev-dependency count vs.
  last round from lockfile churn) — reproducible, no install-time warnings
  beyond the pre-existing `glob@10.5.0` deprecation notice.
- **`npm audit`:** 2 moderate advisories found, both on
  `react-router`/`react-router-dom`. **Fixed one of the three CVEs this
  round**: `npm audit fix` (non-force) bumped `react-router`/`react-router-dom`
  6.30.4 → 6.30.6 (lockfile-only, `package.json`'s `^6.26.0` range
  unchanged) — this closes `GHSA-jjmj-jmhj-qwj2` (open redirect leading to
  XSS in `<Link>`/`useNavigate`), which wasn't fixable at the 2026-08-17
  audit because the patched point release didn't exist yet. The remaining
  two — `GHSA-wrjc-x8rr-h8h6` (open redirect via backslash,
  CVE-2025-68470 bypass) and `GHSA-337j-9hxr-rhxg` (SSR-hydration
  constructor injection via `deserializeErrors()`) — require a v6→v7 major
  upgrade (`npm audit fix --force` confirmed this: it offers
  `react-router-dom@7.18.2`). **Re-confirmed not reachable, same as every
  prior audit:** LIUMA is a client-only SPA with no SSR entry point (the
  hydration-injection CVE doesn't apply), and every navigation target is
  still built by `createPageUrl()` from a fixed page-name string — `git
  grep` for `navigate(` and `to=` call sites shows no externally-controlled
  navigation target. Deferred to a dedicated v7 migration, same as the
  last four audits. Full suite re-verified green after the bump: lint,
  typecheck, build, `npm test` (276/276) all pass with the new lockfile.
- **Secret sweep:** `git grep` across `src/`, `base44/`, `deno/`, `*.json`
  for inline `key|secret|password|token` literals ≥16 chars, plus a
  pattern sweep for AWS-style keys and PEM private-key headers. **0
  matches.** `.env` confirmed git-ignored.
- **HTML-escaping fix from 2026-08-10 re-verified intact:** `escapeHtml()`
  (`src/lib/htmlEscape.js`) still the only path used in
  `src/lib/notifications/templates.js`, `src/pages/Asistencia.jsx`, and
  `src/pages/CrearBitacora.jsx`; `src/components/ui/chart.jsx` remains the
  only `dangerouslySetInnerHTML` call site in `src/`, unrelated to
  user-controlled input.
- No unsafe admin/invite/approval flow, missing role check, or
  over-permissive access introduced this round — `src/lib/authorization/`
  is unchanged since 2026-07-13 (confirmed via `git log`).

## 4. Privacy & child/student data audit

No entity, RLS, or authorization code changed this round.
`docs/security-audit-2026-08-10.md` §4's findings stand unchanged, same
noted-not-acted-on observation about `Asistencia.jsx`/`CrearBitacora.jsx`
resolving parent email via a client-side `User.list()` call (still gated by
an already-verified `ParentStudent` link before use).

## 5. School/tenant isolation audit

`npm run validate:rls` → **32/32 entities OK.** `npm run test:permissions`
(`tests/unit/policy.test.js` + `tests/integration/key-pages.test.js`) →
**23/23 pass.** Beyond the standard re-run, this week already had a
dedicated, deeper pass: module 14's isolation audit (§2) read the **live**
schema and all six backend functions, not just the repo files, and is the
authoritative isolation finding for this period — not re-run from scratch
here. Its one open item (the three-way "which school is current" split)
remains latent, unaffected by anything in this PR.

## 6. AI / RAG safety audit (Lumi + soporte AI questionnaire)

No code changed in `src/lib/lumi*`, `src/lib/support/*`, or any AI-related
path this round. The pre-existing accepted-risk items from
`docs/security-audit-2026-07-13.md` §7 carry forward unchanged.

## 7. Code quality & CI/CD

Full quality-gate suite re-run clean against the post-fix install:

- Lint (`eslint . --quiet` + `validate:functions`): clean — 6 endpoints,
  headroom 34 under the 40 soft cap.
- Typecheck (`tsc -p ./jsconfig.json`): clean.
- Tests (`node --test tests/**/*.test.js`): **276/276 pass.**
- Release gate (`npm run release:gate`): **23/23 pass.**
- `validate:rls`: **32/32 entities OK.**
- Build (`vite build`): succeeds.
- Deno CI (`deno fmt --check`, `deno lint`, `deno test`) not re-run locally
  — `deno` unavailable in this sandbox, same limitation noted in every
  prior audit and in `CLAUDE.md`'s module 15 section. No file under
  `deno/` changed this round; GitHub Actions runs `ci-deno.yml` on push
  regardless. Note carried from module 15: `ci-deno.yml` lints `deno/`
  only, not `base44/functions/` — the six backend functions (including the
  new `_acaciaSign.ts` copies) are not gated by that workflow.

No dead code or broken imports found. No unrelated refactors made — every
file this PR touches is metadata/docs plus the two dependency-lockfile
lines.

## 8. Permissions matrix

`docs/authorization-matrix.md` (last updated 2026-07-13, v1.7.0) reviewed
against `src/lib/authorization/routeAccess.js` and
`src/lib/authorization/policy.js` — both files unchanged since that update
(`git log --since=2026-07-13` on both paths shows no commits). 4 roles
confirmed still current (ADMIN, TEACHER, PARENT, PLATFORM_OWNER). No
update needed.

## 9. User manual & changelog — the actual finding this round

`package.json` was still at `1.7.8`, and `src/lib/appConfig.js`'s
`APP_VERSION` — the value the in-app `HistorialCambios` page shows users —
was still `1.7.5`, **three releases behind**. Modules 11, 12, the smoke
suite, 14, and 15 all shipped real, user-facing or security-relevant
changes without a version bump, a `CHANGELOG.md` entry, or a
`VERSION_CONTROL.json` update. This is a process gap, not a code defect —
same shape as the `v1.7.0` "release-metadata catch-up" precedent from
2026-07.

Separately, `USER_MANUAL.md` had **zero** mentions of the theme switcher
(modules 10 and 12), the `HistorialCambios` page (module 6, shipped
2026-08-18), or the "Descargar mis datos" / "Solicitar eliminación de la
escuela" danger-zone actions (module 7, same day) — three live,
user-reachable features that predate this audit by up to six days with no
manual coverage.

**Fixed this round:**
- `package.json` → `1.7.9`; `VERSION_CONTROL.json` → `1.7.9`, with a
  `bumpRationale` documenting the catch-up and the prior rationale shifted
  to `previousBumpRationale_1_7_8`; `src/lib/appConfig.js`'s `APP_VERSION`/
  `RELEASE_DATE` synced.
- `CHANGELOG.md` — new `[1.7.9]` entry.
- `USER_MANUAL.md` — added the theme switcher to §2 ("Cómo navegar"), a
  "Historial de Cambios" row to the shared-pages table (§3), and the two
  danger-zone actions to the existing "Permisos y Roles" row.

## 10. UAT / UI / UX / cross-device / performance

Not re-executed this round. This PR touches no rendered application code —
`package.json`, `VERSION_CONTROL.json`, `src/lib/appConfig.js` (two string
constants), `CHANGELOG.md`, `USER_MANUAL.md`, this doc, and the dependency
lockfile. The theme switcher (module 12) and its own cross-device
overlap checks already have their verification recorded under `CLAUDE.md`'s
module 12 entry and in `tests/smoke/smoke.spec.js`'s fifth assertion
(§ live-site suite, module 12) — re-running a manual/visual pass against
unchanged rendered output would not surface anything new. Due for
re-certification the next time application/rendering code actually
changes, same standing policy as every prior round
(`docs/ux-certification-2026-05-18.md`, `docs/ui-quality-baseline.md`,
`docs/perf-baseline.md`, `tests/manual/ui-qa-script.md`).

**Not verified, and flagged rather than assumed:** any authenticated page
in dark mode, and the theme switcher against a live authenticated session —
this sandbox has no live Base44 auth, same limitation `CLAUDE.md`'s module
10 and module 12 entries already record. `npm run test:smoke` is the
mechanism that closes this gap against the deployed site, but it only runs
in GitHub Actions (this sandbox's outbound HTTPS doesn't reach the
deployed domain) — it should be triggered (`workflow_dispatch`) once this
PR is deployed with `npm run deploy:site`, per `CLAUDE.md`'s module 11
note that merging alone never deploys the frontend.

## 11. Housekeeping observation (informational, not a security finding)

Same stale-branch observation as 2026-08-17, still not acted on this round
for the same reason — bulk branch deletion is outside an unattended audit
run's scope without explicit owner sign-off. Separately: five open
`claude/*-audit-*`/`codex/*-audit*` branches from prior sessions
(`claude/apps-rls-security-audit-xhfvtr`, `claude/liuma-audit-report-8s0qbr`,
`claude/liuma-audit-v1-6-1-msv6mx`, `codex/define-audit-event-schema`,
`codex/implement-audit-logging-for-permission-changes`) exist on `origin`
with no open PR against any of them — worth a look to confirm they're
superseded before deleting, not done here for the same reason.

## 12. Rollback

This round's PR touches: `package.json`, `package-lock.json` (the
`react-router`/`react-router-dom` bump), `VERSION_CONTROL.json`,
`src/lib/appConfig.js`, `CHANGELOG.md`, `USER_MANUAL.md`, and this new doc.
No entity schema, RLS rule, permission, route-access code, or AI behavior
touched.

**To roll back:** `git revert <this PR's merge commit SHA>` restores
`package.json`/`appConfig.js` to `1.7.8`, drops the `react-router` bump
back to `6.30.4` (reopening `GHSA-jjmj-jmhj-qwj2` — low urgency to re-open
deliberately, but noted), and removes the `CHANGELOG.md`/`USER_MANUAL.md`/
this-doc additions. No deploy action is required to "undo" anything live —
this round changed no entity schema and no backend function; frontend
still needs `npm run deploy:site` to actually go live either way, per
module 11's standing rule that merging to `main` alone deploys nothing.
No manual owner action required beyond the revert itself.
