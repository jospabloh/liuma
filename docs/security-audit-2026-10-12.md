# Security audit — 2026-10-12

Scheduled full-review audit pass (owner: h.josepablo@gmail.com), automated
firing. Scope: the LIUMA app-standard checklist — pre-flight inventory,
RLS/isolation gate, dependency audit, Base44's own `security/scan`, code
quality, automated-test run, changelog/version catch-up, PR + rollback plan.

Repo state at start: `main` at `6ef72a0` (merge of #200), this session's
branch (`claude/awesome-mccarthy-uwjyit`) created fresh from it, so
`HEAD == origin/main`. Zero open PRs against `audit/*` or this pass's own
work; one unrelated open draft PR (#201, `ci/actions-minutes`) not touched.
No stray audit branches from a previous run. No secrets in tree
(`.env.example` the only versioned `.env*`).

## Deploy state — ~6 days of drift found and closed

`GET /api/apps/{app_id}/app-checkpoints` (appId `696e967c430ceb6a2232ffd8`)
showed the latest **deployed** checkpoint at `git_commit_hash: d9fd2d0…`,
`last_deployed_at: 2026-10-06T17:08:43Z` — three commits behind `main`'s then
HEAD (`6ef72a0`). The gap was a `base44-builder[bot]` dependency bump
(`@base44/sdk` 0.8.52→0.8.53, pulling in the `axios` ^1.20.0 range the
2026-10-05 pass's `npm audit fix` already vetted) plus two docs-only commits
(CLAUDE.md, no code). `POST /github/sync` pulled the two docs commits into
the Base44 sandbox (`commits_pulled: 2`, `latest_commit_hash: 6ef72a0…`), and
`POST /deploy` published it — the new checkpoint's `git_commit_hash` and
`last_deployed_at` now match `main`'s pre-audit HEAD. No entity/RLS change
was in this gap, so no `deploy:entities` ordering concern.

## Finding — `npm audit`: 1 of 9 closed, 8 unchanged (no fix published)

`npm audit` reported 9 vulnerabilities (3 moderate, 6 high), all in the
`tailwindcss`/`braces`/`chokidar`/`micromatch`/`fast-glob`/
`postcss-selector-parser`/`postcss-nested`/`source-map-js`/`tailwindcss-animate`
dependency chain — the same chain the 2026-09-07 audit first flagged as
having no non-major fix available. Re-checked this pass (`npm view <pkg>
versions`): `braces` has published no release past `3.0.3` (the vulnerable
one), so `micromatch`/`fast-glob`/`chokidar`/`tailwindcss` 3.x all stay
exposed transitively; no newer `tailwindcss` 3.x patch exists that updates
those deps. `npm audit fix` (no `--force`) closed the one that did have a
non-breaking fix — `source-map-js` 1.2.1 → 1.2.2, lockfile-only,
`package.json` untouched — taking the count from 9 to 8. The remaining 8
stay open on the same accepted-risk basis every prior pass has documented:
`devDependency`-only build tooling (`eslint`/`vite`/`postcss`/Tailwind's own
CLI), never bundled into what a user's browser loads. A real fix needs
Tailwind v4, a major version bump out of scope for an automated patch pass.

## Finding — Base44 security scan: 4 findings, all closed

The scan was `out_of_date` (last ran 2026-10-07, before this pass's deploy).
Triggered a fresh one; the code in the 3 touched files hadn't changed since
2026-10-07, so the findings were the same, now current:

### 1. CONFIRMED (low, static analysis) — replay of HMAC-signed bridge requests

`acaciaControl/entry.ts` verified a request's signature and its 5-minute
freshness window, but had no nonce — a captured legitimate request (a proxy
log, a compromised intermediate client) stayed replayable for the rest of
that window, re-running a privileged service-role action (`license.set`,
`emails.sendFollowup`, `sessions.revoke`) each time it was replayed.

**Fixed**: an in-memory, per-isolate seen-signatures cache
(`_bridgeGuard.ts#pruneAndCheckReplay`), pruned to the signature's own
freshness window, additive to the existing HMAC check. `ping` is exempt
(Mission Control's health probe calls it back-to-back by design). This does
not stop a replay landing on a *different* warm isolate — Base44 does not
document Deno KV for functions, the same limitation `schoolRead/_userLimit.ts`
already accepted for its own per-user rate limit — but closes the common
case (a loop, or a confused client re-sending) without new infrastructure.

### 2. Suggestion (backend_functions) — `acaciaControl`'s entity parameter was unrestricted

Every action that takes `params.entity` (or `.logEntity`/`.messageEntity`/
`.log.entity`/`.recipient.related.entity`) trusted it outright: a valid
signature could make the bridge read or write **any** entity in the app, not
just the ones Mission Control's own config actually sends for LIUMA.

**Fixed**: `_bridgeGuard.ts#ENTITY_ALLOWLIST`, one allowed set per action,
built by reading Mission Control's own registry config for `liuma`
(`jospabloh/acacia-mission-control`: `supabase/migrations/0002_seed_apps.sql`,
`0004_license_field_maps.sql`/`0010_fix_liuma_field_map.sql`,
`0006_usage_entities.sql`, `0021_seed_session_entities.sql`,
`api/_lib/messaging.js`'s `liuma` entry) rather than guessed — `license_entity:
SchoolSubscription`, `ticket_entity: SupportTicket`, `ticket_message_entity:
SupportTicketMessage`, `session_entity: AppSession`, `usage_entities:
[Student, Attendance, PaymentRecord]`, contacts entity `SchoolSubscription`
with a `related` lookup on `School`. LIUMA has no `email_log` config
(`0008_email_log_config.sql`: it tracks `last_reminder_sent` on the
subscription instead), so `emails.status` and the optional `log` on
`license.set`/`emails.sendFollowup` are given an **empty** allowlist —
intentionally rejected rather than left open for a future config nobody
reviewed against this app.

### 3. Suggestion (backend_functions) — `lumiWrite` confirmation codes had no server secret

`confirmationCode` was a plain SHA-256 digest of the write's own parameters
plus its issue time — no secret. The scan's point: an authenticated caller
who already knew a write's exact parameters could compute a valid code
directly (brute-forcing ~600 `issuedAt` seconds in the 10-minute window)
without ever calling `action:'preview'`. **Not** an authorization bypass —
`guardedEntityWrite` still enforces every access rule at commit time — but it
defeated the "the caller cannot skip the preview" guarantee this scheme
exists for.

**Fixed**: the digest is now HMAC-SHA256 keyed by a new app secret,
`LUMI_CONFIRM_SECRET` (32 random bytes, set via the Base44 platform API
during this pass — not committed anywhere). `entry.ts` reads it and fails
closed (`500 CONFIG_ERROR`) if unset, never falling back to the old unkeyed
digest. Only this server, which issued the preview, can now produce a valid
code for a given set of write parameters. Updated in both byte-identical
copies (`lumiWrite/_lumiCore.ts`, `lumiQuery/_lumiCore.ts`).

### 4. Suggestion (backend_functions) — `exportSchoolData` left no governance trail

A full export of everything a school owns (23 entities, including medical
notes and payment data) wrote no `AuditLog` row and had no export-specific
rate limit, so a repeated export left no trace an owner could review later.

**Fixed**: a best-effort `AuditLog` row (`action: 'SCHOOL_DATA_EXPORTED'`,
`target_type: 'School'`, `details.entity_counts` — counts only, never the
exported data) written once the export is actually **complete** (a
resumed/partial call logs nothing; the call that finally finishes does).
`AuditLog.action`'s enum gained the new value (deployed via the Base44 MCP's
`update_entity_schema`, `properties`/`required`/`rls` otherwise byte-identical
before/after) and `recordAuditEvent/_policy.ts#ACTION_TIER` classifies it
`SERVER` — written only by the backend, never claimable from a client.
**Not added**: a dedicated export-specific rate limit (the scan's "considerar"
qualifier, not a clear ask) — exporting is already a slow, paginated,
multi-round operation (`_exportGate.ts`'s own budget/resume logic), and a
repeated full export is now at least visible in `AuditLog` for the owner to
notice, which is the gap this finding actually named.

## What this did NOT touch

- `acaciaControl/_acaciaSign.ts` and `notifyTicketCreated/_acaciaSign.ts` —
  the byte-identical, portfolio-canonical signing helper. Its own header says
  to change it in `jospabloh/acacia-app-standard` and copy it out, not edit a
  local copy; the replay fix above lives in the per-app `entry.ts` instead,
  which is already customized per app. Added a test
  (`tests/unit/acacia-bridge-guard.test.js`) asserting the two local copies
  stay byte-identical — nothing enforced that before this pass.
- The 4-operation tenant-danger-zone maker-checker system (module 7) and the
  module-14 "three rules for which school" latent finding — both unchanged,
  still correctly deferred/closed as this file's history already records.

## Verified, before and after every fix

`npm run lint` (0 errors, 23 pre-existing warnings; `validate:functions`
23/40), `npm run typecheck`, `npm run build`, `npm test` (1045/1045, +8 new),
`npm run test:permissions` (23/23), `npm run validate:rls` (34 entities),
`npm run validate:tenant-roles`, `npm run release:gate`, `npm audit` (8
vulnerabilities, all pre-existing build-tool-only, down from 9).

## Not verified

- Nothing in `base44/functions/` ran against `deno lint`/`deno check` — not
  available in this sandbox, same limitation as every prior pass. The three
  touched functions (`acaciaControl`, `lumiWrite`, `exportSchoolData`) and
  the copied `lumiQuery/_lumiCore.ts` get their first real Deno check in this
  PR's CI.
- The `LUMI_CONFIRM_SECRET` secret and the `acaciaControl` allowlist/replay
  guard are both live in the app's **secrets store** and **deployed
  checkpoint** respectively only up to the pre-fix code — the fixes
  themselves (the new `entry.ts`/`_lumiCore.ts`/`_bridgeGuard.ts` content)
  are **not yet deployed**; they ship with `npm run deploy` after this PR
  merges. Until then, `acaciaControl` and `lumiWrite` keep running the
  pre-fix logic in production (the entity whitelist / keyed confirmation code
  are inert until that deploy).
- No authenticated browser session (no live Base44 auth reachable from this
  sandbox) — UI/UX, cross-device, and live Lumi-chat verification are the
  same standing gap every prior pass has recorded.

## Rollback plan

- Branch: `claude/awesome-mccarthy-uwjyit`. PR: opened against `main`.
- Revert command once merged: `git revert -m 1 <merge-commit-sha>` (or
  `git revert <squash-commit-sha>` if squash-merged), then re-run
  `npm run deploy` to republish the pre-fix function code. The entity enum
  addition (`AuditLog.action` → `SCHOOL_DATA_EXPORTED`) and the
  `LUMI_CONFIRM_SECRET` app secret are both additive and inert if the code
  revert ships without them being rolled back — no entity rollback is
  required.
- `VERSION_CONTROL.json`/`package.json`/`appConfig.js` revert to `1.9.1` with
  the commit revert above; no separate action needed.
