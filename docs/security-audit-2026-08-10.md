# LIUMA Security, Privacy, Tenant-Isolation & Release-Readiness Audit — 2026-08-10

## 1. Summary

Weekly automated audit. Two things landed on `main` since the v1.7.1 audit
(`3333f85`, 2026-07-27): a routine `@base44/sdk` bump and an **unaudited
direct commit** (`a5a663d`, `base44-builder[bot]`, no PR, no version bump)
that partially fixed an HTML-injection gap in one parent-facing email. This
audit completed that fix, found the same gap unaddressed in a second email
and in the shared notification-template library used by seven more email
types, closed all of them, and closed five new dependency advisories.

**Findings by severity:** Critical 0 · High 1 fixed (systemic HTML/script
injection into parent- and staff-facing transactional emails, CWE-79 — see
§3) · Moderate 0 new (react-router/react-router-dom carries forward as
accepted risk, unchanged from 2026-07-27 — see §3) · Low 0. Five dependency
advisories (`nanoid`, `js-yaml`, `dompurify`, `socket.io-parser`,
`brace-expansion`) closed via non-breaking patch bumps.

No Critical or unresolved High finding remains. No entity schema, RLS rule,
role, or permission changed. Safe to merge.

## 2. What changed since the last audit (3333f85..HEAD, before this pass)

- `8ecf321` (merged via PR #152, already accounted for in the 2026-07-27
  audit) — doc-only correction to that audit's severity tally.
- `2c5acf4` — routine bump, `@base44/sdk` 0.8.40→0.8.41. SDK client library
  only.
- `a5a663d` (**"File changes"**, `base44-builder[bot]`, pushed directly to
  `main`, no PR, no version/changelog update) —
  - `src/lib/support/diagnostics.js`: added an `eslint-disable-next-line
    no-undef` comment around a Vite build-time global. Cosmetic, reviewed,
    no behavior change.
  - `src/pages/CrearBitacora.jsx`: added a local `escapeHtml()` helper and
    used it to escape `notes_text`, `teacher_message`, and `teacher_name`
    before interpolating them into the HTML body of the daily-diary email
    sent to parents. **This was a real, correctly-targeted security fix**
    for CWE-79 (HTML/script injection via unescaped user input in an HTML
    email) — but it was incomplete: the same pattern existed, unfixed, in
    `src/pages/Asistencia.jsx`'s absence-notification email and in all
    seven templates in `src/lib/notifications/templates.js` (used for
    signup approval, payment reminders, event confirmations, emergency
    alerts, and support-ticket emails). Per this routine's rules for a
    pre-existing draft/incomplete change: **completed it** rather than
    leaving it half-applied (§3).

No entity, RLS, authorization, or AI-related file changed in either commit.

## 3. Security audit

- **HTML/script injection in transactional emails (CWE-79) — High, fixed.**
  `base44.integrations.Core.SendEmail` bodies are HTML, rendered by the
  recipient's mail client. Several templates interpolated user- or
  entity-controlled strings directly into that HTML with no escaping:
  - `src/pages/Asistencia.jsx` — `student.first_name`, `student.last_name`,
    and the free-text `reason` field (teacher-entered) in the
    absence-notification email sent to parents.
  - `src/lib/notifications/templates.js` — all seven templates
    (`new_user_pending`, `payment_due`, `event_confirmation_reminder`,
    `emergency_alert`, `support_ticket_escalated`, `support_ticket_reply`,
    `support_ticket_resolved`). The highest-severity path here is
    `new_user_pending`: `userName` and `userEmail` are supplied by an
    **unauthenticated self-registering user** at signup time and land,
    unescaped, in an HTML email sent to the school admin who approves the
    request — the one template field in this whole audit that a genuinely
    untrusted actor controls end-to-end.
  - **Fix:** extracted the escaping helper `a5a663d` had inlined into
    `CrearBitacora.jsx` into a shared, import-free utility
    (`src/lib/htmlEscape.js`, safe to unit-test directly under
    `node --test`), and routed every interpolated value in both files above
    — plus `CrearBitacora.jsx` itself, now importing the shared helper
    instead of duplicating it — through `escapeHtml()`. In-app notification
    text (`inAppTitle`/`inAppContent` in the same templates file) was left
    unescaped on purpose: it's rendered as plain React text (verified no
    `dangerouslySetInnerHTML` consumes it — the only such call site in
    `src/` is unrelated chart-styling code in `src/components/ui/chart.jsx`),
    so React's own JSX escaping already covers it; double-escaping there
    would corrupt the display text (e.g. `&amp;` shown literally).
  - **Regression coverage added:** `tests/unit/email-html-escaping.test.js`
    — direct unit tests of `escapeHtml()` (metacharacter neutralization,
    null/undefined handling) plus source-level checks that every known
    interpolation site in `templates.js`, `Asistencia.jsx`, and
    `CrearBitacora.jsx` routes through it, and that `CrearBitacora.jsx` no
    longer carries its own duplicate definition.
  - Not exploitable as script execution in most modern mail clients (they
    strip `<script>`), but HTML injection still enables phishing-style
    markup (fake links/buttons, spoofed content) inside a message the
    recipient trusts as coming from LIUMA — worth closing regardless of
    mail-client hardening, and cheap to close correctly everywhere at once.
