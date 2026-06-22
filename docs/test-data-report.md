# Test Data — Seeder, Coverage & Pre-Mortem

This document describes the connected, role-isolated **test dataset** for LIUMA:
how it is generated, what it covers, how role isolation is proven, and a
pre-mortem of failure modes with proposed fixes.

---

## 1. Why an in-app seeder (and not direct backend writes)

Base44 "Test Data" is a **platform-managed** mode. Records are tagged with a
system field `is_sample`; when you toggle **Test Data off**, `is_sample:true`
rows disappear. Investigation of the data API surfaced three hard limits:

| Attempt | Result |
|---|---|
| `create_entities` with `is_sample:true` | Platform **overrides to `false`** (lands as LIVE data) |
| `update_entities` `$set is_sample:true` | Reports success but value **stays `false`** |
| Create/modify the built-in `User` entity | **Not permitted** by the API |
| Delete any record | **No delete** operation exists |

**Conclusion:** the only way to produce real test data is to **write through the
app while Test Data mode is ON** — then the platform tags the writes
`is_sample:true` automatically. Hence the in-app seeder below.

> ⚠️ A stray **live** `School` named `Escuela Demo LIUMA (TEST)` was created while
> probing the API (it could not be deleted programmatically). Please remove it
> from **Base44 → Data → School**. It is inert (no children, not linked to any
> account).

---

## 2. How to generate the data

1. In Base44, enable **Advanced Capabilities → Test Data → Enabled**.
   *(With it off, the seeder would write LIVE, non-deletable records.)*
2. Open the app as your **ADMIN/owner** account and navigate to the
   **`SeedTestData`** route (`/SeedTestData`).
3. Click **“Generar datos de prueba.”** It runs once per school and **aborts** if
   a `[TEST]` classroom already exists (records can't be deleted, so no
   duplicates).
4. Review the on-screen report (records per entity, fictitious users, warnings).
5. Toggle Test Data **off** to confirm the data disappears; **on** to bring it
   back.

Architecture (all under `src/lib/testData/`):

- **`blueprint.js`** — pure, deterministic description of the whole graph with
  symbolic refs (`{ ref: 'LOCAL_ID' }`). No side effects.
- **`isolation.js`** — derives per-role scopes (assigned classrooms, linked
  students…) mirroring the RLS rules.
- **`seedTestData.js`** — resolves refs and persists via the app SDK, attempts
  to provision the fictitious users, and reports derived `User.data` scopes.
- **`src/pages/SeedTestData.jsx`** — ADMIN-only UI with safety warnings.

---

## 3. Coverage matrix (all 31 entities)

`School` is reused (your own school, not re-created). `User` is provisioned
separately (see §5). The remaining **30 entities** are seeded:

| Domain | Entities | Roles exercised |
|---|---|---|
| Identity & roles | UserProfile ×8, ParentProfile ×4 | ADMIN, TEACHER, PARENT |
| Structure | Classroom ×3, TeacherClassroom ×3, Student ×6, ParentStudent ×6, EmergencyContact ×6 | all |
| Daily ops / bitácoras | Attendance ×12, Homework ×3, DiaryEntry ×6 | TEACHER → PARENT |
| Communications | Notice ×3, NoticeDelivery ×5, NoticeRead ×1, AbsenceNotification ×1 | ADMIN/TEACHER → PARENT |
| Events | Event ×1, EventResponse ×2 | ADMIN → PARENT |
| Payments | PaymentConcept ×2, Discount ×1, ChargeItem ×6, PaymentRecord ×1 | ADMIN, PARENT |
| Documents & services | OfficialDocument ×2, WeeklyMenu ×1, UniformOrder ×1 | all / PARENT |
| Support | SupportTicket ×1, SupportTicketMessage ×2 | PARENT ↔ ADMIN |
| Governance & billing | AuditLog ×3, SchoolSubscription ×1, SchoolSetupGuide ×3, PendingChange ×1, PermissionOverride ×1 | ADMIN |

Every record is scoped to a single tenant (`school_id → SCHOOL`) and every
foreign key is a symbolic ref validated offline (no dangling references).

---

## 4. Role-isolation model — verified

`tests/integration/test-data-blueprint.test.js` (13 tests) proves the graph is
correctly connected and isolated, against the real RLS semantics:

