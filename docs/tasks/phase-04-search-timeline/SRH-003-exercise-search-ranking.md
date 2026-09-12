# SRH-003: Exercise Search Ranking and Filters

Status: complete
Phase: 4 - Search, repeat logging, and timeline
Depends on: SRH-001, TRN-002
Parallel-safe with: SRH-002, SRH-004
Conflicts likely in: Train exercise picker and exercise library
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 8, 10; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 12, 35
ADR links: docs/adr/ADR-008-universal-search.md, docs/adr/ADR-009-training-domain.md

## Outcome
Exercise search supports aliases, muscles, equipment, custom exercises, and recent exercise picks through the shared search contract.

## Why now
Routines, quick workouts, and assistant training tools all need the same exercise resolution semantics.

## In scope
- Add exercise-specific filters and ranking weights.
- Support built-in and custom exercise aliases.
- Return previous performance context where available.

## Out of scope
- New progression algorithms.
- Exercise-form analysis.
- Remote exercise catalog sync.

## Files expected to change
- Existing: Train exercise picker, exercise schema exports, training tests.
- Proposed: exercise search fixtures.

## Data/migration impact
- No migration expected if aliases already exist from TRN-001.
- Backup impact limited to any persisted custom aliases.
- Rollback returns Train pickers to direct table queries.

## Implementation contract
- Search results must expose tracking type, primary muscles, equipment requirements, custom/built-in flag, and last-used metadata.
- Equipment filters must use the user's inventory from EQP-001 when available.
- Ranking must avoid hiding custom exercises behind built-ins.

## Acceptance criteria
- Given a custom exercise alias, when searched, then the custom exercise is top-ranked.
- Given an equipment filter, when searched, then incompatible exercises are excluded or clearly disabled.
- Given an active workout, when adding exercise, then search remains usable with large touch targets.

## Tests required
- Unit tests for alias matching, equipment filters, and custom-vs-built-in tie breaks.
- UI tests for Train picker empty and filtered states.
- Node-purity import test for search fixtures.

## Commands
- `npm run typecheck`
- `npm run test -- --run exercise-search`
- `npm run check`

## Manual verification
- Search built-in and custom exercises while creating and editing a workout.
- Verify keyboard, filter, and empty-state behavior on Android.

## Risks and rollback
- Risk: search context slows active workout logging. Use measured limits and defer expensive context.
- Rollback by keeping direct exercise picker path.

## Completion update
- Mark SRH-003 complete here and in TASK_INDEX.md.
- Add any new search fields to package dependency docs.