- **Secret sweep:** grepped `src/`, `base44/`, `deno/`, `*.json` for
  hardcoded API keys/tokens/passwords/secrets (`git grep` for
  `key|secret|password|token` literals ≥16 chars) and confirmed `.env` is
  git-ignored with only `.env.example` tracked. **0 matches.**
- **`npm ci` / `npm audit`:** clean install surfaced 6 advisories (3
  moderate, 3 high on the production-relevant view; 4 high / 3 moderate
  including dev-only transitive duplicates) not present at the 2026-07-27
  audit — all from upstream package releases, none introduced by a Liuma
  code change.
  - **Fixed (non-breaking, `npm audit fix`, no `--force`):**
    - `nanoid` 3.3.16→3.3.18 — closes `GHSA-2v37-7h3g-55p8` (indefinite
      loop when a custom generator's size is 0). Transitive via `postcss`
      (dev/build-only).
    - `js-yaml` 4.3.0→4.3.1 — closes `GHSA-5p4m-2wfm-xmqj` (quadratic-CPU
      `!!omap` resolution; the 2026-07-27 fix for the merge-key variant of
      this advisory didn't cover the omap variant). Transitive via `eslint`
      (dev-only).
    - `dompurify` 3.4.12→3.4.13 — closes `GHSA-55q2-fjhq-7xh7` (`IN_PLACE`
      hook removal leaves a detached subtree executable). Transitive via
      `jspdf` (PDF export). Liuma doesn't call DOMPurify's `IN_PLACE`
      hook-removal API directly; patched anyway since the fix is free.
    - `socket.io-parser` 4.2.6→4.2.7 — closes `GHSA-2m8v-j782-fhvr`
      (zero-attachment memory exhaustion). Transitive via
      `@base44/sdk`'s `socket.io-client` (production dependency, used for
      realtime updates).
    - `brace-expansion` (both the direct `1.1.16` and transitive `2.1.2`
      copies) → `1.1.18` / `2.1.4` — closes `GHSA-mh99-v99m-4gvg` and
      `GHSA-rgw5-rvv9-x895` (unbounded-expansion DoS, including a bypass of
      the first advisory's own mitigation). **This closes the High-severity
      accepted-risk item carried forward from the 2026-07-27 audit** — a
      newer `npm audit fix` (no `--force`, no `eslint-plugin-react`
      downgrade) now resolves it cleanly; the previous round's
      accepted-risk rationale (force-fix would have required downgrading
      `eslint-plugin-react`) no longer applies to the current dependency
      graph.
  - **Accepted risk (carried forward unchanged):**
    - **`react-router` / `react-router-dom` (moderate)** —
      `GHSA-wrjc-x8rr-h8h6` (open redirect) and `GHSA-337j-9hxr-rhxg`
      (SSR-hydration constructor injection). Still requires a v6→v7 major
      upgrade; still not reachable in this codebase (client-only SPA, no
      SSR entry point; every navigation target is built by
      `createPageUrl()` from a fixed page-name string, never an
      externally-controlled value — re-confirmed this round, no new
      `navigate(`/`to=` call sites were added). Deferred to a dedicated
      migration, same as 2026-07-13 and 2026-07-27.
  - Post-fix state re-verified: `npm ci` clean install + full quality-gate
    suite (§7) green against the patched lockfile, both before and after
    the HTML-escaping code fix.
- No unsafe admin/invite/approval flow, missing role check, or
  over-permissive access introduced. No RLS or entity file touched.

## 4. Privacy & child/student data audit

No entity, RLS, or authorization code changed this round. The HTML-escaping
fix in §3 is itself a privacy-adjacent hardening: it prevents a
parent-facing email (student's daily attendance/diary record) from being
usable as an injection vector, without changing *what* data is included —
recipient resolution is unchanged (still read from `ParentStudent` links
filtered to `status: 'ACTIVE'` for the specific `student_id`, never from
client input). `docs/security-audit-2026-07-13.md` §5's findings (PII gated
by Base44 RLS keyed off server-verified session fields) stand unchanged.
`npm run validate:rls` re-ran clean (32/32 entities).

Noted, not acted on (pre-existing, unrelated to this cycle's fix, present
identically in both `Asistencia.jsx` and `CrearBitacora.jsx` before and
after this change): both diary and attendance parent-notification flows
call `base44.entities.User.list()` (all users) client-side to resolve a
parent's email from a `ParentStudent.parent_id`, rather than a
tenant-scoped lookup. The email is only ever sent to a parent already
verified as actively linked to the specific student via `ParentStudent`
(itself school-scoped), so no message is misdirected — but the client
receives the full `User.list()` payload to do that lookup. This is
pre-existing, unrelated to CWE-79, and out of scope for a targeted security
patch per this routine's "no unrelated refactors" rule; flagged here for a
future dedicated pass rather than silently ignored.

## 5. School/tenant isolation audit

No entity, RLS, or authorization code changed this round.
`src/lib/authorization/policy.js`'s `school_id` resolution is unchanged.
`validate:rls` (32/32) and the full permission/policy test suite
(`tests/unit/policy.test.js`, `tests/integration/key-pages.test.js` — part
of `npm run release:gate`, 23/23 green) re-ran clean. The two files touched
by this round's fix (`Asistencia.jsx`, `templates.js`) do not read or
resolve `school_id`, `classroom_id`, or any tenant-scoping value — the
change is confined to how a string is rendered into HTML, not which data is
selected or to whom it is sent.

## 6. AI / RAG safety audit (Lumi + soporte AI questionnaire)

No code changed in `src/lib/lumi*`, `src/lib/support/*`, or any AI-related
path this round. The two pre-existing Medium-severity accepted-risk items
from `docs/security-audit-2026-07-13.md` §7 carry forward unchanged
(non-blocking, pending a product decision, re-verified not to allow
cross-school/cross-classroom/cross-family exposure via §4/§5).

## 7. Code quality & CI/CD

- `npm ci` clean install.
- Lint: clean. Typecheck: clean. Build: succeeds.
- Tests: **276/276 pass** (271 pre-existing + 5 new in
  `tests/unit/email-html-escaping.test.js`).
- Release gate: 23/23 pass. `validate:rls`: 32/32 entities OK.
- No dead code, broken imports, or unrelated refactors. Files touched:
  `src/lib/htmlEscape.js` (new), `src/pages/Asistencia.jsx`,
  `src/pages/CrearBitacora.jsx` (de-duplicated its local copy of the same
  helper `a5a663d` had inlined), `src/lib/notifications/templates.js`,
  `tests/unit/email-html-escaping.test.js` (new), plus
  `package.json`/`package-lock.json` (dependency patch bumps + version) and
  release metadata (this doc, `CHANGELOG.md`, `VERSION_CONTROL.json`).

## 8. Permissions matrix

Reviewed against `docs/authorization-matrix.md` (last updated 2026-07-13,
v1.7.0) — no route, entity, role, or capability changed this round (the fix
is confined to HTML-escaping inside two already-reviewed email-send code
paths; it does not change who can trigger them or what they are sent). 4
roles reviewed (ADMIN, TEACHER, PARENT, PLATFORM_OWNER), matrix confirmed
still current. No update needed, no new permissions, no unsafe defaults, no
gaps found.

## 9. User manual & changelog

- `USER_MANUAL.md`: no user-facing behavior changed — emails render
  identically to a legitimate sender; only maliciously-crafted input is now
  neutralized. No update needed.
- `CHANGELOG.md` / `VERSION_CONTROL.json` / `package.json`: version bumped
  1.7.1 → 1.7.2 (patch — security fix + dependency patches, no behavior
  change for legitimate use).

## 10. Rollback

- Branch: `claude/admiring-maxwell-llqeyg`
- Commit before this change: `a5a663d` (tip of `main` at audit start)
- This change touches `src/lib/htmlEscape.js` (new),
  `src/pages/Asistencia.jsx`, `src/pages/CrearBitacora.jsx`,
  `src/lib/notifications/templates.js`, `tests/unit/email-html-escaping.test.js`
  (new), `package.json`, `package-lock.json`, `CHANGELOG.md`,
  `VERSION_CONTROL.json`, and this audit doc. No entity schema, RLS rule,
  permission, or AI behavior change — safe, low-blast-radius revert.
- Rollback: `git revert <merge-commit-sha>` once merged (or
  `git revert <this-PR's-commit-sha>` pre-squash). Reverting restores the
  pre-patch dependency versions (`nanoid@3.3.16`, `js-yaml@4.3.0`,
  `dompurify@3.4.12`, `socket.io-parser@4.2.6`, `brace-expansion@1.1.16` /
  `2.1.2`) — i.e. re-opens the five advisories closed in §3 — and restores
  the unescaped email-body interpolation in `Asistencia.jsx` and
  `templates.js` (the fix already live in `CrearBitacora.jsx` via `a5a663d`
  is unaffected unless that commit is separately reverted). Re-apply
  `npm audit fix` after any revert if the dependency rollback is not
  desired.
- No manual owner action required after merge. No data migration, session,
  or live-schema implications.
