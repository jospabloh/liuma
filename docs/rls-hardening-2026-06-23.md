# RLS Hardening (Round 5) — 2026-06-23

Source: Base44 Security Scan ("Seguridad" dashboard) — follow-up run flagging
**4 critical RLS issues**, all about missing **platform-owner** (`role: "admin"`)
coverage on platform-scoped entities. RLS rules live in the Base44 backend
(entity schemas) and were applied via the Base44 entity-schema API; this document
is the repo-side record for traceability and the
`base44/entities/*.jsonc` mirrors were updated to match. Builds on rounds 1–4
(`docs/rls-hardening-2026-06-04*.md`).

> Platform owner = the built-in Base44 `role: "admin"` (ACACIA/platform), distinct
> from a school's app-level `data.app_role: "ADMIN"`. The fixes grant the platform
> owner the oversight the scanner expects **without** removing any existing
> school-admin or requester access.

## Fixes applied (4 critical issues)

| Entity | Operation(s) | Change |
|---|---|---|
| **School** | `create`, `delete` | Were `null` (no rule). `create` and `delete` are now restricted to the platform owner (`role:admin`), centralizing school provisioning/removal. `read`/`update` unchanged (platform owner + own-school members read; school ADMIN updates its own school). |
| **SchoolSubscription** | `create` | Was `null`. Now only the platform owner may create subscription records (prevents a school from minting its own license). `read` (platform owner + own-school ADMIN), `update`/`delete` (platform owner) unchanged. |
| **SupportTicket** | `read`, `update`, `delete` | Added a platform-owner branch so the owner can read/update tickets across **all** schools; `delete` (was `null`) is now platform-owner-only. Existing access preserved: requester reads own tickets; school ADMIN reads/updates tickets in its school; requester+school-scoped `create` unchanged. |
| **SupportTicketMessage** | `read` | Restructured to `$or[ platform-owner, (own-school AND (school-ADMIN OR requester)) ]` so the platform owner can read every message for full oversight. `create` (school-scoped: school ADMIN / author / requester) and `update`/`delete` (`null`) unchanged. |

## Rationale

The scanner treats these four entities as **platform-governed**: schools and their
subscriptions are provisioned centrally (ACACIA), and support tickets/messages
need cross-tenant visibility for the platform support desk. A missing or `null`
rule on `create`/`delete` is flagged because it leaves the operation undefined;
granting it explicitly to `role:admin` closes the gap while keeping tenants
unable to self-provision or escalate.

## Access preserved (no regressions)

- **Parents** still open and read their own `SupportTicket`s and post/read their
  own `SupportTicketMessage`s (requester branches intact).
- **School ADMINs** still read/update tickets and read messages within their own
  school (`data.app_role: "ADMIN"` + own `school_id` branches intact).
- **School ADMINs** still read their own `School` and `SchoolSubscription`.
- No `create` path was widened for tenants; school/subscription creation is now
  strictly platform-owner.

## Verification

- Each change was applied with `update_entity_schema` re-sending the **full field
  schema** (so field definitions were preserved) plus the complete `rls` block;
  the API echoed back the persisted `rls`, confirming the rules took effect.
- The `base44/entities/{School,SchoolSubscription,SupportTicket,SupportTicketMessage}.jsonc`
  mirrors were updated to the same rules and validated as parseable.
- App quality gates (lint, typecheck, tests, build) re-run green; these are
  backend RLS changes with no source-code impact.
