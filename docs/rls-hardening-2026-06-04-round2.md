# RLS Hardening (Round 2) — 2026-06-04

Source: Base44 Security Scan ("Seguridad" dashboard) — "Corregir Todo" run flagging
8 critical RLS issues and 2 backend authorization failures. This document records
the row-level security (RLS) rule changes applied to the Base44 entity schemas for
app `696e967c430ceb6a2232ffd8` (LIUMA).

> RLS rules live in the Base44 backend (entity schemas), not in repository files.
> They were updated through the Base44 entity-schema API. This document is the
> repo-side record of those changes for traceability. It follows the first round
> recorded in `docs/rls-hardening-2026-06-04.md`.

All rule conditions remain scoped to the authenticated user's `school_id`
(tenant isolation). Roles are read from `user.data.app_role`
(`ADMIN` / `TEACHER` / `PARENT`).

## RLS fixes applied (8 critical issues)

| Entity | Operation | Change |
|---|---|---|
| **DiaryEntry** | `read` | Removed the standalone role-only branches (`{app_role: TEACHER}` and `{app_role: PARENT}` OR'd on their own) that let any teacher or parent read every diary entry in the school. Reads are now per-role and scoped: teachers → assigned classrooms (`classroom_id ∈ assigned_classroom_ids`); parents → linked students (`student_id ∈ linked_student_ids`); admins → whole school. |
| **Homework** | `read` | Same vulnerability and fix pattern as DiaryEntry. Teachers read only their assigned-classroom homework; parents read only homework for their children's classrooms (`classroom_id ∈ linked_student_classroom_ids`); admins read the whole school. |
| **Event** | `read` | Added an explicit `ADMIN` branch so admins read all events in their school, making the existing policy explicit. School-wide events stay readable by everyone in the tenant; classroom events stay scoped to teachers' assigned classrooms and parents' children's classrooms. |
| **SchoolSubscription** | `update`, `delete` | Replaced the platform-level `{role: "admin"}` condition (not tenant-scoped — an admin of any tenant could mutate another tenant's subscription) with `school_id` match + `app_role == ADMIN`. Restores cross-tenant isolation. `create` stays `null` (onboarding flow), `read` stays school-admin-only. |
| **ChargeItem** | `create`, `update` | `create`: added a parent branch so a parent can create an `EVENTO`-type charge for one of their linked students (`student_id ∈ linked_student_ids` + `concept_type == EVENTO`) when accepting a paid event; admins keep full create. `update`: added a parent branch scoped to their linked students so the client can flip `PENDING → OVERDUE` for their children's charges; admins keep full update. `read`/`delete` unchanged. |
| **NoticeDelivery** | new entity | Created the schema (previously auto-created with no RLS, so wide open). `read`: a recipient sees only their own deliveries (`recipient_user_id == user.id`), teachers see deliveries for their assigned classrooms, admins see all in the school. `create`: admins, or teachers for their assigned classrooms. `update`: admins or the recipient (mark READ / escalation). `delete`: admins only. All scoped to `school_id`. |
| **PendingChange** | new entity | Created the schema (role-change / permission-rollback approval requests). All operations restricted to school admins (`school_id` match + `app_role == ADMIN`). |
| **PermissionOverride** | new entity | Created the schema (granular permission overrides). All operations restricted to school admins (`school_id` match + `app_role == ADMIN`). |

## 2 backend authorization failures — resolved by the ChargeItem RLS change

The scan flagged two client flows that would fail authorization against the old
ChargeItem RLS (admin-only `create`/`update`). The client code was already
correct; the RLS policy was the blocker. The ChargeItem `create`/`update`
changes above unblock both:

| File | Flow | Resolution |
|---|---|---|
| `src/pages/EventosParaPadres.jsx` | Parent accepts a paid event → creates an `EVENTO` `ChargeItem` for their child. | `ChargeItem.create` now allows a parent to create an `EVENTO` charge for a linked student. |
| `src/pages/Pagos.jsx` | Parent view auto-updates an overdue charge `PENDING → OVERDUE` for their children. | `ChargeItem.update` now allows a parent to update charges for their linked students. |

No application code changes were required for these two findings.

## Notes / accepted trade-offs

- **NoticeDelivery teacher reads** are scoped to assigned classrooms. For
  `SCHOOL`-scope notice deliveries created with a null `classroom_id`, the
  teacher "unread urgent" home widget (`TeacherHome.jsx`) may not surface those
  rows. The recipient parent still receives and reads their own delivery; this is
  an intentional tightening of a previously wide-open entity.
- These three entities (`NoticeDelivery`, `PendingChange`, `PermissionOverride`)
  were being dynamically created by the app with no schema and therefore no RLS.
  Formalizing the schemas with strict RLS closes that exposure.

### Verification

Each update/create was confirmed by the Base44 schema API returning the persisted
`rls` block. For updated entities the full field schema was re-sent (not just the
`rls` block) so field definitions were preserved.
