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

**Fix:**
- `allowedStatuses` narrowed to `['PENDING']` only.
- `userName`/`userEmail` are now required to match the authenticated
  caller's own `user.full_name`/`user.email` (case-insensitive on email) —
  a mismatch is rejected with `403 CONTEXT_MISMATCH`.
- `roleName` is no longer read from `templateContext` at all — it's derived
  server-side from the caller's own `app_role` via a new
  `PENDING_ROLE_LABELS_ES` map.
- Idempotency: a new `UserProfile.pending_notification_sent_at` field is set
  after a successful send and checked before every attempt — a replay is a
  no-op (`{ ok: true, skipped: true, reason: 'already_notified' }`) instead
  of another email.

### 2d. `notifyParents` — diary path had no delivery-idempotency flag (backend_functions)

> *"La ruta 'diary' no marca la entrada como enviada; dentro de la ventana de
> 10 minutos, llamadas repetidas con el mismo recordId reenvían el correo a
> los padres tantas veces como se invoque."*

The function's own code comment already flagged this as a known gap
("DiaryEntry has no 'notified' flag... one diary id could be replayed to
mail the same parents indefinitely") — the time window was defense in depth,
not the actual guard.

**Fix:** new `DiaryEntry.parents_notified_at` field (distinct from the
existing `sent_at`, which the client sets at creation time as *intent*, not
proof of delivery). Set only after a real send (`sent > 0`, same pattern the
absence path already uses for `Attendance.notified_at`), and checked before
every send attempt.

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

After committing the fixes, this pass redeployed via the same
`POST /api/apps/{app_id}/deploy` call and re-ran the Base44 security scan.
*(Fill in once the redeploy for this branch's merge commit has actually run —
see the PR/commit history for the exact checkpoint and scan timestamp.)*

## Not verified

- No live authenticated session (any role, any school) — not reachable from
  this sandbox. UI/UX/cross-device review was limited to source reading.
- The 32 entities *other than* `User` were not individually re-read against
  the live schema this pass — `validate:rls` covers the repo file, and this
  pass's Base44 MCP reads were targeted at `User` (finding 1) rather than an
  exhaustive re-walk.
- `npm run test:smoke` — this sandbox's outbound proxy doesn't reach
  `*.base44.app`; it runs in `smoke.yml` on GitHub Actions instead.
