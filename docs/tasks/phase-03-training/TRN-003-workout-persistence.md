# TRN-003: Active Workout Persistence and Recovery

Status: complete
Phase: 3 - Training
Depends on: TRN-002
Parallel-safe with: TLN-002, TRN-006
Conflicts likely in: active workout state, autosave, recovery UI
Requirement links: docs/planning/11_TRAINING_ENGINE.md; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 14, 20, 42
ADR links: docs/adr/ADR-009-training-domain.md

## Outcome
Active workouts survive navigation, backgrounding, process death, and restart with recovery UI.

## Why now
A workout journal exists; it must become reliable before timeline mini-card and live controls.

## In scope
- Add autosave granularity; restore active session; add recovery conflict states; test process-death behavior.

## Out of scope
- Android notification controls; routines/programs; sync.

## Files expected to change
- Existing: workout core, mobile state management. Proposed: active session persistence tests.

## Data/migration impact
- Active session state must be durable or reconstructable. Backup excludes transient timers but preserves workout data.

## Implementation contract
- Persist after meaningful set/exercise/timer changes. Recovery must never duplicate completed workouts.

## Acceptance criteria
- Given process death during active workout, when app restarts, then recovery resumes correct session.

## Tests required
- Unit tests for autosave; integration tests for recovery; manual Android kill/restart test.

## Commands
- `npm run test -- --run active-workout`
- `npm run check`

## Manual verification
- Start workout, log sets, kill app, restart, and verify recovery.

## Risks and rollback
- Risk: corrupt active state. Use validation and safe recovery prompts.

## Completion update
- Mark TRN-003 complete here and in TASK_INDEX.md.
- Update PLAN.md, linked planning docs, and any release/checklist evidence touched by the task.
