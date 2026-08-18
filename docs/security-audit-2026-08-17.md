# LIUMA Security, Privacy, Tenant-Isolation & Release-Readiness Audit — 2026-08-17

## 1. Summary

Weekly automated audit. **`main` has not moved since the last audit** —
current tip is still `6d3a354` (the v1.7.2 merge, 2026-08-10). No commit,
bot-driven or otherwise, landed on `main` in the interim.

Re-ran the full audit surface anyway (dependencies can gain new advisories
without a code change) rather than assuming last week's clean bill still
holds by default.

**Findings by severity:** Critical 0 · High 0 · Moderate 0 new (the
`react-router` / `react-router-dom` open-redirect / SSR-hydration advisory
carries forward as accepted risk, unchanged since 2026-07-27 — see §3) ·
Low 0. **No code, entity schema, RLS rule, role, or permission changed this
round — no PR needed.** One informational housekeeping note (§11).

## 2. What changed since the last audit (6d3a354..HEAD)

Nothing. `git log origin/main` shows no commits after `6d3a354`. This audit
doc is the only artifact this round produces.

## 3. Security audit

- **`npm ci` clean install** (633 packages) — reproducible, no install-time
  warnings beyond the pre-existing `glob@10.5.0` deprecation notice (dev
  transitive dependency, not a vulnerability advisory).
- **`npm audit`:** 1 advisory, unchanged from the 2026-08-10 audit:
  - **`react-router` / `react-router-dom` (moderate, accepted risk,
    unchanged)** — `GHSA-wrjc-x8rr-h8h6` (open redirect via backslash in
    `<Link>`/`useNavigate`) and `GHSA-337j-9hxr-rhxg` (SSR-hydration
    constructor injection via `deserializeErrors()`). Re-confirmed not
    reachable: Liuma is a client-only SPA with no SSR entry point, and
    every navigation target is still built by `createPageUrl()` from a
    fixed page-name string — `git grep` for `navigate(` and `to=` call
    sites shows no new externally-controlled navigation target since last
    round. Fix requires a v6→v7 major upgrade; deferred to a dedicated
    migration, same as the last three audits.
  - All five advisories closed 2026-08-10 (`nanoid`, `js-yaml`, `dompurify`,
    `socket.io-parser`, `brace-expansion`) remain closed — no regression,
    no new upstream re-break.
- **Secret sweep:** `git grep` across `src/`, `base44/`, `deno/`, `*.json`
  for inline `key|secret|password|token` literals ≥16 chars. **0 matches.**
  `.env` confirmed git-ignored (`git ls-files` shows no tracked `.env`,
  only `.env.example`).
- **HTML-escaping fix from 2026-08-10 re-verified intact:** `escapeHtml()`
  (`src/lib/htmlEscape.js`) is still imported and used in
  `src/lib/notifications/templates.js`, `src/pages/Asistencia.jsx`, and
  `src/pages/CrearBitacora.jsx` — no regression, no reintroduced duplicate
  inline copy. The only `dangerouslySetInnerHTML` call site in `src/` is
  still the unrelated chart-styling code in `src/components/ui/chart.jsx`.
- No unsafe admin/invite/approval flow, missing role check, or
  over-permissive access introduced (nothing changed to introduce one). No
  RLS or entity file touched.

## 4. Privacy & child/student data audit

No entity, RLS, or authorization code changed. `docs/security-audit-2026-08-10.md`
§4's findings stand unchanged, including the noted-not-acted-on observation
about `Asistencia.jsx`/`CrearBitacora.jsx` resolving parent email via a
client-side `User.list()` call (recipient is still gated by an
already-verified `ParentStudent` link before use — no misdirection risk,
still flagged for a future dedicated pass rather than silently dropped).

## 5. School/tenant isolation audit

`npm run validate:rls` → **32/32 entities OK.** `src/lib/authorization/policy.js`
unchanged. Full permission/policy suite (`tests/unit/policy.test.js`,
`tests/integration/key-pages.test.js`, part of `npm run release:gate`) →
**23/23 pass.**

## 6. AI / RAG safety audit (Lumi + soporte AI questionnaire)

No code changed in `src/lib/lumi*`, `src/lib/support/*`, or any AI-related
path. The two pre-existing Medium-severity accepted-risk items from
`docs/security-audit-2026-07-13.md` §7 carry forward unchanged.

## 7. Code quality & CI/CD

Full quality-gate suite re-run clean against a fresh `npm ci` install:

- Lint (`eslint . --quiet`): clean.
- Typecheck (`tsc -p ./jsconfig.json`): clean.
- Tests (`node --test tests/**/*.test.js`): **276/276 pass.**
- Release gate (`npm run release:gate`): **23/23 pass.**
- `validate:rls`: **32/32 entities OK.**
- Build (`vite build`): succeeds.
- Deno CI (`deno fmt --check`, `deno lint`, `deno test`) not re-run locally
  (Deno unavailable in this environment) — no file under `deno/` changed
  since the 2026-08-10 audit, where this job was last green in CI; GitHub
  Actions re-runs it on every push regardless.

No dead code, broken imports, or unrelated refactors — no files changed
this round besides this doc.

## 8. Permissions matrix

`docs/authorization-matrix.md` (last updated 2026-07-13, v1.7.0) reviewed
against `src/lib/authorization/routeAccess.js` and
`src/lib/authorization/policy.js` — both files unchanged since that update.
4 roles confirmed still current (ADMIN, TEACHER, PARENT, PLATFORM_OWNER).
No update needed, no new permissions, no unsafe defaults, no gaps found.

## 9. User manual & changelog

No user-facing behavior changed. `USER_MANUAL.md`: no update needed.
`CHANGELOG.md` / `VERSION_CONTROL.json` / `package.json` version: **not
bumped.** Semantic Versioning ties a release to a change; there is no
change to describe this round, so no `[1.7.3]` entry was created. This
audit doc is the record of the (clean) review having happened.

## 10. UAT / UI / UX / cross-device / performance

Not re-executed this round: these surfaces (`docs/ux-certification-2026-05-18.md`,
`docs/ui-quality-baseline.md`, `docs/perf-baseline.md`,
`tests/manual/ui-qa-script.md`) depend on rendered application behavior,
and no application code changed since they were last exercised. Re-running
manual/visual passes against an unchanged build would not surface anything
new; they're due for re-certification the next time application code
actually changes, not on a fixed calendar regardless of diff size.

## 11. Housekeeping observation (informational, not a security finding)

`origin` currently carries **49 stale `claude/*` branches and 82 stale
`codex/*` branches** beyond the ones referenced by open work, most of them
already merged or abandoned (e.g. `claude/admiring-maxwell-llqeyg`,
`claude/sharp-sagan-tr5eba`, and dozens of others named in prior audits'
rollback sections, whose PRs are long since merged). None of this affects
security or correctness, but it makes `git branch -r` and the repo's branch
list noisy for anyone browsing it by hand. Left untouched this round —
bulk-deleting branches is a repo-hygiene action outside this audit's
"security/quality/release-readiness" scope and outside what an unattended
run should do without the owner's sign-off. Flagging it for a deliberate
cleanup pass (e.g. delete branches whose PR is `merged` and whose head SHA
is an ancestor of `main`) rather than acting on it here.

## 12. Rollback

No change was made this round beyond adding this document. To remove it:
`git revert <this-PR's-merge-commit-sha>` (or delete
`docs/security-audit-2026-08-17.md` directly — it carries no code
dependency). No entity schema, RLS rule, permission, dependency version, or
AI behavior touched. No manual owner action required.
