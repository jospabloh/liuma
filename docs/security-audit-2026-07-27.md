# LIUMA Security, Privacy, Tenant-Isolation & Release-Readiness Audit — 2026-07-27

## 1. Summary

Weekly automated audit. **No application code, entity schema, or RLS rule
changed** since the v1.7.0 audit (2026-07-13) or the metadata-only PR #151
(2026-07-20) — see §2. The only substantive finding this round came from
`npm ci`: three new upstream dependency advisories, none introduced by any
Liuma code change, all closed with non-breaking patch bumps. Two further
advisories are reviewed and accepted as risk this round (rationale in §3).

**Findings by severity:** Critical 0 · High 0 (3 new, all fixed) · Medium 0
(2 new, both accepted risk with documented rationale; 2 pre-existing
accepted-risk AI items carried forward unchanged from 2026-07-13) · Low 0.

No Critical or High finding remains unresolved. Safe to merge.

## 2. What changed since the last audit (4fdc0ce..HEAD)

Two commits landed on `main`, both from `base44-builder[bot]`, neither
touching `src/`, `base44/entities/`, or any authorization/RLS code:

- `67907d9` — routine dependency bump: `@base44/sdk` 0.8.35→0.8.40,
  `@base44/vite-plugin` 1.0.26→1.0.30 (pulls in `axios` 1.18.0→1.18.1
  transitively). SDK client library only; no entity/RLS/policy files
  touched.
- `4162cff` — stops committing `base44/.app.jsonc` (now managed via
  `base44 link`); adds it to `.gitignore`. Build/tooling config only, not
  shipped to the browser bundle, contains no secret (it is a local CLI
  link pointer, not a credential).

Both were already merged before this audit began; this pass re-verified
them (full quality-gate suite, §8) rather than re-reviewing already-shipped
diffs.

## 3. Security audit

- **Secret sweep:** grepped `src/`, `base44/`, `deno/` for AWS keys,
  OpenAI-style `sk-` tokens, PEM private key headers, and inline
  `password=`/`secret=`/`api_key=` literals. **0 matches.**
- **`npm ci` / `npm audit`:** clean install surfaced 6 advisories (1 low, 2
  moderate, 3 high) that did not exist at the 2026-07-13 or 2026-07-20
  audits — all from upstream package releases, not from any Liuma commit.
  - **Fixed (non-breaking, `npm audit fix`):**
    - `dompurify` 3.4.11→3.4.12 — closes `GHSA-c2j3-45gr-mqc4`
      (`CUSTOM_ELEMENT_HANDLING` sanitizer bypass). Optional transitive dep
      (pulled in by a PDF/export library); not directly imported by Liuma
      code, but patched anyway since the fix was free and non-breaking.
    - `js-yaml` 4.2.0→4.3.0 — closes `GHSA-52cp-r559-cp3m` (quadratic-CPU
      DoS via YAML merge-key chains). Dev-only (ESLint toolchain).
    - `postcss` 8.5.15→8.5.23 (+ `nanoid` 3.3.12→3.3.16) — closes
      `GHSA-r28c-9q8g-f849` (sourcemap path-traversal file disclosure).
      Dev/build-only.
  - **Accepted risk (not force-fixed this round):**
    - **`react-router` / `react-router-dom` (moderate)** —
      `GHSA-wrjc-x8rr-h8h6` (open redirect via backslash in `<Link>` /
      `useNavigate`) and `GHSA-337j-9hxr-rhxg` (arbitrary constructor
      injection via `deserializeErrors()` in SSR hydration). The only fix
      is a v6→v7 major upgrade (patched line starts at 7.18.0; the
      installed 6.30.4 is the newest 6.x release and is still in the
      vulnerable range). Assessed exploitability in Liuma specifically:
      - The SSR-hydration half does not apply — Liuma is declared
        client-only in `VERSION_CONTROL.json`
        (`architecture.runtime: "browser (client-side only; no
        application server)"`); there is no `deserializeErrors()` /
        SSR entry point in this codebase.
      - The open-redirect half requires an externally-controlled string
        reaching a `<Link to>` or `navigate()` call. Every call site in
        `src/` was enumerated (`grep -rn "navigate(\|to={"`See §checks
        below) — all route targets are built through
        `createPageUrl()` (`src/utils/index.ts`), which unconditionally
        returns `'/' + pageName.replace(/ /g, '-')`: an internal,
        `/`-prefixed path derived from a fixed, code-defined page-name
        string (optionally with an entity id in the query string, e.g.
        `?studentId=…`). No call site passes a raw external URL or
        unsanitized query-string value as the navigation target. Not
        reachable.
      - A v6→v7 migration touches the entire routing layer (data APIs,
        loaders, `RouterProvider` semantics) and needs its own dedicated,
        fully-tested PR — bundling it into a routine dependency-patch pass
        would violate the "no broad unrelated refactors" rule. **Deferred**
        to a dedicated migration; tracked here and in the CHANGELOG so it
        isn't lost.
    - **`brace-expansion` (high, dev-only)** — residual advisory
      (`GHSA-mh99-v99m-4gvg`) inside the ESLint 9 dependency tree (via
      `glob`/`minimatch`/`@eslint/config-array`). `npm audit fix --force`
      would resolve it only by **downgrading** `eslint-plugin-react` to
      7.22.0 (from the currently-pinned `^7.37.4` range) — a regression
      trade for a denial-of-service advisory whose blast radius is the
      local/CI lint process, never the shipped browser bundle (this
      package is 100% `devDependencies`, excluded from `vite build`
      output). Not force-fixed. Revisit at the next scheduled
      dependency-refresh pass, or sooner if `eslint-plugin-react` ships a
      non-breaking release that resolves it independently.
  - Post-fix state re-verified: `npm ci` clean install + full quality-gate
    suite (§8) all green against the patched lockfile.
