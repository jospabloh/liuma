# Security audit — 2026-10-05

Scheduled full-review audit pass (owner: h.josepablo@gmail.com), automated
firing. Scope: the LIUMA app-standard checklist — pre-flight inventory,
RLS/isolation gate, dependency audit, Base44's own `security/scan`, code
quality, UI/dark-mode spot check on reachable public pages, automated-test
run, changelog/version catch-up, PR + rollback plan.

Repo state at start: `main` / this session's branch
(`claude/awesome-mccarthy-n7aoj7`) both at `236d087` (`HEAD == origin/main`),
zero open PRs, no stray audit branches, no secrets in tree (`.env.example`
the only versioned `.env*`).

## Pre-flight

- `git status` clean, no open/draft/stale PRs (`list_pull_requests` → `[]`).
- No leftover audit branches from a previous run of this scheduled task.
- `CHANGELOG.md` top entry (`1.9.0`) and `VERSION_CONTROL.json` both match
  `package.json`'s `1.9.0` / `src/lib/appConfig.js`'s `APP_VERSION` — no
  version drift to catch up on.

## Deploy state — in sync, no drift this time

`GET /api/apps/{app_id}/app-checkpoints` (appId `696e967c430ceb6a2232ffd8`):
latest checkpoint `git_commit_hash: 236d087…`, `last_deployed_at:
2026-10-02T19:53:14Z`, `is_github_sync: true` — matches `main`'s HEAD
exactly. Unlike the 2026-09-21 and 2026-09-28 passes, there is **no deploy
drift to fix** this time: production is already running what the repo says
it's running.

## Finding — `npm audit`: 8 high + 1 low, fixed via lockfile only

`npm audit` reported 9 vulnerabilities (1 low, 8 high) not present at the
2026-09-28 pass:

- **`axios` 1.18.1** (transitive via `@base44/sdk`, a **production**
  dependency used for every Base44 API call) — 12 advisories rolled into one
  severity-`high` entry: prototype pollution in the fetch adapter and
  `toFormData`, several ReDoS paths, an HTTP/2 DNS/proxy bypass, header
  injection via inherited headers, a redirect-based SSRF
  (`maxRedirects: 0` not enforced by the fetch adapter), and a NO_PROXY
  CIDR-bypass. Real production surface, not a dev-tool chain.
- **`dompurify` 3.4.13** (transitive via `jspdf`, used for the app's PDF
  generation) — low severity, `IN_PLACE` DOM-XSS via a node-removing
  `afterSanitize` hook.
- **`brace-expansion`** (transitive via `glob`) — quadratic-time / recursion
  DoS, high severity.
