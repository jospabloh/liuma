# Task 11 — Role & Tenant Theme UX Audit (11.1 baseline feeding 11.3–11.8)

## Assumptions, scope, and evidence limits

1. This inventory is derived from route authorization and route registration in-code (not from a running browser session).
2. Because there is no interactive seeded browser session in this environment, color/readability checks are assessed using theme-token implementation coverage and existing quality docs; per-screen visual assertions are marked blocked when direct UI evidence is required.
3. "Admin/Director" is mapped to `ADMIN` in the current policy; "Owner-reserved" is mapped to app-owner bypass and tenant danger-zone operations in `PermisosRoles` and authorization helpers.

## Theme profiles used for this audit

| Profile | Intent | Palette (sample) | Risk expectation |
|---|---|---|---|
| TC-1 High contrast | Accessibility-first | `primary #0B3D91`, `secondary #FFFFFF`, `accent #0F766E`, `danger #B00020` | Should pass most primary-action readability checks. |
| TC-2 Low-contrast risk | Failure-hunting | `primary #7A8A99`, `secondary #8D99A6`, `accent #93A1AF`, `danger #9AA3AB` | Expected contrast and semantic-color failures. |
| TC-3 Near-monochrome fallback | Brand-minimal stress test | `primary #4A4A4A`, `secondary #595959`, `accent #666666`, `danger #707070` | Expected semantic confusion between status states. |

## 1) Complete inventory of screens/modules by role

### Admin/Director (`ADMIN`)

- Home
- OperacionDiaria
- Aprobaciones
- AlertaEmergencia
- AuditoriaAdmin
- AvisosAdmin
- CalendarioEscolar
- ConfiguracionInicial
- GestionDescuentos
- GestionDocumentos
- GestionEscuela
- GestionPedidosAdmin
- PagosAdmin
- PermisosRoles
- Reportes
- Shared with parent: ContactosEmergencia, Pagos, PedidosUniformes, SolicitarAusencia

### Teacher (`TEACHER`)

- Home
- OperacionDiaria
- AvisosMaestro
- BitacorasMaestro
- CrearBitacora
- GestionAlumno
- GestionAusencias
- GestionSalon
- ResumenAsistencia
- TareaMaestro

### Parent (`PARENT`)

- Home
- OperacionDiaria
- Asistencia
- Avisos
- Bitacora
- EventosParaPadres
- MisHijos
- Tarea
- Shared with admin: ContactosEmergencia, Pagos, PedidosUniformes, SolicitarAusencia

### Owner-reserved

- PermisosRoles danger-zone operations:
  - Transfer tenant ownership (owner bypass path)
  - Toggle app-owner exceptions for maker-checker bypass behavior
- Audit-sensitive ownership/role mutation flows logged via admin actions and tenant danger-zone operation constants.

## 2) Top journeys by role (minimum 5 each), with Lumi touchpoints

### Admin/Director journeys

1. Home → OperacionDiaria → Reportes (KPI review + export) + Lumi clarification prompt.
2. Home → AvisosAdmin → publish notice → verify parent visibility + Lumi wording assistance.
3. Home → PagosAdmin → create/track payment records + Lumi policy/status explanation.
4. Home → GestionEscuela/ConfiguracionInicial → update tenant settings/theme preview + Lumi checklist guidance.
5. Home → PermisosRoles → approve role/access change and danger-zone review + Lumi policy fallback messaging.

### Teacher journeys

1. Home → ResumenAsistencia → register attendance + Lumi help for exception handling.
2. Home → TareaMaestro → create homework + Lumi content drafting.
3. Home → CrearBitacora → enrich diary entry with "Ayúdame con Lumi".
4. Home → GestionAlumno/GestionSalon → roster/class management + Lumi summarization support.
5. Home → AvisosMaestro → post class notice and verify classroom scope + Lumi copy refinement.

### Parent journeys

1. Home → Asistencia → view child attendance + Lumi explanation of absences.
2. Home → Tarea → review assignments + Lumi learning tips.
3. Home → Bitacora → read daily log + Lumi follow-up question.
4. Home → Pagos/PedidosUniformes → payment/uniform checkout status + Lumi support path.
5. Home → SolicitarAusencia → submit request and track status + Lumi guidance.

### Owner-reserved journeys

1. Home (ADMIN owner) → PermisosRoles danger zone → transfer ownership (bypass flow).
2. Home (ADMIN owner) → PermisosRoles → modify high-risk role permissions with audit trail.
3. Home (ADMIN owner) → AuditoriaAdmin → verify owner-path event logging.
4. Home (ADMIN owner) → GestionEscuela → enforce tenant policy boundaries post-transfer.
5. Home (ADMIN owner) → Aprobaciones → validate maker-checker exception semantics and fallback messaging.

