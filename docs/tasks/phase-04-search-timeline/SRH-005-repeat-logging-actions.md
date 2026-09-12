# SRH-005: Repeat Logging and Copy-Yesterday Actions

Status: unstarted
Phase: 4 - Search, repeat logging, and timeline
Depends on: SRH-004, FND-003
Parallel-safe with: TLN-001
Conflicts likely in: Food tab actions, operation handlers, backup tests
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 4; docs/planning/03_REQUIREMENTS_TRACEABILITY.md row 34
ADR links: docs/adr/ADR-012-undo-operations.md

## Outcome
Users can quickly repeat a previous item, saved meal, usual meal, or yesterday's meal group into the selected day with undo.

## Why now
Repeat logging is the first user-facing speed feature built on the structured shortcut and operation foundations.

## In scope
- Implement repeat operations for one item, one meal group, and copy-yesterday.
- Preserve immutable nutrition snapshots and portion provenance.
- Add clear conflict behavior when a target day already has entries.

## Out of scope
- Meal scheduling.
- Cloud sharing.
- AI-generated repeats.

## Files expected to change
- Existing: Food tab logging actions, operation handlers, meal log tests.
- Proposed: repeat logging fixtures.

## Data/migration impact
- No new schema expected beyond SRH-004.
- Backup unchanged except repeated entries must round-trip normally.
- Rollback disables repeat buttons and leaves operation history intact.

## Implementation contract
- Repeat creates new records with new UUIDs and copied source snapshots.
- Copy-yesterday must preserve meal labels but set timestamps to the target day.
- Every repeat operation must be undoable as one atomic operation.

## Acceptance criteria
- Given yesterday has breakfast and dinner, when copy-yesterday runs, then both groups are copied to today with today's dates.
- Given an item is repeated, when undo runs, then only that newly created repeat is removed.
- Given a repeated recipe has an old recipe version, then the log preserves the original snapshot.

## Tests required
- Unit tests for timestamp remapping and UUID creation.
- Integration tests for atomic undo.
- UI tests for confirmation and empty-yesterday states.

## Commands
- `npm run test -- --run repeat-logging`
- `npm run typecheck`
- `npm run check`

## Manual verification
- Copy yesterday, repeat a single food, repeat a usual meal, then undo each on Android.

## Risks and rollback
- Risk: accidental duplicate logs. Use confirmation for large copy actions and clear undo affordance.
- Rollback by hiding copy controls and retaining saved shortcut state.

## Completion update
- Mark SRH-005 complete here and in TASK_INDEX.md.
- Update PLAN.md if TLN-002 becomes the next ready timeline task.
