# Base44 Entity Setup — Support Desk

The support-desk code merged in PR #94 references two Base44 entities that **do
not exist yet** and must be created in the Base44 Builder before the feature
works. This is a copy-paste runbook.

> Verified 2026-06-18 against the live app entity list (app
> `696e967c430ceb6a2232ffd8`): `SupportTicket` and `SupportTicketMessage` are
> absent. Until they exist, the Soporte pages load but ticket reads/writes fail.

Base44 adds `id`, `created_date`, `updated_date`, and `created_by_id`
automatically — do **not** define those.

## Option A — paste into the Base44 AI chat

> Create two new entities.
>
> **SupportTicket** with fields: ticket_number (string), school_id (string),
> requester_user_id (string), requester_profile_id (string), requester_role
> (enum: ADMIN, TEACHER, PARENT), requester_name (string), subject (string),
> category (enum: ACADEMIC, PAYMENTS, ACCOUNT, TECHNICAL, BILLING, OTHER),
> priority (enum: LOW, NORMAL, HIGH, URGENT), status (enum: OPEN, AI_RESOLVED,
> ESCALATED, IN_PROGRESS, WAITING_USER, RESOLVED, CLOSED), tier (enum:
> SCHOOL_ADMIN, PLATFORM), assignee_role (string), channel_origin (enum:
> LUMI_AI, MANUAL), ai_attempted (boolean), ai_resolution_summary (string),
> sla_due_at (datetime), first_response_at (datetime), resolved_at (datetime),
> escalated_at (datetime).
> RLS: read = the requester (requester_user_id == current user) OR an ADMIN whose
> UserProfile.school_id == the record's school_id OR the app owner; create = any
> signed-in in-school user with requester_user_id == self and school_id == own
> school; update = ADMIN of the same school OR the app owner; delete = app owner.
>
> **SupportTicketMessage** with fields: ticket_id (string), school_id (string),
> author_user_id (string, optional), author_role (enum: REQUESTER, AI,
> SCHOOL_ADMIN, OWNER, SYSTEM), body (string).
> RLS: read and create = the requester of the parent ticket, an ADMIN of the same
> school_id, or the app owner.

## Option B — create manually (Dashboard → Data → Add entity)

### SupportTicket

| Field | Type | Required |
| --- | --- | --- |
| `ticket_number` | string | yes |
| `school_id` | string | yes |
| `requester_user_id` | string | yes |
| `requester_profile_id` | string |  |
| `requester_role` | enum: ADMIN, TEACHER, PARENT | yes |
| `requester_name` | string |  |
| `subject` | string | yes |
| `category` | enum: ACADEMIC, PAYMENTS, ACCOUNT, TECHNICAL, BILLING, OTHER | yes |
| `priority` | enum: LOW, NORMAL, HIGH, URGENT | yes |
| `status` | enum: OPEN, AI_RESOLVED, ESCALATED, IN_PROGRESS, WAITING_USER, RESOLVED, CLOSED | yes |
| `tier` | enum: SCHOOL_ADMIN, PLATFORM |  |
| `assignee_role` | string |  |
| `channel_origin` | enum: LUMI_AI, MANUAL |  |
| `ai_attempted` | boolean |  |
| `ai_resolution_summary` | string |  |
| `sla_due_at` | datetime |  |
| `first_response_at` | datetime |  |
| `resolved_at` | datetime |  |
| `escalated_at` | datetime |  |

### SupportTicketMessage

| Field | Type | Required |
| --- | --- | --- |
| `ticket_id` | string | yes |
| `school_id` | string | yes |
| `author_user_id` | string |  |
| `author_role` | enum: REQUESTER, AI, SCHOOL_ADMIN, OWNER, SYSTEM | yes |
| `body` | string | yes |

### RLS rules

`SupportTicket`
- **read**: `requester_user_id == {{user.id}}` OR (`{{user.app_role}} == 'ADMIN'`
  AND `school_id == {{user.school_id}}`) OR app owner.
- **create**: signed-in, `requester_user_id == {{user.id}}`, `school_id ==
  {{user.school_id}}`.
- **update**: (`{{user.app_role}} == 'ADMIN'` AND `school_id ==
  {{user.school_id}}`) OR app owner.
- **delete**: app owner only.

`SupportTicketMessage`
- **read / create**: requester of the parent ticket, ADMIN of the same
  `school_id`, or app owner. If cross-entity lookups are awkward in Base44, scope
  by `school_id` and rely on the app layer (`policy.js`) for the finer checks —
  note the choice here when applied.

## After creating the entities

1. Attach `docs/user-manual.md` as the knowledge source for the `lumi` agent so
   the L0 AI deflection answers from real documentation.
2. Smoke-test: open **Soporte** as a parent, create a ticket, confirm it appears
   for the school ADMIN in **Soporte** (console) and that a reply notifies the
   parent.

## Owner detection note (important)

The cross-tenant owner queue depends on identifying the platform owner. The
deployed `UserProfile` schema does **not** include `is_super_admin`, so the
console falls back to the authenticated Base44 `User.role === 'admin'` (see
`src/lib/support/owner.js`). Two things to confirm in Base44:

- Whether you intend to add an `is_super_admin` boolean to `UserProfile` (the
  v1.0.6 changelog and the owner-override code assume it exists).
- That the owner's Base44 `User.role` is `admin`, and that the owner's
  `UserProfile.school_id` is set, so RLS lets them read across tenants.