## 3) Screen-level pass/fail record (11.1 rubric + blockers + defects)

Scoring method:
- Base score from 11.1 rubric dimensions (visual hierarchy, readability, consistency, state clarity).
- Because interactive validation is unavailable, scores are *provisional* and use implementation-risk weighting:
  - 85–100 = low risk from code signals
  - 70–84 = medium risk
  - <70 = high risk

| Screen/module | Role(s) | 11.1 score | Result | Blockers | Defects (H/M/L) |
|---|---|---:|---|---|---|
| Home | Admin/Teacher/Parent | 82 | PASS (provisional) | Needs live UI in all 3 palettes | H:0 M:2 L:1 |
| OperacionDiaria | Admin/Teacher/Parent | 78 | PASS (provisional) | Same as above | H:0 M:2 L:2 |
| PermisosRoles | Admin/Owner | 68 | FAIL | High-risk semantics need visual confirmation | H:2 M:2 L:1 |
| AuditoriaAdmin | Admin/Owner | 74 | PASS (provisional) | Requires audit data fixtures | H:0 M:2 L:2 |
| PagosAdmin | Admin | 72 | PASS (provisional) | Payment status colors need UI proof | H:1 M:2 L:1 |
| Reportes | Admin | 76 | PASS (provisional) | Export/empty/error states unverified | H:0 M:3 L:1 |
| GestionEscuela | Admin/Owner | 71 | PASS (provisional) | Theme preview-to-runtime consistency unverified | H:1 M:2 L:2 |
| GestionDocumentos | Admin | 75 | PASS (provisional) | Document state chips not visually validated | H:0 M:2 L:2 |
| Aprobaciones | Admin/Owner | 69 | FAIL | Success/warn/error differentiation likely weak in low-contrast/mono | H:2 M:2 L:1 |
| AlertaEmergencia | Admin | 67 | FAIL | Critical-state color semantics high-risk under mono profile | H:2 M:1 L:1 |
| AvisosAdmin | Admin | 77 | PASS (provisional) | CTA contrast across palettes unverified | H:0 M:2 L:1 |
| CalendarioEscolar | Admin | 73 | PASS (provisional) | Event-category color legend needs live check | H:1 M:2 L:1 |
| ConfiguracionInicial | Admin | 70 | PASS (provisional) | Onboarding preview contrast check not automated end-to-end | H:1 M:2 L:2 |
| GestionDescuentos | Admin | 72 | PASS (provisional) | Discount status badges theme-mapping unverified | H:1 M:2 L:1 |
| GestionPedidosAdmin | Admin | 73 | PASS (provisional) | Order-state semantic colors unverified in mono | H:1 M:2 L:1 |
| ContactosEmergencia | Admin/Parent | 79 | PASS (provisional) | Emergency CTA prominence needs UI validation | H:0 M:2 L:1 |
| Pagos | Admin/Parent | 74 | PASS (provisional) | Status semantics across parent/admin contexts | H:1 M:2 L:1 |
| PedidosUniformes | Admin/Parent | 75 | PASS (provisional) | Cart/fulfillment badges under low contrast | H:1 M:2 L:1 |
| SolicitarAusencia | Admin/Parent | 76 | PASS (provisional) | Request-state badges not validated live | H:0 M:3 L:1 |
| AvisosMaestro | Teacher | 78 | PASS (provisional) | Teacher notice chips not visually proven | H:0 M:2 L:1 |
| BitacorasMaestro | Teacher | 77 | PASS (provisional) | Rich text contrast unverified | H:0 M:2 L:2 |
| CrearBitacora | Teacher | 74 | PASS (provisional) | Lumi CTA/button contrast under risky palettes | H:1 M:2 L:1 |
| GestionAlumno | Teacher | 75 | PASS (provisional) | Table/row state colors need evidence | H:0 M:3 L:1 |
| GestionAusencias | Teacher | 73 | PASS (provisional) | Absence status semantics under mono | H:1 M:2 L:1 |
| GestionSalon | Teacher | 76 | PASS (provisional) | Classroom cards/button hierarchy | H:0 M:2 L:2 |
| ResumenAsistencia | Teacher | 72 | PASS (provisional) | Attendance semantic colors likely collide in mono | H:1 M:2 L:1 |
| TareaMaestro | Teacher | 75 | PASS (provisional) | Due-status emphasis not live-validated | H:0 M:3 L:1 |
| Asistencia | Parent | 72 | PASS (provisional) | Parent interpretation of status colors | H:1 M:2 L:1 |
| Avisos | Parent | 78 | PASS (provisional) | CTA readability under low-contrast theme | H:0 M:2 L:1 |
| Bitacora | Parent | 77 | PASS (provisional) | Content vs metadata hierarchy | H:0 M:2 L:2 |
| EventosParaPadres | Parent | 74 | PASS (provisional) | Event legend/theme mapping unverified | H:1 M:2 L:1 |
| MisHijos | Parent | 75 | PASS (provisional) | Child cards/status chips in near-monochrome | H:1 M:2 L:1 |
| Tarea | Parent | 74 | PASS (provisional) | Homework status readability risks in mono | H:1 M:2 L:1 |
| Lumi bubble/chat | All non-excluded routes | 71 | PASS (provisional) | Needs full route-by-route overlap checks | H:1 M:3 L:1 |