- **`braces`/`chokidar`/`micromatch`/`fast-glob`/`tailwindcss`/
  `tailwindcss-animate`** — one chain, all pulled in by `tailwindcss`
  (devDependency, the build's CSS tooling). `braces` has **no fixed release
  at any version** per its advisory (`GHSA-vfj7-8cjw-p6xm`); `tailwindcss`
  was already at the newest `3.x` (`3.4.17` → `3.4.19` after the fix below).
  The only way to clear this chain is tailwindcss v4, a major rewrite of the
  config format — out of scope for an automated dependency-patch fix, and
  none of these five packages ship in the production bundle (build-time only,
  same pattern every prior pass in this repo has documented for this exact
  kind of finding).

**Fixed:** `npm audit fix` (no `--force`) — lockfile-only, no `package.json`
range changes, no major bumps. Closed `axios` (→ patched), `dompurify`, and
the `glob`-side `brace-expansion`. Verified before and after:
`npm run build` (clean), `npm test` (1037/1037, unchanged). `npm audit`:
9 → 6, with the remaining 6 all the tailwindcss-chain devDependency findings
above (no fix available, not in the production bundle). Diff is
`package-lock.json` only, 18 insertions / 18 deletions.

## Base44 security scan — three stale findings confirmed already fixed

The last scan on file was dated 2026-09-28 (`status: out_of_date` — code has
changed since) and listed, carried over from that pass's own "Findings not
fixed this pass" section:

- `rls_recommendations`: `UserProfile` create/update should require
  `user_condition: {role: admin}` (fingerprint `95a1dcdd…`).
- `static_code_findings` (both `verdict: plausible`): `ContactosEmergencia.jsx`
  creating `EmergencyContact` with no server-side linkage check (fingerprint
  `3e73cac8…`), and `src/lib/support/tickets.js`'s `addSupportMessage()`
  trusting a client-supplied `author_role` with no ticket-ownership check
  (fingerprint `efa41dd4…`).
- One more `static_code_findings` entry (`verdict: confirmed`, Base44's
  highest-confidence tier): `guardedEntityWrite`'s service-role update/delete
  bypassing the per-record author-only RLS on `Notice`/`Attendance`/
  `DiaryEntry`/`Homework` (fingerprint `29d6cff1…`).

All four were read against **current** code before touching anything, per
this app's own module-14 rule ("against the deployed schema, not the repo
file" — extended here to "against current code, not a five-week-old scan
snapshot"):

1. **`UserProfile` RLS** — `base44/entities/UserProfile.jsonc`'s entity-level
   `rls` block already has `create`/`update`/`delete` all gated on
   `user_condition: {role: admin}`, byte-identical to the scan's own
   recommendation. Comment on the block cites "P10 review, 2026-09-29".
2. **`ContactosEmergencia.jsx`** — no longer calls `EmergencyContact.create`
   directly. It calls `familyCreate`/`familyUpdate`/`familyDelete`, which
   route through `guardedFamilyWrite`. That function's own header comment
   cites this exact finding by fingerprint: `"WHY THIS EXISTS (P7,
   2026-09-29 — Base44 scan fingerprint 3e73cac8)"`, and re-derives the
   `ParentStudent` linkage server-side before allowing the write.
3. **`tickets.js`'s `addSupportMessage()`** — already routes through
   `postTicketMessage` (a backend function), not a direct entity write. The
   client's own code comment states `author_role` "is only the caller's
   expectation... the role actually stored is the one `postTicketMessage`
   derives."
4. **`guardedEntityWrite` authorship bypass** — `entry.ts` now calls
   `decideModifyExisting` (added in `_policy.ts`) on every update/delete of
   the record-authored entities, introduced by commit `c125635`
   ("fix(security): cerrar las rutas de escritura directa (P7)",
   2026-10-02): delete is ADMIN-only, update requires the record's own
   author, an ADMIN, or (for `Attendance` only) a teacher currently assigned
   to that classroom.

All four fixes trace to commit `c125635` and its P10b follow-up
(`3306e01`), both already on `main` before this pass started — this audit
did not need to write any of them, only verify they are real and current.

**A fresh scan was triggered** (`POST /api/apps/{app_id}/security/scan`) and
completed (`status: up_to_date`, `scanned_at: 2026-10-05T07:21:53Z`),
confirming all four findings above are gone: `rls_recommendations: []`,
`hardcoded_secrets: []`, `backend_functions: []`. The scan surfaced two
**new** findings, both low severity, not present in the 2026-09-28 scan:

### New finding A (low, confirmed) — backend functions echo raw SDK errors

15 functions' catch-all handler returned `(e as Error).message` straight to
the client in the `error` field of a 500 response (`guardedEntityWrite`,
`lumiQuery`, `lumiWrite`, `guardedFamilyWrite`, `sendBulkNotification`,
`sendNotificationEmail`, `notifyParents`, `notifyTicketCreated`, `aiAssist`,
`approveProfile`, `governRoleChange`, `exportSchoolData`,
`listSchoolMembers`, `postTicketMessage`, `recordAuditEvent`,
`acaciaControl`). Three other functions in this app
(`schoolRead`/`getMySubscription`/`markWelcomeShown`) already followed the
safe pattern — log the detail, return a generic code — and this finding is
exactly "the other 15 never got the same treatment."

**Fixed:** all 15 now follow that same pattern —
`console.error('<fn> failed', (e as Error)?.message)` then
`Response.json({ ..., error: 'INTERNAL' }, { status: 500 })`. Mechanical,
one site per file, no behavior change for any caller that was already
treating a 500 as a 500 (verified: `tests/unit/rate-limit-resilience.test.js`
already mocks this exact `{ code: 'INTERNAL', error: 'INTERNAL' }` shape, so
nothing in the test suite depended on the raw message leaking).
`acaciaControl`'s two `ok: true, note: (e as Error).message` fallbacks
(partial-failure cases inside `sessions.list`/an analytics read, not the
catch-all) were deliberately left alone — the scan didn't flag them, they're
reachable only by the HMAC-authenticated Mission Control bridge, not an
end user, and changing them risked removing debugging detail Mission
Control relies on.

### New finding B (low, plausible) — `AppSession` write access, two issues

`SessionHeartbeat.jsx` creates its own `AppSession` row directly with
`base44.entities.AppSession.create({user_email, user_name, device, ...})`.
The scan's point: any signed-in user can set `user_email`/`user_name` to
anyone else's, so a forged row shows up as someone else in Mission
Control's "sesiones activas" panel.

**Reading the entity's RLS turned up something more serious than what the
scan flagged**, from the same root cause: `AppSession.update`'s RLS is
`created_by_id == {{user.id}}` with **no field-level lock** on `revoked_at`/
`revoked_by`, so a user whose session Mission Control revoked (to force a
logout) could call `AppSession.update(ownRowId, {revoked_at: null})`
directly and **undo their own forced logout** — a control-bypass, not just
a cosmetic spoof.

**Fixed:** `revoked_at`/`revoked_by` are now locked to service-role-only
(`rls.write: {user_condition: {role: admin}}`), the same pattern
`UserProfile.jsonc` already uses for its own sensitive fields. Confirmed
safe before touching it: `grep` across `src/` and `base44/functions/` shows
these two fields are written **only** by `deleteMyAccount/_deletion.ts` and
`acaciaControl/entry.ts`, both already running as the service role — the
client only ever *reads* `revoked_at`, never writes it. Zero behavior
change for any legitimate path; `validate:rls` passes (34 entities).

**Not fixed this pass, documented in the entity file** (fingerprint
`203124ba…`): the `user_email`/`user_name` spoofing itself. Both fields are
`required`, so locking them the same way would mean the client's direct
`create()` call needs the server to supply them instead — routing session-row
creation through a new backend function (deriving identity from `auth.me()`,
mirroring `markWelcomeShown`'s shape), not a same-day schema change. This is
the same category this app's own audit history (2026-09-28, the
`EmergencyContact`/`SupportTicketMessage` findings) correctly deferred to a
dedicated follow-up pass rather than rushing a rewrite of an always-on,
every-page-load code path with no `deno check` available in this sandbox to
verify it. A comment in `base44/entities/AppSession.jsonc` records the
fingerprint and the fix shape for whoever picks it up next.

## UI / dark-mode spot check

No live Base44 auth is reachable from this sandbox (same limitation every
prior pass has recorded), so this is limited to the public, unauthenticated
pages, same as the 2026-08-31 pass's methodology. `npm run dev` + Playwright
(Chromium) at 390×844, `light` and `dark` `prefers-color-scheme`:
`/aviso-de-privacidad`, `/terminos`, and an unknown route (404 page).

- All three render with correct titles, no uncaught page errors or app-level
  console errors — the only console noise is the expected
  `ERR_CERT_AUTHORITY_INVALID` / 404 from the Base44 SDK having no backend to
  reach in this sandbox, the same noise every prior pass has documented.
- `document.body`'s computed background switches correctly between themes
  (`rgb(250, 248, 245)` light → `rgb(10, 10, 10)` dark); the corner theme
  switcher is visibly mounted in both.
- `/aviso-de-privacidad` confirms the legal text is live (not draft):
  "Vigente desde el 2 de octubre de 2026 · Versión 2026-10-02", matching
  `src/lib/legal/legalDocs.js`'s `PRIVACY_NOTICE_STATUS = 'vigente'`.

**Not verified** (same limitation as every pass since module 10): any
authenticated screen (Home, Asistencia, GestionEscuela, Pagos, etc.) — no
live Base44 session reachable from this sandbox.

## Verification run (before and after every fix in this pass)

`npm run lint` (incl. `validate:functions`, 23/40), `npm run typecheck`,
`npm run build`, `npm test` (1037/1037), `npm run test:permissions` (23/23),
`npm run validate:rls` (34 entities), `npm run validate:tenant-roles`,
`npm run release:gate` — all clean, before the dependency/error-message/
AppSession fixes and after.

## Findings — closing status

- `npm audit` (axios/dompurify/brace-expansion): **Fixed** — lockfile only.
- Base44 scan, `UserProfile` RLS recommendation: **Fixed** (already live,
  confirmed by the 2026-10-05 rescan returning `rls_recommendations: []`).
- Base44 scan, `ContactosEmergencia.jsx` linkage check: **Fixed** (already
  live, P7, commit `c125635`).
- Base44 scan, `tickets.js` ticket-ownership/author_role: **Fixed** (already
  live, P7, commit `c125635`).
- Base44 scan, `guardedEntityWrite` authorship bypass: **Fixed** (already
  live, P7/P10b, commits `c125635`/`3306e01`).
- Base44 scan, raw SDK error messages in 15 functions: **Fixed** this pass.
- Base44 scan, `AppSession` identity/revocation write access: **partially
  fixed** this pass — the more serious half (self-unrevoke via
  `revoked_at`/`revoked_by`) is closed; the identity-spoofing half
  (`user_email`/`user_name` on create) is **deferred**, documented with its
  fingerprint in `base44/entities/AppSession.jsonc`, not a same-day fix for
  the reasons given above. Not closed as Fixed, Not reproducible, or False
  positive — it is real, open, and tracked for the next pass.

## Not verified

- No live authenticated session (any role) — not reachable from this
  sandbox, same recurring limitation.
- `npm run test:smoke` — this sandbox's outbound proxy doesn't reach
  `*.base44.app`; it runs in `smoke.yml` on GitHub Actions instead.
- The 33 other entities were not individually re-read against the live
  schema this pass (only `UserProfile`, via the security scan's own
  recommendation) — `validate:rls` covers the repo file and runs in CI.
- `deno lint`/`deno check` on the 16 edited `base44/functions/*/entry.ts`
  files and the `AppSession.jsonc` RLS change — `deno` isn't available in
  this sandbox (the recurring limitation every pass in this repo has noted);
  each edit was kept mechanical and reviewed by hand, and `npm run
  validate:rls` passes, but CI's `ci-deno.yml` is this change's first real
  type/lint check.
