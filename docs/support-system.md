# LIUMA Support Desk — Design & Operations

Status: **implemented in the app (frontend + policy + Lumi intent)**; requires
two Base44 backend entities to be created before it goes live (see
[Base44 setup](#base44-setup-required-before-go-live)).

## 1. Overview

LIUMA's support desk is a **two-tier help desk**:

```
Parent / Teacher / Director  ──▶  [L0] Lumi AI deflection (reads the user manual)
                                        │  could not solve it
                                        ▼
                                   [L1] Human ticket
                                        ├─ School questions ──▶ school Director (ADMIN)
                                        └─ App / billing ─────▶ Platform owner (you)
```

- **L0 — Lumi deflection.** The existing in-app assistant gains a
  `SUPPORT_REQUEST` capability. It answers from `docs/user-manual.md` and, if it
  cannot resolve the issue, offers to open a ticket.
- **L1 — Human escalation.** A `SupportTicket` is created with a human-friendly
  number (`LIUMA-2026-000042`), an SLA deadline, and a thread the requester and
  the assignee converse in until it is resolved.

## 2. Routing (who receives a ticket)

Implemented in `src/lib/support/routing.js`.

| Requester | Category | Goes to |
|---|---|---|
| Parent / Teacher | Academic, Payments, Account, Other | **School Director (ADMIN)** of their school |
| Parent / Teacher | Technical, Billing | **Platform owner** (super-admin) |
| Director (ADMIN) | any | **Platform owner** (a director sits atop their school) |

Rationale: school-operational questions ("¿cuándo es el evento?") belong to the
school; app failures and the school's LIUMA subscription belong to you.

## 3. SLA (first-response targets)

Implemented in `src/lib/support/sla.js`. Profile: **Relaxed**, in business days
(weekends excluded), measured to **first human response**:

| Priority | First response |
|---|---|
| URGENT | 1 business day |
| HIGH | 2 business days |
| NORMAL | 3 business days |
| LOW | 5 business days |

`sla_due_at` is stamped at creation. The clock stops at the first staff reply
(`first_response_at`). The management console flags breached tickets. To retune,
edit `SLA_BUSINESS_DAYS`.

## 4. Ticket lifecycle

Implemented in `src/lib/support/statusMachine.js`.

```
OPEN ─┬─▶ AI_RESOLVED ─▶ CLOSED
      └─▶ ESCALATED ─▶ IN_PROGRESS ⇄ WAITING_USER ─▶ RESOLVED ─▶ CLOSED
                                                         └─(reopen)─▶ IN_PROGRESS
```

Invalid transitions are rejected, so the history stays auditable. A ticket
created from the form is born `ESCALATED` (the AI step already happened).

## 5. Frontend

| File | Purpose |
|---|---|
| `src/pages/Soporte.jsx` | Requester view: explains the process, lists *my* tickets, opens new ones, threads. Route `Soporte` (all roles). |
| `src/pages/SoporteAdmin.jsx` | Management console: queue with priority filter, SLA-breach flags, reply, status actions. Route `SoporteAdmin` (ADMIN; owner sees all tenants). |
| `src/components/support/NewTicketDialog.jsx` | Create-ticket form (subject, category, priority, description) showing where it will route. |
| `src/components/support/TicketThread.jsx` | Threaded conversation + reply box. |
| `src/components/support/labels.jsx` | Spanish labels + badges for status / priority / category. |
| `src/lib/support/*` | Pure logic: constants, routing, SLA, ticket numbers, status machine, and the `tickets.js` data/service layer. |

Navigation: a "Soporte y ayuda" tile is on the Parent and Teacher home screens;
the Admin home links to the management console. The Lumi assistant can be opened
from the support page via the `lumi:open` window event.

## 6. Authorization

- **App layer** (`src/lib/authorization/policy.js`): `SupportTicket` and
  `SupportTicketMessage` are readable/writable by all in-school roles; row-level
  scoping is enforced by the data layer and Base44 RLS.
- **Routes** (`routeAccess.js`): `Soporte` = all roles, `SoporteAdmin` = ADMIN.
- **Lumi** (`lumi/capabilities.js`): `SUPPORT_REQUEST` intent gated like every
  other capability.
- **Audit** (`audit.js`): ticket create / message / status-change are written to
  `AuditLog` under the `SupportTicket` entity, including owner cross-tenant
  access — consistent with the existing owner-override discipline.

## 7. Base44 setup (required before go-live)

The app references two entities that must be created in the Base44 builder with
RLS. Until they exist, the support pages will load but ticket reads/writes will
fail.

### 7.1 `SupportTicket`

Fields: `ticket_number` (string), `school_id` (string), `requester_user_id`
(string), `requester_profile_id` (string), `requester_role` (enum
ADMIN/TEACHER/PARENT), `requester_name` (string), `subject` (string), `category`
(enum ACADEMIC/PAYMENTS/ACCOUNT/TECHNICAL/BILLING/OTHER), `priority` (enum
LOW/NORMAL/HIGH/URGENT), `status` (enum per §4), `tier` (enum
SCHOOL_ADMIN/PLATFORM), `assignee_role` (string), `channel_origin` (enum
LUMI_AI/MANUAL), `ai_attempted` (bool), `ai_resolution_summary` (string),
`sla_due_at` (datetime), `first_response_at` (datetime), `resolved_at`
(datetime), `escalated_at` (datetime).

RLS:
- **read** — the requester (`requester_user_id == auth.user_id`) **or** an ADMIN
  of the same `school_id` **or** a super-admin (`is_super_admin == true`, any
  tenant).
- **create** — any authenticated in-school user, with `requester_user_id` ==
  self and `school_id` == own school.
- **update** — an ADMIN of the same `school_id` **or** a super-admin. (Requesters
  interact through messages; they do not patch the ticket directly.)
- **delete** — super-admin only.

### 7.2 `SupportTicketMessage`

Fields: `ticket_id` (string), `school_id` (string), `author_user_id` (string,
nullable for AI/SYSTEM), `author_role` (enum REQUESTER/AI/SCHOOL_ADMIN/OWNER/
SYSTEM), `body` (string).

RLS:
- **read / create** — the requester of the parent ticket, an ADMIN of the same
  `school_id`, or a super-admin. (If cross-entity RLS is awkward in Base44, scope
  by `school_id` + the requester's own messages and rely on the app layer for the
  rest; document the choice here when applied.)

### 7.3 Lumi knowledge base

Attach `docs/user-manual.md` (plus this file's user-facing summary) as the
knowledge source for the `lumi` agent so L0 deflection answers from real product
documentation. Configure the agent to, when it cannot resolve a request, instruct
the user to open a ticket from the Soporte page.

## 8. Known limitations / future work

- **Ticket-number sequence** is derived from a per-year count and could collide
  under heavy concurrency. Move to an atomic Base44 server-function counter if
  volume grows (`allocateTicketNumber` in `tickets.js`).
- **SLA breaches** are surfaced in the console but not yet pushed as reminders;
  a scheduled job could notify assignees of imminent/over-SLA tickets.
- **Attachments** (screenshots) are not yet supported on messages.
