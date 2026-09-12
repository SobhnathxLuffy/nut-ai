# HLT-003: iOS HealthKit Adapter

Status: unstarted
Phase: 8 - Reports, micronutrients, and health adapters
Depends on: HLT-001
Parallel-safe with: HLT-002 only after contract freeze
Conflicts likely in: iOS entitlements, Expo config, health settings
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 16; docs/planning/03_REQUIREMENTS_TRACEABILITY.md row 28
ADR links: docs/adr/ADR-016-health-adapters.md

## Outcome
iOS users can import and export approved HealthKit data through the shared health adapter contract.

## Why now
Android health work has a shared contract; iOS support should remain aligned without becoming the primary schedule driver.

## In scope
- Add HealthKit availability, entitlement, and permission flow.
- Import and export sample types supported by HLT-001.
- Handle revoked and partial permissions.

## Out of scope
- Apple Watch app.
- Android Health Connect.
- Store submission itself.

## Files expected to change
- Existing: apps/mobile iOS config, settings screens.
- Proposed: iOS health adapter module and tests.

## Data/migration impact
- Stores external sample IDs and provenance where needed.
- Backup does not preserve permissions or tokens.
- Rollback disables HealthKit adapter and keeps local logs.

## Implementation contract
- HealthKit permissions are requested just-in-time and explained clearly.
- Imports are idempotent by external sample ID.
- Exported samples identify Nut AI as source where platform permits.

## Acceptance criteria
- Given HealthKit unavailable, then settings shows unavailable state.
- Given permissions granted, then selected samples import with provenance.
- Given restore from backup, then permissions must be requested again.

## Tests required
- Native-module mock tests.
- Permission-state UI tests.
- Manual device test on iOS.

## Commands
- `npm --prefix apps/mobile run typecheck`
- `npm run test -- --run healthkit`
- `npm run check`

## Manual verification
- On iOS, grant, revoke, import, and export supported HealthKit sample types.

## Risks and rollback
- Risk: entitlements or policy mismatch blocks release. Keep adapter feature-gated.
- Rollback by disabling HealthKit entry point.

## Completion update
- Mark HLT-003 complete here and in TASK_INDEX.md.
- Update release checklist with iOS health compliance steps.
