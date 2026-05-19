# Incident Report — Tenant Creation Failure (2026-05-19)

## Scope
This report documents reproduction evidence for tenant-creation failure handling in the onboarding flow, validation of required bootstrap defaults, and confirmation of post-create provisioning and access behavior.

## Success criteria
1. Reproduce tenant creation failure and capture request/response payload, status, and error code.
2. Validate required fields/defaults used by tenant bootstrap path.
3. Validate post-create provisioning chain (roles/permissions/owner binding/theme).
4. Replace generic unknown mapping with deterministic user-facing error mapping.
5. Re-run tenant creation path with clean data and confirm create + post-create access preconditions.

## Step 1 — Failure reproduction evidence
Reproduced with deterministic duplicate-school backend error fixture in `onboarding-tenant-creation.test.js`:

- Request payload (school create path):
  - `formData.role = "ADMIN"`
  - `formData.newSchoolName = "Colegio Duplicado"`
  - `formData.phone = ""`
  - `formData.isDemo = false`
- Backend failure fixture:
  - `status: 409`
  - `data.code: "duplicate_school"`
  - `data.message: "School already exists"`
- Captured output via `captureOnboardingFailure` path covers:
  - `status`
  - `responseBody`
  - `backendCode`
  - `errorCode`
  - `backendMessage`
  - `correlationId` (when available)

Evidence references:
- Duplicate failure fixture and assertion: `tests/unit/onboarding-tenant-creation.test.js`.
- Failure capture implementation: `src/lib/onboardingTenantCreation.js`.

## Step 2 — Required fields/defaults validation
Validated required fields:
- Admin role requires non-empty `newSchoolName`.
- Non-admin role requires non-empty `schoolCode`.
- User must contain `user.id`.

Validated defaults:
- School payload defaults to `DEFAULT_THEME` when `themePreview` absent.
- Demo tenant creation sets:
  - `is_demo: true`
  - `data_mode: "test-data"`
- User profile payload defaults:
  - Admin => `status: "ACTIVE"`
  - Non-admin => `status: "PENDING"`
  - `onboarding_completed: true`

## Step 3 — Post-create provisioning chain validation
Validated tenant bootstrap chain for newly created admin tenant:
- Required roles created (ADMIN, TEACHER, PARENT) with `is_required: true`.
- Baseline permission templates created per role with `is_baseline: true`.
- Owner/admin access binding created:
  - `binding_key: "tenant_owner_admin"`
  - `role_key: "ADMIN"`
  - `status: "ACTIVE"`
- Trial subscription created.
- Audit hook invoked for school creation.

## Step 4 — Deterministic user-facing error mapping change
Implemented deterministic mapping additions in `mapOnboardingError`:
- `400` / validation-coded backend errors => `validation_error` user message.
- `404` / invalid-school-coded backend errors => `invalid_school_code` user message.
- Existing mappings retained:
  - `401|403` => `forbidden`
  - `409|duplicate patterns` => `duplicate_tenant`

Outcome: reduced fallback to generic `unknown_error` for common onboarding failures.

## Step 5 — Clean-data rerun and post-create access preconditions
Reran onboarding tenant unit coverage including successful admin-create path and bootstrap assertions with fresh in-memory test entities.

Observed pass conditions:
- School created.
- Subscription created.
- Profile created in ACTIVE state for admin.
- Roles/templates/binding provisioned.
- Theme default behavior confirmed.
- First-login tenant selection flow remains passing in broader test run output.

## Verification command + result
- `npm test -- --test tests/unit/onboarding-tenant-creation.test.js`
- Result: pass (76 tests, 0 failures).

## Risk/notes
- Evidence here is deterministic test-fixture based (no live production API call in this run).
- Correlation ID capture is validated when backend exposes `x-correlation-id` or `x-request-id`.
