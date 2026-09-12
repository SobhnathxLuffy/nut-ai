# HLT-002: Android Health Connect Adapter

Status: unstarted
Phase: 8 - Reports, micronutrients, and health adapters
Depends on: HLT-001
Parallel-safe with: HLT-003 only after contract freeze
Conflicts likely in: Android native permissions, Expo config, health settings
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 16; docs/planning/03_REQUIREMENTS_TRACEABILITY.md row 28
ADR links: docs/adr/ADR-016-health-adapters.md

## Outcome
Android users can import and export approved Health Connect data through the shared health adapter contract.

## Why now
The cross-platform contract is stable and Android is the primary production target.

## In scope
- Add Health Connect availability and permission flow.
- Import weight/body/workout samples selected by policy.
- Export Nut AI summaries where user explicitly grants permission.

## Out of scope
- iOS HealthKit.
- Smartwatch app.
- GPS running tracker replacement.

## Files expected to change
- Existing: apps/mobile Android config, settings screens.
- Proposed: Android health adapter module and tests.

## Data/migration impact
- Stores external sample IDs and provenance where needed.
- Backup preserves local links but does not grant permissions on restore.
- Rollback disables Health Connect adapter and keeps local logs.

## Implementation contract
- Runtime handles unavailable app, missing permissions, revoked permissions, and partial grants.
- Imports are idempotent by external sample ID.
- Exports occur only after explicit permission.

## Acceptance criteria
- Given Health Connect unavailable, then settings shows install/help state.
- Given permissions granted, then selected samples import with provenance.
- Given permissions revoked, then sync stops cleanly and local data remains.

## Tests required
- Native-module mock tests.
- Permission-state UI tests.
- Android emulator/manual tests where Health Connect is available.

## Commands
- `npm --prefix apps/mobile run typecheck`
- `npm run test -- --run health-connect`
- `npm run check`

## Manual verification
- On Android, grant, revoke, import, and export supported Health Connect sample types.

## Risks and rollback
- Risk: platform policy changes. Recheck official Health Connect policy before release.
- Rollback by disabling adapter feature flag.

## Completion update
- Mark HLT-002 complete here and in TASK_INDEX.md.
- Update release checklist with Android health compliance steps.
