# EQP-001: Equipment Inventory and Plate Calculator

Status: complete
Phase: 3 - Training
Depends on: TRN-001
Parallel-safe with: TRN-005
Conflicts likely in: equipment package, settings, Train set entry
Requirement links: docs/planning/12_EQUIPMENT_AND_PLATE_LOADING.md; docs/planning/03_REQUIREMENTS_TRACEABILITY.md row 13
ADR links: docs/adr/ADR-009-training-domain.md

## Outcome
Users define equipment inventory and calculate valid symmetric plate loads from owned equipment.

## Why now
Training schema exists; routines and workout set entry need equipment-aware loading.

## In scope
- Implement inventory model/UI; plate calculator algorithm; integrate set-entry helper.

## Out of scope
- Program progression; gym sharing; purchasing suggestions.

## Files expected to change
- Existing: equipment schema, settings, Train UI. Proposed: packages/equipment.

## Data/migration impact
- May add equipment inventory tables. Backup includes inventory. Rollback hides calculator and preserves workouts.

## Implementation contract
- Calculator respects bar/handle weight, per-side symmetry, owned plate counts, and per-hand vs total load.

## Acceptance criteria
- Given plate inventory, then calculator suggests nearest valid load and explains deltas.

## Tests required
- Property tests for plate math; UI tests for inventory and calculator.

## Commands
- `npm run test -- --run equipment`
- `npm run check`

## Manual verification
- Add plates/barbells/dumbbells and verify suggested loads during workout entry.

## Risks and rollback
- Risk: bad plate math can be dangerous. Prefer conservative validation and clear units.

## Completion update
- Mark EQP-001 complete here and in TASK_INDEX.md.
- Update PLAN.md, linked planning docs, and any release/checklist evidence touched by the task.
