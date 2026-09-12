# HLT-001: Health Adapter Contract and Permission Model

Status: unstarted
Phase: 8 - Reports, micronutrients, and health adapters
Depends on: FND-001, ADP-001
Parallel-safe with: NUT-003
Conflicts likely in: health contracts, settings permissions, data model
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 11, 16; docs/planning/03_REQUIREMENTS_TRACEABILITY.md row 28
ADR links: docs/adr/ADR-016-health-adapters.md

## Outcome
Health Connect and HealthKit share one adapter contract for permissions, imported samples, exported samples, provenance, and conflict behavior.

## Why now
Reports and day status are ready; platform-specific adapters need a stable boundary before native implementation.

## In scope
- Define sample types for weight, body measurements, workouts, nutrition summaries, and permissions.
- Specify read/write directions and provenance tags.
- Add settings states for unavailable, denied, partial, and granted permissions.

## Out of scope
- Android or iOS native adapter code.
- Wearable app support.
- Medical advice.

## Files expected to change
- Existing: domain schema contracts, settings docs.
- Proposed: packages/health-adapters contract.

## Data/migration impact
- May add external sample identity/provenance fields.
- Backup must preserve user-authored data and health-link metadata safely.
- Rollback disables health integrations.

## Implementation contract
- Imported health data is tagged by source and can be disconnected without deleting user-authored logs.
- Exported data is idempotent and traceable.
- Permission denial keeps the app fully usable.

## Acceptance criteria
- Given denied permissions, then the settings UI shows a recoverable denied state.
- Given imported weight samples, then provenance is distinguishable from manual weigh-ins.
- Given export retries, then duplicate health samples are not created.

## Tests required
- Contract tests for permission states and sample mapping.
- Idempotency tests for external IDs.
- Backup tests for health-link metadata.

## Commands
- `npm run test -- --run health-adapters`
- `npm run typecheck`
- `npm run check`

## Manual verification
- Use mocked adapter states to inspect unavailable, denied, partial, and granted UI.

## Risks and rollback
- Risk: platform APIs diverge. Keep contract lowest-common-core with adapter-specific extensions.
- Rollback by hiding health settings.

## Completion update
- Mark HLT-001 complete here and in TASK_INDEX.md.
- Update docs/planning/16_PRIVACY_SECURITY_AND_SAFETY.md with permission wording.
