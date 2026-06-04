# RLS Hardening — 2026-06-04

Source: Base44 Security Scan ("Seguridad" dashboard). This document records the
row-level security (RLS) rule changes applied to the Base44 entity schemas for
app `696e967c430ceb6a2232ffd8` (LIUMA), plus the status of the two HTTP security
header recommendations.

> RLS rules live in the Base44 backend (entity schemas), not in repository files.
> They were updated through the Base44 entity-schema API. This document is the
> repo-side record of those changes for traceability.

## RLS fixes applied (9 critical issues)

All rule conditions remain scoped to the authenticated user's `school_id`
(tenant isolation). Roles are read from `user.data.app_role`
(`ADMIN` / `TEACHER` / `PARENT`).

| Entity | Operation | Change |
|---|---|---|
| **AuditLog** | `create` | Restricted to `ADMIN` and `TEACHER` within their own school (previously any authenticated user in the school could create audit rows). `read` stays admin-only; `update`/`delete` remain disabled. |
| **ChargeItem** | `read` | Removed the unscoped `app_role == PARENT` branch that let any parent read every charge in the school. Parents now read only charges for their linked students (`student_id ∈ linked_student_ids`) inside their school, with explicit role validation. |
| **Classroom** | `read` | Added explicit `school_id` + role validation to the teacher and parent branches. Teachers read only assigned classrooms; parents read only their children's classrooms. |
| **Event** | `read` | Added a parent branch so parents can read `CLASSROOM`-scoped events for their children's classrooms (`linked_student_classroom_ids`), alongside school-wide events and teachers' assigned classrooms. |
| **Notice** | `read` | Rebuilt with explicit per-role branches. Teachers read school notices + their assigned-classroom notices; parents read school notices + their children's classroom notices. Removed the role-agnostic `SCHOOL` branch. |
| **School** | `create` | Removed the RLS create rule (set to `null`). School creation is handled by the onboarding/tenant-creation backend flow, where the user does not yet have an `ADMIN` role or `school_id`, so the old rule blocked legitimate onboarding. `read`/`update` unchanged. |
| **SchoolSubscription** | `create`, `read` | Removed the create rule (`null`) to unblock onboarding. Restricted `read` to school admins only (`school_id` match + `app_role == ADMIN`); removed the branch that let any member of the school read the subscription. |
| **Student** | `read` | Added explicit role validation to the teacher and parent branches (teacher → assigned classrooms; parent → linked students), each scoped to `school_id`. |
| **UserProfile** | `read` | Restricted reads to the user's own profile and to school admins (`school_id` match + `app_role == ADMIN`). Removed the malformed teacher branch (`user_condition: {$in: ["TEACHER"]}`) that effectively exposed all profiles in the school. |

### Verification

Each update was confirmed by the Base44 schema API returning the persisted `rls`
block. Entity field definitions were preserved (the full schema was re-sent on
each update, not just the `rls` block).

## HTTP security headers (2 recommendations) — host-level, not app code

The two header recommendations cannot be fixed from repository code or via the
available MCP tooling, because LIUMA is served as a static SPA from Base44
hosting (`*.base44.app`) — there is no Vercel project for this app, and
`X-Frame-Options` / `Permissions-Policy` cannot be set through `<meta>` tags
(browsers ignore both when delivered that way). They must be configured at the
hosting/edge layer.

| Header | Recommended value | Purpose |
|---|---|---|
| `X-Frame-Options` | `DENY` (or `SAMEORIGIN`) | Block clickjacking on auth and payment pages by preventing iframe embedding. Equivalent modern control: CSP `frame-ancestors 'none'`. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | Deny browser feature APIs the app does not use (free hardening). |

**Action required:** apply these through the Base44 platform security settings
(the "Corregir" action in the Base44 Seguridad dashboard) or via Base44 support,
since they are edge/hosting configuration outside the app bundle.