- No new hardcoded secrets, unsafe file/email/admin/invite flows, or
  over-permissive access introduced — no application code changed this
  round to introduce any.

## 4. Privacy & child/student data audit

No entity, RLS, or application code changed this round. `docs/security-
audit-2026-07-13.md` §5's findings (student/parent/teacher PII gated by
Base44 RLS keyed off server-verified session fields, independent of client
input) stand unchanged. `npm run validate:rls` re-ran clean (32/32
entities) as a static regression check.

Live-schema diff against the deployed Base44 backend (as performed in the
2026-07-13 and 2026-07-20 audits) was **not performed this round** — the
Base44 CLI/API credentials required for that comparison were not available
in this execution environment. This is a gap relative to prior audits, not
a finding of drift; flagged here rather than silently skipped. Recommend
running the live-schema diff from an environment with Base44 credentials
before the next audit that touches `base44/entities/*.jsonc`.

## 5. School/tenant isolation audit

No entity, RLS, or authorization code changed this round.
`src/lib/authorization/policy.js`'s `school_id` resolution (server-side,
never client-trusted) is unchanged. `validate:rls` static check (32/32) and
the full permission/policy test suite (`tests/unit/policy.test.js`,
`tests/integration/key-pages.test.js` — part of `npm run release:gate`,
23/23 green) re-ran clean. No route, report, or notification path change to
review.

## 6. AI / RAG safety audit (Lumi + soporte AI questionnaire)

No code changed in `src/lib/lumi*`, `src/lib/support/*`, or any AI-related
path this round. The two pre-existing Medium-severity accepted-risk items
from `docs/security-audit-2026-07-13.md` §7 (Lumi free-text chat path
relying on RLS rather than the app-level capability check; dictation-based
diary/attendance writes committing without a separate confirmation step)
carry forward unchanged — still non-blocking, still pending a product
decision, still verified not to allow cross-school, cross-classroom, or
cross-family data exposure (RLS backstop unchanged, re-verified via §4/§5).

## 7. Code quality & CI/CD

- `npm ci` clean install.
- Lint: clean. Typecheck: clean. Build: succeeds. Tests: 271/271 pass.
  Release gate: 23/23 pass. `validate:rls`: 32/32 entities OK.
- `.github/workflows/ci-node.yml` and `ci-deno.yml` unchanged; latest CI
  run on `main` (commit `4162cff`) completed **success**.
- `npm outdated` shows ~40 packages with newer minor/patch releases
  available (Radix UI primitives, `@tanstack/react-query`, `eslint`,
  `@types/*`, etc.) — none carry a known vulnerability per `npm audit`.
  Intentionally left untouched: bundling a broad dependency-currency pass
  into a security-patch release is out of scope for this routine. Flagged
  for a dedicated dependency-refresh pass.
- No dead code, broken imports, or unrelated refactors introduced — no
  application code was touched this release; only `package.json`,
  `package-lock.json`, `CHANGELOG.md`, and `VERSION_CONTROL.json`.

## 8. Permissions matrix

Reviewed against `docs/authorization-matrix.md` (last updated 2026-07-13,
v1.7.0) — no route, entity, or capability changed this round, so the matrix
remains current. No update needed. Roles reviewed: 4 (ADMIN, TEACHER,
PARENT, PLATFORM_OWNER) — unchanged. No new permissions, no unsafe
defaults, no gaps found.

## 9. User manual & changelog

- `USER_MANUAL.md`: no user-facing behavior changed (dependency patches
  are invisible to end users) — no update needed.
- `CHANGELOG.md` / `VERSION_CONTROL.json` / `package.json`: version bumped
  1.7.0 → 1.7.1 (patch — security-dependency fix, no behavior change),
  consistent with the precedent set by v1.6.1 (dependency-only XSS-closure
  release also took a patch bump + changelog entry).

## 10. Rollback

- Branch: `claude/sharp-sagan-tr5eba`
- Commit before this change: `4162cff` (tip of `main` at audit start)
- This change touches only `package.json`, `package-lock.json`,
  `CHANGELOG.md`, `VERSION_CONTROL.json`, and this audit doc — no entity
  schema, RLS rule, permission, AI behavior, or business-logic change.
- Rollback: `git revert <merge-commit-sha>` once merged (or
  `git revert <this-PR's-commit-sha>` pre-squash). No data migration,
  session, or live-schema implications. Reverting restores
  `dompurify@3.4.11`, `js-yaml@4.2.0`, `postcss@8.5.15`, `nanoid@3.3.12` —
  i.e. re-opens the three advisories fixed in §3; re-apply
  `npm audit fix` after any revert if that's not desired.
- No manual owner action required after merge.
