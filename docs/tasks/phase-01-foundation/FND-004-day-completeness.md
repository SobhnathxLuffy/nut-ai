# FND-004: Day Completeness Storage Foundation

Status: complete
Phase: 1 - Foundation
Depends on: FND-001
Parallel-safe with: ADP-001
Conflicts likely in: schema.ts, goals/day status storage
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 11; docs/planning/03_REQUIREMENTS_TRACEABILITY.md row 33
ADR links: docs/adr/ADR-017-units-and-dates.md

## Outcome
The database can store explicit day completeness status and provenance without yet changing analytics behavior.

## Why now
Adaptive logic later needs durable status, but storage should land before UI/report calculations.

## In scope
- Add day status enum/table; add migrations; add backup round-trip; expose read/write helpers.

## Out of scope
- Analytics exclusion rules; timeline UI; weekly check-ins.

## Files expected to change
- Existing: schema.ts, migrations, goals tests. Proposed: day status fixtures.

## Data/migration impact
- Schema migration adds day status storage. Backup v2 includes statuses. Rollback treats missing status as UNKNOWN.

## Implementation contract
- Valid statuses are COMPLETE, PARTIAL, UNKNOWN, FASTING with actor/timestamp provenance.

## Acceptance criteria
- Given a day status write, when app restarts, then status persists. Given backup restore, then status survives.

## Tests required
- Migration tests, enum validation tests, backup tests.

## Commands
- `npm run test -- --run day-completeness`
- `npm run check`

## Manual verification
- Set statuses via test/debug helper and inspect database after restart.

Completed: storage helpers, enum validation, database constraints,
process-reopen persistence, backup round-trip, and Android app-private database
inspection through schema v9 pass.

## Risks and rollback
- Risk: premature analytics changes. Keep this task storage-only.

## Completion update
- Mark FND-004 complete here and in TASK_INDEX.md.
- Update PLAN.md, linked planning docs, and any release/checklist evidence touched by the task.
