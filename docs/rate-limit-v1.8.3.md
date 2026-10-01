# Base44 rate limit: fewer reads, retries, and errors that look like errors (v1.8.3)

Live QA of production v1.8.2 (2026-10-01) with three sessions at once
(director, maestro, padre): hundreds of `500 {code:'INTERNAL'}` from
`schoolRead` and `getMySubscription`, and screens that rendered those failures
as real data: "Sin avisos", "Sin hijos vinculados", "Sin salón", zero counts, and
a disabled "Crear aviso". When each session ran alone, the same flows had 0–10
errors.

## What the limit is

**Measured (function logs, `functions-mgmt/{fn}/logs`, 2026-10-01 08:54–09:02 UTC):**

- Each failure is logged as `schoolRead failed Rate limit exceeded` followed by
  `POST → 500`. The function itself was invoked; the error came from an entity
  call made inside it with the **service role**, and the `catch` turned it into
  `500 INTERNAL`. `auth.me()` cannot be the source: it is caught and answered as 401.
- `getMySubscription` failed in the same seconds (08:55:22–23, 08:55:30,
  08:55:48–49) as the `schoolRead` bursts, for different users. So the budget
  is **shared across functions and across users**. In practice that means one
  budget for the app's service role, not one per function or per user.
- In the minute before the first failure (08:54:20–08:55:20), about 25
  `schoolRead` and 6 `getMySubscription` invocations succeeded. At 3–5
  service-role calls each, that is **about 130–150 entity calls a minute**. After
  saturation, failures came in bursts and successes came back 5–10 s later.

