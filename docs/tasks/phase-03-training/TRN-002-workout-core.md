# TRN-002: Minimal Offline Workout Creation

Status: complete
Phase: 3 - Training
Depends on: TRN-001
Parallel-safe with: TRN-003, TRN-004, TRN-005, SRH-003
Conflicts likely in: training core, Train routes, workout persistence
Requirement links: docs/planning/11_TRAINING_ENGINE.md; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 11, 14, 20
ADR links: docs/adr/ADR-009-training-domain.md

## Outcome
Users can create, perform, finish, and reopen offline workouts with custom exercises and logged sets.

## Why now
Schema exists; the first training UX must establish the real workout journal before advanced routines.

## In scope
- Implement Train route basics; create workout; add exercises/sets; finish/reopen history; tests.

## Out of scope
- Programs; PR graphs; Android live controls; sync.

## Files expected to change
- Existing: mobile navigation, training schema. Proposed: training core package/components.

## Data/migration impact
- May add workout/session tables if not in TRN-001. Backup includes workouts and sets.

## Implementation contract
- Workout actions are offline and operation-backed where available. Invalid set fields are blocked by tracking type.

## Acceptance criteria
- Given no network, then user can complete and view a workout. Given custom exercise, then it can be used in a workout.

## Tests required
- Unit tests for workout state; UI tests for create/finish/reopen; backup tests.

## Commands
- `npm run test -- --run workout`
- `npm --prefix apps/mobile run typecheck`
- `npm run check`

## Manual verification
- On Android, create a workout, add sets, finish, and reopen history offline.

## Risks and rollback
- Risk: too much UI scope. Keep minimal journal focused.

## Completion update
- Mark TRN-002 complete here and in TASK_INDEX.md.
- Update PLAN.md, linked planning docs, and any release/checklist evidence touched by the task.
