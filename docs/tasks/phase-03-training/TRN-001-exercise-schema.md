# TRN-001: Exercise and Equipment Schema

Status: complete
Phase: 3 - Training
Depends on: FND-001
Parallel-safe with: TRN-002, EQP-001, SRH-001
Conflicts likely in: schema.ts, migrations, exercise fixtures
Requirement links: docs/planning/11_TRAINING_ENGINE.md; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 11, 12, 15
ADR links: docs/adr/ADR-009-training-domain.md

## Outcome
Training schema supports exercises, tracking types, muscles, equipment requirements, and custom exercise metadata.

## Why now
Workout creation and equipment tools need stable domain tables before UI work.

## In scope
- Add exercise/equipment schema; seed built-in exercise fixtures; add custom exercise validation.

## Out of scope
- Workout session UI; PR engine; plate calculator math.

## Files expected to change
- Existing: schema.ts, migrations, tests. Proposed: exercise fixtures.

## Data/migration impact
- Schema migration adds exercise/equipment foundations. Backup v2 includes user-created exercises.

## Implementation contract
- Tracking type determines valid set fields. Custom exercises have stable UUIDs and aliases.

## Acceptance criteria
- Given each tracking type, then schema accepts valid sets and rejects incompatible fields.

## Tests required
- Schema tests, migration tests, backup tests, fixture validation.

## Commands
- `npm run test -- --run training-schema`
- `npm run check`

## Manual verification
- Inspect seeded and custom exercise records in dev database.

## Risks and rollback
- Risk: schema churn affects later tasks. Keep fields extensible but validated.

## Completion update
- Mark TRN-001 complete here and in TASK_INDEX.md.
- Update PLAN.md, linked planning docs, and any release/checklist evidence touched by the task.