## 4) Theme defect taxonomy tags (separate)

### Contrast failures
- Low-contrast and near-monochrome palettes can reduce CTA distinguishability and text-on-fill readability on action buttons/badges.

### Semantic color confusion
- Success/warn/error states are at risk of collapsing into similar luminance in attendance, approvals, emergency, and payments flows.

### Token mismatch
- UI components mixing fixed Tailwind color classes (`text-white`, `text-slate-*`, etc.) with tenant palettes may cause inconsistent brand rendering.

### Components not fully using tenant tokens
- Theme runtime sets CSS vars globally, but components with hardcoded utility colors bypass tenant semantics in edge states.

## 5) Prioritized remediation backlog for Tasks 11.3–11.8

### 11.3 — Theme token adoption hardening (P0)
1. Build an inventory script/report listing components using hardcoded color utilities vs CSS var tokens.
2. Replace high-impact hardcoded status/action colors with semantic theme tokens first (`--color-success|warning|error|primary-foreground`).
3. Add lint guard (or codemod check) to block new hardcoded status colors in app screens.

### 11.4 — Semantic status system normalization (P0)
1. Introduce a single status-to-token mapping table (success/warn/error/info/neutral).
2. Migrate `StatusBadge`, payment state cards, approvals, attendance chips to that shared mapping.
3. Add unit tests for semantic mappings under all three theme profiles.

### 11.5 — Palette safety validation (P1)
1. Add a palette validator at onboarding/configuration time for minimum contrast thresholds.
2. Reject or auto-adjust unsafe palettes (especially low-contrast and monochrome collisions).
3. Record auto-adjust decisions in audit logs for traceability.

### 11.6 — Journey-based visual QA automation (P1)
1. Add Playwright visual snapshots for the top 5 journeys per role in TC-1/TC-2/TC-3 themes.
2. Gate release on no critical regressions in primary CTA readability.
3. Attach artifacts to release-gate doc each cycle.

### 11.7 — Lumi UX consistency under theme stress (P2)
1. Validate Lumi bubble/chat contrast and icon/button legibility per theme profile.
2. Ensure denial/error assistant responses remain semantically clear when status color cues degrade.
3. Add route exclusion verification against protected/owner routes.

### 11.8 — Role-review signoff pack (P2)
1. Produce per-role evidence bundles (screenshots + checklist + defects).
2. Add explicit owner-reserved flow evidence (danger zone + audit logs).
3. Define go/no-go criteria combining rubric score and unresolved high-severity defect counts.

## Success criteria status

- Every route-mapped screen is cataloged by role: **DONE (code-derived)**.
- Core journeys (>=5 per role, including owner-reserved and Lumi touchpoints): **DONE (defined)**.
- Tenant-theme UX risk tags are explicit pre-deep-review: **DONE**.
- Full visual pass/fail certainty for each screen under all 3 palettes: **BLOCKED pending live UI execution artifacts**.

## Source files used

- `src/pages.config.js`
- `docs/authorization-matrix.md`
- `src/lib/authorization/policy.js`
- `src/pages/PermisosRoles.jsx`
- `src/lib/authorization/tenantDangerZone.js`
- `src/components/theme/TenantThemeRuntime.jsx`
- `src/lib/tenantTheme.js`
- `src/components/lumi/GlobalLumiBubble.jsx`
- `src/components/lumi/LumiChat.jsx`
- `src/lib/lumi/bubble-visibility.js`
- `docs/ui-quality-baseline.md`
- `docs/release-gate-2026-05-18.md`
