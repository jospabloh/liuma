# Blocking Incident — OWNER_ACCESS_AND_TENANT_CREATION_BLOCKER

- **ID:** OWNER_ACCESS_AND_TENANT_CREATION_BLOCKER
- **Opened:** 2026-05-18
- **Severity:** Blocker
- **Status:** Open
- **Technical owner:** Platform Engineering Lead
- **Security owner:** Security Engineer
- **Linked areas:** Owner access, tenant provisioning, tenant creation, rollout expansion

## Summary
Owner access and tenant creation are currently blocking post-launch expansion. Remaining post-launch expansion tasks are paused until this incident exits blocker status.

## Impact
- Owner access is not considered reliable enough for expansion operations.
- Tenant creation is not considered reliable enough to onboard additional tenants.
- Any additional rollout wave, tenant cohort increase, or post-launch expansion task remains on hold.

## Active controls while open
1. Pause all remaining post-launch expansion tasks.
2. Allow only fixes required to resolve owner access, tenant creation, or direct blocker validation gaps.
3. Require technical owner and security owner review before closing the incident.
4. Re-run the full end-to-end validation before any expansion task resumes.

## Exit criteria
This incident can close only after all criteria pass with recorded evidence:

1. Owner access fixed.
2. Tenant creation fixed.
3. Full E2E pass.
