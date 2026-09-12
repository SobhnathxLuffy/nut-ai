# FND-003: Structured Operations and Undo Foundation

Status: complete
Phase: 1 - Foundation
Depends on: FND-001
Parallel-safe with: SRH-004, SRH-005, AIP-004, SYN-003
Conflicts likely in: schema.ts, operation handlers, mutation call sites
Requirement links: docs/planning/08_BACKUP_UNDO_AND_RECOVERY.md; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 3, 40
ADR links: docs/adr/ADR-012-undo-operations.md

## Outcome
Mutations flow through structured operations with undo metadata and durable audit records.

## Why now
Repeat logging, assistant writes, sync outbox, and conflict recovery need one mutation contract.

## In scope
- Define operation envelope; implement undo for core create/update/delete; add retention/compaction hooks.

## Out of scope
- AI write tools; remote sync; broad UI redesign.

## Files expected to change
- Existing: mutation helpers, meal/goal handlers, schema. Proposed: packages/operations.

## Data/migration impact
- May add operations table. Backup v2 must include durable operations needed for undo/sync. Rollback disables undo and retains entity rows.

## Implementation contract
- Operations include ID, actor, timestamp, entity refs, before/after payloads, and idempotency material.

## Acceptance criteria
- Given a supported delete, when undo runs, then previous state returns. Given replay, then operations are idempotent.

## Tests required
- Operation unit tests, undo integration tests, backup round-trip tests.

## Commands
- `npm run test -- --run operations`
- `npm run check`

## Manual verification
- Delete/edit a meal in dev UI, undo, restart, and verify state.

Completed: operation unit tests, production-write integration tests,
meal-ledger undo/redo, recipe aggregate undo/redo, idempotency, compaction, and
backup round-trip coverage pass. Android app-private `user.db` inspection
confirmed the operations table survives through schema v9.

## Risks and rollback
- Risk: operation log bloat. Add retention policy and compaction notes.

## Completion update
- Mark FND-003 complete here and in TASK_INDEX.md.
- Update PLAN.md, linked planning docs, and any release/checklist evidence touched by the task.
