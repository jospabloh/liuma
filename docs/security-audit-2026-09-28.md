# Security audit — 2026-09-28

Scheduled full-review audit pass (owner: h.josepablo@gmail.com). Scope: the
LIUMA app-standard checklist — pre-flight inventory, RLS/isolation gate,
code-quality/permissions sweep, UI/UX and cross-device review where reachable,
automated-test run, changelog/version catch-up, PR + rollback plan — plus,
for the first time with this session having live Base44 MCP access, Base44's
own `security/scan` endpoint (previously undocumented as accessible; earlier
passes noted "no pude leer el resultado del scan").

Repo state at start: `main` / `claude/awesome-mccarthy-4m7di7` both at
`6ecb2ec` (`HEAD == origin/main`), zero open PRs, no stray audit branches, no
secrets in tree (`.env.example` the only versioned `.env*`).

## Finding 1 — production deploy was stale (the deploy-drift class, again)

`GET /api/apps/{app_id}/app-checkpoints` showed the checkpoint for
`6ecb2ec` ("Move credit-consuming SendEmail/InvokeLLM calls to backend
functions", the commit that shipped both 1.7.15's credit-protection functions
and Module 24's `User` RLS lock) had built cleanly on Base44
(`preview_status: ready`, `is_github_sync: true`) but `last_deployed_at` was
`null`. The last **real** deploy was the prior checkpoint, `713eb35`
(2026-09-24T22:40), a docs-only commit — meaning 1.7.15's actual security
fixes had never reached production.

This is the same class of gap 1.7.14 (2026-09-21) fixed six weeks earlier,
and the third time in six weeks LIUMA's deploy has gone stale under the
portfolio's "merging to `main` does not deploy anything" rule.

**Fixed:** `POST /api/apps/{app_id}/deploy` via the Base44 platform API
(no `checkpoint_id` — deploys the current version, which was `6ecb2ec`).
Confirmed by content, not just by hash:

```
list_entity_schemas(User) →
  school_id.rls.write == false
  app_role.rls.write == false
```

both fields live, matching `base44/entities/User.jsonc`. The checkpoint's
own `last_deployed_at` also picked up a timestamp with `git_commit_hash`
matching `main`'s HEAD.

## Finding 2 — Base44's security scan, run for the first time against this code

Deploying finding 1's code let Base44's `security/scan` see it for the first
time (the scan's previous "clean" result, from 2026-09-24T22:47, predated
these files entirely — it was a stale cache hit, not a real all-clear). A
fresh scan (`POST` then polled via `GET` until `status: up_to_date`) came
back with `static_code_enabled: true` and:

- `rls_recommendations`: none
- `hardcoded_secrets`: none
- `dependency_vulnerabilities`: none
- `backend_functions`: **3 findings** (below)
- `static_code_findings`: **1 finding, verdict `confirmed`** (below)
- `core_integration_recommendation`: `compatible`

### 2a. `guardedEntityWrite` — attribution-field spoofing (backend_functions)

> *"En 'create', todos los campos del cuerpo se escriben verbatim con service
> role, incluyendo campos de atribución como recorded_by / recorded_by_name,
> que un llamador puede falsificar para hacer parecer que otro docente
> registró la asistencia o la bitácora."*

`Attendance.recorded_by`, `DiaryEntry`/`Homework.teacher_id`,
`Notice.author_id` and `PaymentRecord.recorded_by` are each pinned by the
entity's **own deployed RLS** to `{{user.id}}` on create/update — but
`guardedEntityWrite` writes with the service role, bypassing that RLS
entirely, and wrote `body.data` verbatim. Grepped every real call site in
`src/` (`Asistencia.jsx`, `GestionAusencias.jsx`, `AvisosAdmin.jsx`,
`AvisosMaestro.jsx`, `TareaMaestro.jsx`, `CrearBitacora.jsx`): every single
one already sends the caller's own `user.id`/`user.full_name` — none ever
sets it to someone else. So overriding rather than trusting the client's
value costs no legitimate use.

**Fix:** a new `ATTRIBUTION_FIELDS` map in `entry.ts`. On `create`, the id/
name fields are force-set from `user.id`/`user.full_name`, overwriting
whatever the client sent. On `update`, they're stripped from the patch
outright (no call site ever changes them after the fact).

### 2b. `guardedEntityWrite` — PARENT/EVENTO `ChargeItem` carve-out trusts client amount/status (static_code_findings, **confirmed**)

> Severity medium, confidence high, category `payment_or_webhook_risk`,
> verification verdict `confirmed`.
>
> *"Nothing validates `amount`, `original_amount`, `discount_amount`,
> `status`, `concept_id`, or `event_id`... the write executes with the
> service role... A parent accepts a paid event through the API but instead
> submits `amount: 0, status: 'PAID'`... the school's billing records now
> show the event fee as already settled at zero cost."*

Confirmed by reading the code: the PARENT/EVENTO carve-out
(`parentCanCreateEventCharge`) only checked that the parent is linked to the
student — it never touched the financial fields, which came straight from
`body.data` into `sr.entities.ChargeItem.create(...)`.

**Fix:** new `buildEventChargeData(sr, schoolId, studentId, eventId)`.
When the carve-out grants access, the create handler uses this function's
return value **instead of** `body.data` — every financial field
(`amount`, `original_amount`, `concept_name`, `due_date`, `discount_amount:
0`, `status: 'PENDING'`) is derived from the referenced `Event` record
(`cost_amount`, `cost_concept`, `confirmation_deadline`/`date`), which is
what `EventosParaPadres.jsx`'s legitimate call already matches field-for-
field. Returns `null` (denying the write) if the event doesn't exist, isn't
in the caller's school, or has no cost — closing the door on an `event_id`
that doesn't back the claim.

### 2c. `sendNotificationEmail` — `new_user_pending` abuse surface (backend_functions)

> *"El evento 'new_user_pending' permite a cualquier usuario registrado
> (incluso con perfil PENDING) enviar correos repetidamente a los admins de
> su escuela con texto arbitrario en templateContext (userName, userEmail,
> roleName), sin límite de frecuencia ni verificación contra el usuario real
> pendiente."*

Two compounding gaps: `allowedStatuses` for this event was
`['ACTIVE', 'PENDING']` (should only ever be a genuinely pending
registrant), and `templateContext.userName`/`userEmail`/`roleName` were
trusted as free text and interpolated into an email to the school's admins
with no check against who the caller actually is, and no rate limit.

**Fix (first version):**
- `allowedStatuses` narrowed to `['PENDING']` only.
- `userName`/`userEmail` are now required to match the authenticated
  caller's own `user.full_name`/`user.email` (case-insensitive on email) —
  a mismatch is rejected with `403 CONTEXT_MISMATCH`.
- `roleName` is no longer read from `templateContext` at all — it's derived
  server-side from the caller's own `app_role` via a new
  `PENDING_ROLE_LABELS_ES` map.
- Idempotency: a new `UserProfile.pending_notification_sent_at` field, set
  after a successful send and checked before every attempt.

**Correction (same day, caught by Codex review on this fix's own PR,
comment [4119521075](https://github.com/jospabloh/liuma/pull/183)):** a
school can have several `ACTIVE` admins, and `sendByEvent`
(`src/lib/notifications/service.js:158-169`) calls `sendNotificationEmail`
once per recipient. A single `pending_notification_sent_at` timestamp on
the *pending user's own profile* — not per recipient — meant the first
successful send (to admin #1) set the flag, and every subsequent call in
the same fan-out (to admin #2, #3, ...) hit the idempotency guard before
even reaching recipient validation and was skipped as `already_notified`.
Only the first admin would ever actually be notified. **Also flagged
separately** (comment
[4119521081](https://github.com/jospabloh/liuma/pull/183)): the field had
no field-level `rls.write` restriction — `UserProfile.update`'s RLS lets a
user update their own profile, so the PENDING user this profile belongs to
could have forged or cleared the marker directly, bypassing the guard
entirely (same defect class Module 24 closed for `User.school_id`/
`app_role`, just on a different entity).

**Fixed:** `UserProfile.pending_notification_sent_at` → **`pending_notification_recipients`**,
an array of already-notified admin emails, checked with `.includes(email)`
per call instead of a single boolean/timestamp — each admin in the
school's fan-out gets notified exactly once, and a genuine replay of an
already-notified admin is still a no-op. The field carries
`"rls": {"write": false}`, the same lock `base44/entities/User.jsonc`
already uses for `school_id`/`app_role`.

### 2d. `notifyParents` — diary path had no delivery-idempotency flag (backend_functions)

> *"La ruta 'diary' no marca la entrada como enviada; dentro de la ventana de
> 10 minutos, llamadas repetidas con el mismo recordId reenvían el correo a
> los padres tantas veces como se invoque."*

The function's own code comment already flagged this as a known gap
("DiaryEntry has no 'notified' flag... one diary id could be replayed to
mail the same parents indefinitely") — the time window was defense in depth,
not the actual guard.

**Fix (first version):** new `DiaryEntry.parents_notified_at` field
(distinct from the existing `sent_at`, which the client sets at creation
time as *intent*, not proof of delivery). Set only after a real send
(`sent > 0`, same pattern the absence path already uses for
`Attendance.notified_at`), and checked before every send attempt.

**Correction (same day, caught by Codex review, comment
[4119521085](https://github.com/jospabloh/liuma/pull/183)):** when a
student has multiple linked parents and only *some* `SendEmail` calls
succeed, `sent > 0` still marked the **entire entry** as notified — so a
parent whose send transiently failed (a bad address, a momentary SendEmail
error) would never be retried; the record-level flag made the next call
within the window a no-op for everyone, successes and failures alike.
**Also flagged separately** (comment
[4119521091](https://github.com/jospabloh/liuma/pull/183)): same
missing-`rls.write:false` gap as 2c above — `DiaryEntry.update`'s RLS lets
the entry's own `teacher_id` update it, and `guardedEntityWrite`'s patch
only ever stripped `school_id` and the attribution fields, not this new
one, so the authoring teacher could have forged or cleared the marker
through either the direct entity API or the guarded write path.

**Fixed:** `DiaryEntry.parents_notified_at` (kept, informational — first
successful send timestamp) plus a new **`notified_parent_emails`** array
tracking exactly which recipients were actually delivered. Each call now
filters the resolved parent-email list down to the ones *not yet* in that
array before sending, so a partial failure only replays to the parents who
didn't get it. Both fields carry `"rls": {"write": false}`, and
`guardedEntityWrite`'s update handler gained a `SERVER_ONLY_UPDATE_FIELDS`
map (currently just this entity's two fields) stripping them from any
client-submitted patch — belt-and-suspenders, since the service-role write
in that function bypasses RLS entirely and the RLS lock alone wouldn't
stop it there.

## Verification

Before touching any fix, and again after every one:

```
npm run lint            # incl. validate:functions, 9/40 endpoints — 0 errors
npm run typecheck       # 0 errors (does not cover base44/functions — see below)
npm run build           # succeeds
npm run validate:rls    # 33 entities OK
npm run validate:tenant-roles   # Module 24 check — OK
npm test                 # 283/283 (278 baseline + 5 new, tests/unit/guarded-write-hardening-2026-09-28.test.js)
npm run test:permissions # 23/23
npm run release:gate     # passes (== test:permissions)
npm audit                 # 0 vulnerabilities
```

`deno` isn't available in this sandbox (same limitation every prior audit in
this repo documents), and `jsconfig.json`'s `typecheck` target excludes
`base44/functions/**` entirely (`include` is scoped to `src/components`,
`src/pages`, `src/Layout.jsx`). The three edited Deno functions were instead
syntax-checked with a standalone pass:

```
npx tsc --noEmit --noResolve --skipLibCheck --target esnext --module esnext \
  base44/functions/guardedEntityWrite/entry.ts \
  base44/functions/sendNotificationEmail/entry.ts \
  base44/functions/notifyParents/entry.ts
```

— which surfaced only the expected `npm:`-import and `Deno`-global
resolution errors (unresolvable outside a real Deno runtime), no syntax or
structural errors in the edited code. Real verification is `ci-deno.yml`
(this repo's own CI, which does run `deno fmt --check` / `deno lint` /
`deno test` on every push) plus this pass's own redeploy-and-rescan loop
below.

## Post-merge redeploy and re-verification

PR #183 merged as `923de50`. `POST /api/apps/{app_id}/github/sync` pulled it
(3 commits, `latest_commit_hash: 923de50`), then
`POST /api/apps/{app_id}/deploy` published it — confirmed by the new
checkpoint's own fields: `git_commit_hash: 923de505...`,
`last_deployed_at: 2026-09-28T07:31:11`.

Confirmed live **by content**, not just by checkpoint hash:

- `list_entity_schemas(DiaryEntry)` shows both `parents_notified_at` and
  `notified_parent_emails` with `rls.write: false`.
- `list_entity_schemas(UserProfile)` shows `pending_notification_recipients`
  with `rls.write: false`.
- `list_entity_schemas(User)` still shows `school_id`/`app_role` with
  `rls.write: false` (Module 24, unaffected by this pass).
- `read_file(base44/functions/guardedEntityWrite/entry.ts)` against the live
  sandbox shows the `ATTRIBUTION_FIELDS` map and its accompanying comment —
  the deployed function source matches the fix, not just the entity schemas.

A fresh Base44 security scan was triggered against the redeployed code
(`POST /api/apps/{app_id}/security/scan`) and, after ~15 minutes in the
background, settled to `status: up_to_date` at `2026-09-28T07:34:30`. Result:
**`backend_functions: []`** — all 4 findings from the first scan are
confirmed closed. It also surfaced new findings, covered next.

## Finding 5 (confirmed) — `notifyParents` never checked the student belongs to the record's own school

The second scan's `static_code_findings` included one `verdict: confirmed`
result this pass hadn't seen before:

> *"notifyParents... resolves recipients from the record's student_id...
> [but] the student referenced by the record is never verified to belong to
> that school, nor that the caller authored the record. guardedEntityWrite's
> create path accepts DiaryEntry/Attendance with any client-supplied
> student_id — only school_id is tied to the caller's profile."*

Root cause, traced to `guardedEntityWrite`: `schoolId` is re-derived from the
caller's own `UserProfile` (correct, and unchanged by this finding), but
`student_id` was taken from the request as-is with no check that the student
actually belongs to that school. A teacher in school A could create an
`Attendance`/`DiaryEntry` row with `school_id: A` but `student_id` pointing
at a school-B student; `notifyParents` would then look up that foreign
student's real parents and mail them content the school-A caller wrote,
presented as an official LIUMA notice. Scan's own severity call: low
(exploitability depends on obtaining a foreign student id, which isn't
enumerable through RLS) — but confirmed, and cheap to close.

**Fixed in two places:**
- `guardedEntityWrite`'s `create` handler now checks, whenever `data.student_id`
  is present, that `Student.get(studentId).school_id` matches the resolved
  `schoolId` — `400 STUDENT_NOT_IN_SCHOOL` otherwise. Its `update` handler
  now also strips `student_id` from the patch (same treatment as `school_id`
  already gets, on the same reasoning: no real call site ever reassigns it).
- `notifyParents` gained its own `assertStudentInSchool()`, called right
  after fetching the student on both the absence and diary paths — defense
  in depth in case a record ever reaches it through a path other than
  `guardedEntityWrite`.

Not changed: the scan's suggestion to also require the caller authored the
record. `GestionAusencias.jsx`'s legitimate flow has an ADMIN correct a
different teacher's attendance record and notify on their behalf — requiring
same-authorship would break that. The actual exploit (cross-**school**
targeting) is what the fix closes; same-school notification by any
TEACHER/ADMIN with an active profile remains intended behavior, unchanged.

## Findings not fixed this pass (deferred, documented)

The second scan surfaced two more `static_code_findings` (`verdict:
plausible`, not `confirmed`) and one `rls_recommendations` entry, all
**pre-existing** (not introduced by anything in this pass) and each a
larger, separate piece of work than a same-day fix warrants:

- **`ContactosEmergencia.jsx` creates `EmergencyContact` rows (including the
  `is_authorized_pickup` flag) for a `student_id` read straight from the URL,
  with no backend check that the caller is actually linked to that student**
  — medium severity, category `unauthorized_access`. The scan's own
  recommendation is to route this through a backend function that re-derives
  `ParentStudent` linkage server-side, mirroring the `ChargeItem`/EVENTO
  carve-out. Real work: a new guarded write path, not a one-line fix.
- **`src/lib/support/tickets.js`'s `addSupportMessage()` creates
  `SupportTicketMessage` rows directly from the browser with no check that
  the caller owns the `ticket_id` they're posting to**, and `author_role` is
  client-chosen — medium severity. Same shape of fix: a backend function
  re-deriving ticket ownership and the caller's real role.
- **`rls_recommendations`: `UserProfile.create`/`update` should require
  `user_condition: {role: admin}`** (platform owner) instead of the current
  `data.user_id: {{user.id}}` self-service rule, to close self-activation
  and school-reassignment paths. This is a materially different access
  model from what's deployed today — onboarding
  (`provisionOnboardingProfile`, `onboardingTenantCreation.js`) currently
  relies on a user being able to create/update their own `UserProfile`
  directly; adopting this recommendation as-is would need that flow audited
  and likely rewritten first, not just an RLS flip.

All three are flagged here, with fingerprints recorded below, for whoever
next has the scope to take them on:
`95a1dcdd9a22eaa82ecfc4a6359094a197cbd491d7e913cb17f038c1a2029217` (RLS),
`9aa9f68bc3df5bd8ee4d50a2b2f974c2e3083704dedff0139f79212dc5984fe1`
(EmergencyContact),
`fa32228d89e25f949fe844f6a66c004c5a10fb178d39185389c53883948faf17`
(SupportTicketMessage).

## Not verified

- **A third security scan, re-run after Finding 5's fix deployed, to confirm
  it too closes.** Not done as part of this pass — the second scan alone
  took ~15 minutes in the background, and this document's own writing had
  to conclude; whoever deploys Finding 5's fix should trigger one more scan
  and confirm `notifyParents`/`guardedEntityWrite` no longer appear.
- No live authenticated session (any role, any school) — not reachable from
  this sandbox. UI/UX/cross-device review was limited to source reading.
- The 32 entities *other than* `User` were not individually re-read against
  the live schema this pass — `validate:rls` covers the repo file, and this
  pass's Base44 MCP reads were targeted at `User` (finding 1) rather than an
  exhaustive re-walk.
- `npm run test:smoke` — this sandbox's outbound proxy doesn't reach
  `*.base44.app`; it runs in `smoke.yml` on GitHub Actions instead.