**Reported, not official:** several builders report that Base44 support gave
them **150 operations per minute**, per "person", on every plan below
Enterprise ([escapebase44.com](https://escapebase44.com/base44-production-ready),
[appstuck.com](https://www.appstuck.com/blog/base44-rate-limit-exceeded-fix-2026)).
Nothing in `@base44/sdk` 0.8.52, the Base44 skill docs, or the MCP API catalog
documents a number. The measurement above agrees with 150/min, with every
user's function calls counted against the one service-role "person".

## What changed

**Fewer calls (the fix itself):**

| Change | Where |
|---|---|
| `schoolRead()` calls made within 10 ms of each other travel as **one** `queries` request (one invocation, one scope derivation), within the server's caps (≤12 reads, ≤3 scan-mode). Identical reads in flight share one answer. A lone read keeps the single shape. | `src/lib/data/schoolReadCore.js` |
| `context()` rides on that same request (`context: true`). It is shared for 30 s and reset after any write. | same + `schoolRead/_answer.ts` |
| `readMany()` goes through the batcher too. TeacherHome no longer waits for its scope before asking for its lists, and AdminHome reads its two notice lists at once. | `TeacherHome.jsx`, `AdminHome.jsx` |
| React Query `staleTime` 30 s (was 0). After any successful write every cached list is marked stale **without** refetching (`refetchType:'none'`), so a screen never shows data from before a write. | `query-client.js`, `queryErrorPolicy.js` |
| `getMySubscription`: once per session. It is fresh for 5 min, and kept in this tab's `sessionStorage` keyed by user and school, so a reload does not ask again. Logout clears it. | `subscriptionSession.js`, `useSubscription.js`, `AuthContext.jsx` |
| The caller's own `UserProfile` is read with **their** token (own-row RLS) in `schoolRead` and `getMySubscription`, not with the service role. | both `entry.ts` |

**Resilience:**

- The rate limit now comes back as **`429 RATE_LIMITED` + `Retry-After: 3`**
  from `schoolRead`, `getMySubscription`, `listSchoolMembers`,
  `guardedEntityWrite` and `guardedFamilyWrite`. It used to be `500 INTERNAL`,
  and `getMySubscription` echoed the raw SDK message.
- `invokeFunction` retries **read** functions only
  (`IDEMPOTENT_READ_FUNCTIONS`: `schoolRead`, `getMySubscription`,
  `listSchoolMembers`). It retries on 429, 502/503/504, 500 INTERNAL, or no
  answer. There are at most 3 retries, with exponential backoff and equal
  jitter (300–600 ms, 0.6–1.2 s, 1.2–2.4 s), and `Retry-After` is honoured (up
  to 10 s). While one read waits out a limit, the next reads wait too. **Writes
  are never retried**: a write that failed halfway could otherwise duplicate a
  payment or an email. React Query adds no retries on top (`retriesExhausted`).
- A failed read is no longer an empty list. `blockingLoadFailure()` plus
  `<LoadError>` (Spanish, "Reintentar", "Tus datos no se perdieron") cover
  Avisos, AvisosMaestro, AvisosAdmin, MisHijos, Pagos, SolicitarAusencia,
  GestionAlumno ("No se pudo cargar el salón" + Reintentar instead of "Sin salón", `studentClassroomLabel.js`), Bitácora,
  Tarea, EventosParaPadres, PedidosUniformes, Reportes, Asistencia (padre), and
  the three homes. The license banner gets "Reintentar" in place of "recarga
  la página".

## Numbers: `npm run test:load`

`scripts/load-test-reads.mjs` runs the real client reader, `invokeFunction`,
the retry policy, and the real `schoolRead` request path (`_answer.ts` +
`_scope.ts`) against a mock platform. The mock has one school (120 students,
6 salones) and a 150-per-rolling-minute budget for service-role calls. Each
screen's queries are copied from the page source. "before" is v1.8.2
behaviour.

**One cold visit per screen** (function invocations / service-role entity calls):

| screen | inv before | inv after | ops before | ops after |
|---|--:|--:|--:|--:|
| AdminHome | 12 | 2 | 26 | 14 |
| AvisosAdmin | 4 | 2 | 9 | 5 |
| Reportes | 9 | 3 | 19 | 10 |
| TeacherHome | 3 | 2 | 15 | 10 |
| AvisosMaestro | 5 | 2 | 20 | 9 |
| CrearBitacora | 4 | 3 | 15 | 9 |
| ParentHome | 6 | 3 | 23 | 11 |
| Avisos | 3 | 2 | 11 | 6 |
| Pagos | 3 | 3 | 11 | 8 |
| MisHijos | 2 | 2 | 7 | 5 |
| SolicitarAusencia | 3 | 2 | 11 | 6 |
| **total** | **54** | **26** | **167** | **93 (−44%)** |

**Director, teacher and parent browsing at once** (3 rounds of each route).
"failed" counts queries that reached the screen as a failure after every
retry; before v1.8.3 each one rendered as an empty list:

| scenario | inv before → after | rate-limited before → after | failed before → after |
|---|--:|--:|--:|
| QA pace (1.5 s per screen), full reloads | 404 → 102 | 346 → 52 | 171 → 46 |
| QA pace, in-app navigation | 319 → 18 | 263 → 0 | 129 → 0 |
| brisk (5 s), full reloads | 371 → 79 | 257 → 22 | 125 → 15 |
| brisk, in-app | 294 → 34 | 189 → 0 | 91 → 0 |
| human (15 s), full reloads | 300 → 64 | 100 → 0 | 50 → 0 |
| human, in-app | 232 → 64 | 42 → 0 | 21 → 0 |

The one scenario that still fails is a full page load every 1.5 s per person.
That is a demand of over 150 calls a minute, and no retry policy can fit it
into the budget. When it happens, the screen says so and offers a retry. It no
longer pretends the data is empty. `tests/unit/rate-limit-resilience.test.js`
runs the per-screen table and the QA-pace in-app scenario as a regression
gate.

## Deploy

There is no ordering constraint. The new client works against the deployed
v1.8.2 functions: the batch shape already exists, and when a server ignores
`context: true` the client asks for the context on its own. The new
functions also work with the old client.

- `npm run deploy`: `schoolRead` (new `_answer.ts`), `getMySubscription`,
  `listSchoolMembers`, `guardedEntityWrite`, `guardedFamilyWrite`. No new
  endpoint (20/40).
- `npm run deploy:site`.

**Verify by behaviour:** with three sessions open at once, the function logs
show `schoolRead rate limited` (warn) where `schoolRead failed Rate limit
exceeded` (error) used to be, and no screen shows "Sin avisos" or "Sin hijos
vinculados" while data exists.

## Not verified

- No live load test was run against production (no production writes or load
  from this environment). The numbers above come from the mock.
- Whether reads made with the user's token really draw on a per-user budget.
  If Base44 counts them against the same app budget, the "after" figures are
  about one call per invocation optimistic. That is still far below "before",
  because batching dominates.
- `Retry-After: 3` is inferred from the 5–10 s recovery gaps in the logs, not
  documented by Base44.
