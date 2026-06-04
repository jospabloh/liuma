# RLS Hardening (Round 3) — 2026-06-04

Source: Base44 Security Scan ("Seguridad" dashboard) — follow-up run flagging
2 critical RLS issues. RLS rules live in the Base44 backend (entity schemas) and
were applied via the Base44 entity-schema API; this document is the repo-side
record for traceability. Builds on `docs/rls-hardening-2026-06-04.md` (round 1)
and `docs/rls-hardening-2026-06-04-round2.md` (round 2).

## Fixes applied (2 critical issues)

| Entity | Operation | Change |
|---|---|---|
| **ChargeItem** | `update` | Restricted back to school admins only (`school_id` match + `app_role == ADMIN`). Round 2 had opened `update` to parents (for their linked students) so the parent payments view could persist `PENDING → OVERDUE`; that branch placed **no field restriction**, so a parent could have modified financial fields such as `amount`. Reverting `update` to admin-only closes the amount-tampering hole. `create` keeps the parent `EVENTO` branch (a parent still creates the charge for their own child when accepting a paid event); `read`/`delete` unchanged. |
| **NoticeRead** | `create`, `read` | Added a `school_id` field and scoped both `create` and `read` to the user's own tenant (`data.user_id == user.id` **and** `data.school_id == user.data.school_id`). Previously the rules checked only `user_id`, so a record could be tied to a notice outside the user's school. Prevents cross-tenant read-receipt records. `update`/`delete` remain disabled. |

## App code change — parent payments view

`src/pages/Pagos.jsx` previously looped over the parent's charges and called
`ChargeItem.update(id, { status: 'OVERDUE' })` for past-due `PENDING` charges.
With `update` now admin-only this write would be denied for parents. It was also
unnecessary: the UI never reads the stored `OVERDUE` status — both the per-charge
badge (`isOverdue = status !== 'PAID' && isPast(due_date)`) and the per-student
status (`hasOverdue = ...isPast(due_date)`) derive "Vencido" locally from
`due_date`. The write loop was removed; parents still see overdue charges
correctly, and charge state remains admin-managed.

> Net effect for parents: read their children's charges and create an `EVENTO`
> charge when accepting a paid event. They can no longer update or delete charges.

### Verification

Each schema change was confirmed by the Base44 schema API returning the persisted
`rls` block. For `ChargeItem` the full field schema was re-sent so field
definitions were preserved.