- **Teachers** see only students in their assigned classrooms:
  - `Laura` → Maternal A + Kínder 1 → {Ana, Benito, Carla, Diego}
  - `Sofía` → Primaria 1A → {Elena, Felipe}
  - the two teachers’ visibility **never overlaps**.
- **Parents** see only their linked children:
  - `Jorge` → {Ana, Benito}; `Patricia` → {Carla}; a parent **cannot** see
    another family’s child or charges.
- **Classroom notices** respect classroom scope (a Maternal notice reaches only
  the Maternal parent); **school** notices reach everyone.
- **Admin/owner** sees all 6 students and all 6 charges.
- Referential integrity, unique local ids, required-field presence, and
  single-tenant scoping are all asserted.

Run: `node --test tests/integration/test-data-blueprint.test.js`

---

## 5. Fictitious users & impersonation

The seeder declares these people (one extra admin, two teachers, four parents),
all with `*.demo@liuma.test` emails so you can impersonate them:

| Name | Email | Role |
|---|---|---|
| Mariana Admin (Demo) | admin2.demo@liuma.test | ADMIN |
| Laura Méndez (Demo) | laura.maestra.demo@liuma.test | TEACHER |
| Sofía Ramírez (Demo) | sofia.maestra.demo@liuma.test | TEACHER |
| Jorge García (Demo) | papa.garcia.demo@liuma.test | PARENT |
| Patricia López (Demo) | mama.lopez.demo@liuma.test | PARENT |
| Raúl Torres (Demo) | papa.torres.demo@liuma.test | PARENT |
| Gabriela Hernández (Demo) | mama.hernandez.demo@liuma.test | PARENT |

The seeder **attempts** to create them via the SDK. If the SDK blocks user
creation (likely — see §6), it uses placeholder ids and lists each as
“crear en Base44.” To make impersonation work, for each:

1. **Invite** the user in Base44 with the exact email above; assign the role.
2. Set their **`UserProfile`** (`school_id`, `app_role`) — the seeder already
   created these; relink `user_id` to the new User id.
3. Set the denormalized **`User.data`** scope fields the RLS keys off — the
   seeder prints the exact values per user, e.g. Laura:
   `assigned_classroom_ids = [<Maternal A id>, <Kínder 1 id>]`;
   Jorge: `linked_student_ids = [<Ana id>, <Benito id>]`,
   `linked_student_classroom_ids = [<Maternal A id>]`.

---

## 6. Pre-mortem (failure modes & proposed fixes)

| # | Failure mode | Likelihood | Impact | Proposed fix |
|---|---|---|---|---|
| 1 | Seeder run with **Test Data OFF** → live, non-deletable records | Medium | High | UI warns prominently; consider a runtime check that reads back the first created record's `is_sample` and **halts** if `false`, surfacing “Enable Test Data first.” |
| 2 | **SDK can’t create Users** → teacher/parent unimpersonatable | High | High | Documented manual invite steps (§5); seeder degrades gracefully to placeholders and still builds the full data graph. |
| 3 | **`User.data` scope not denormalized** → teacher/parent see nothing under RLS even after invite | High | High | Seeder computes and prints exact scope arrays; document applying them. Long-term: a Base44 backend function syncing `User.data` from `TeacherClassroom`/`ParentStudent`. |
| 4 | **Double seeding** creates duplicates (no delete) | Medium | Medium | Guard aborts if a `[TEST]` classroom exists; pass `force=true` only intentionally. |
| 5 | **Partial failure** mid-run (one entity errors) leaves a partial graph | Low | Medium | Each op is try/caught and reported; ops are ordered so parents precede children; re-running is blocked by the guard (clear sample data in Base44, then re-run). |
| 6 | Required-field/enum drift if schemas change | Low | Medium | `ENTITY_REQUIRED_FIELDS` + integrity test fail fast in CI when the blueprint violates a contract. |
| 7 | Seed page reachable in production | Low | Low | Gated to ADMIN via `ROUTE_ACCESS`; it’s not linked from any menu. Optionally gate behind an env flag before GA. |
| 8 | Stray live demo `School` from API probing | Certain (already happened) | Low | Delete it manually in Base44 (see §1). |

---

## 7. Files

- `src/lib/testData/blueprint.js`, `isolation.js`, `seedTestData.js`
- `src/pages/SeedTestData.jsx` (route `SeedTestData`, ADMIN-only)
- `tests/integration/test-data-blueprint.test.js`
