# SYN-006: Conflict Resolution and Sync Recovery

Status: unstarted
Phase: 7 - Accounts, sync, Supabase, and web
Depends on: SYN-003, SYN-005
Parallel-safe with: None
Conflicts likely in: sync conflict policy, operations, recovery UI
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 16; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 26, 40
ADR links: docs/adr/ADR-013-sync-architecture.md, docs/adr/ADR-012-undo-operations.md

## Outcome
Sync conflicts resolve by entity-specific policy, surface only actionable conflicts, and provide recovery paths after corruption or interrupted sync.

## Why now
Basic sync and object lifecycle must be hardened before web and release tasks rely on multi-device data.

## In scope
- Implement conflict policies for meals, workouts, goals, recipes, day status, and media refs.
- Add quarantine/retry/recovery states.
- Provide user-visible conflict resolution only where automatic merge is unsafe.

## Out of scope
- Collaborative multi-user editing.
- Production incident tooling.
- Backup disaster drill, which is REL-004.

## Files expected to change
- Existing: sync engine, operation validators, settings/recovery UI.
- Proposed: conflict fixtures.

## Data/migration impact
- May add conflict/quarantine tables.
- Backup must preserve unresolved user-actionable conflicts.
- Rollback pauses sync and preserves local data plus conflict records.

## Implementation contract
- Entity policies match ADR-013.
- Local app remains usable when sync is degraded.
- Conflict resolution is idempotent and auditable.

## Acceptance criteria
- Given concurrent meal edits, then deterministic merge or conflict state matches policy.
- Given invalid remote row, then it is quarantined and does not crash startup.
- Given resolved conflict, then retrying resolution does not duplicate data.

## Tests required
- Conflict fixture tests per entity.
- Corrupt remote row and interrupted sync recovery tests.
- UI tests for user-actionable conflict states.

## Commands
- `npm run test -- --run sync-conflicts`
- `npm run check`

## Manual verification
- Simulate two-device edits for meal, workout, and goal records and inspect conflict behavior.

## Risks and rollback
- Risk: silent bad merges. Prefer explicit conflict over unsafe automatic merge.
- Rollback disables sync scheduler and keeps local-first records usable.

## Completion update
- Mark SYN-006 complete here and in TASK_INDEX.md.
- Update release blockers if unresolved conflict classes remain.
