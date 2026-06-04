# RLS Hardening (Round 4) — 2026-06-04

Source: Base44 Security Scan ("Seguridad" dashboard) — follow-up run flagging
1 critical RLS issue. RLS rules live in the Base44 backend (entity schemas) and
were applied via the Base44 entity-schema API; this document is the repo-side
record for traceability. Builds on rounds 1–3
(`docs/rls-hardening-2026-06-04*.md`).

## Fix applied (1 critical issue)

| Entity | Operation | Change |
|---|---|---|
| **OfficialDocument** | `read` | Previously any authenticated user in the school could read every document (`data.school_id == user school`), regardless of `target_audience`. Reads are now limited by audience **and** role: admins read all; teachers read `target_audience ∈ {TODOS, MAESTROS}`; parents read `target_audience ∈ {TODOS, PADRES}`. `ADMINS`-audience documents are admin-only. `create`/`update`/`delete` remain admin-only and were unchanged. |

### `UNIFORM_CATALOG` carve-out

The parent uniform-ordering flow (`src/pages/PedidosUniformes.jsx`) reads the
current `UNIFORM_CATALOG` document. Since `target_audience` is admin-chosen per
document, a mis-tagged catalog (e.g. `MAESTROS`) would otherwise become invisible
to parents and silently break uniform ordering. A uniform catalog is a
non-sensitive product listing, so the read rule allows **any role in the school**
to read documents of `document_type == UNIFORM_CATALOG` regardless of audience.
All other document types (`COMMUNICATION`, `MINUTA`, `MENU`) follow the
audience+role rule above.

### Notes

- No `OfficialDocument` records existed at the time of this change (verified via
  the Base44 query API), so there is no back-data visibility impact.
- Read paths: `GestionDocumentos.jsx` (admin-only route — covered by the admin
  branch) and `PedidosUniformes.jsx` (admin + parent — covered by the
  `UNIFORM_CATALOG` carve-out).
- Operational guidance: tag parent-facing communications as `TODOS` or `PADRES`
  and teacher-facing ones as `TODOS` or `MAESTROS` so the intended audience can
  read them.

### Verification

The change was confirmed by the Base44 schema API returning the persisted `rls`
block; the full field schema was re-sent so field definitions were preserved.
