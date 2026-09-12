# TRN-005: Routines, Programs, and Progression

Status: complete
Phase: 3 - Training
Depends on: TRN-002, EQP-001
Parallel-safe with: WEB-003, TLN-004
Conflicts likely in: schema.ts, routine/program routes, progression rules
Requirement links: docs/planning/11_TRAINING_ENGINE.md; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 17, 19, 21
ADR links: docs/adr/ADR-009-training-domain.md

## Outcome
Users can create routines and simple programs with transparent progression rules and quick workout launch.

## Why now
Workout execution and equipment are ready; reusable plans complete the core training domain.

## In scope
- Add routines, programs, planned-vs-actual sets, progression rules, and quick launch.

## Out of scope
- AI-generated programs; live Android controls; web implementation.

## Files expected to change
- Existing: training schema/core, Train routes, equipment. Proposed: routine/program fixtures.

## Data/migration impact
- Schema migration for routines/programs if not already present. Backup round-trips templates and schedules.

## Implementation contract
- Progression rules are explicit: double progression, fixed increment, percentage, RIR-based, manual, or program-defined.

## Acceptance criteria
- Given a routine, then user can launch workout with planned values. Given progression rule, then next suggestion is deterministic.

## Tests required
- Schema/migration tests, progression unit tests, UI tests for routine create/launch.

## Commands
- `npm run test -- --run routines`
- `npm run check`

## Manual verification
- Create a routine, run it, finish workout, and verify next suggestion.

## Risks and rollback
- Risk: too broad. Keep first slice to core reusable routines and simple progression.

## Completion update
- Mark TRN-005 complete here and in TASK_INDEX.md.
- Update PLAN.md, linked planning docs, and any release/checklist evidence touched by the task.
