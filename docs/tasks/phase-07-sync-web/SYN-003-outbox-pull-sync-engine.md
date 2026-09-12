# SYN-003: Outbox and Pull Sync Engine

Status: unstarted
Phase: 7 - Accounts, sync, Supabase, and web
Depends on: SYN-002, FND-003
Parallel-safe with: None
Conflicts likely in: operations core, sync engine, database adapters
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 16; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 26, 40
ADR links: docs/adr/ADR-013-sync-architecture.md, docs/adr/ADR-012-undo-operations.md

## Outcome
Local operations enqueue idempotent sync work and pull remote changes without requiring constant connectivity.

## Why now
Account and remote schema contracts exist; the app needs the engine that keeps local-first data convergent.

## In scope
- Implement outbox entries, idempotency keys, push, pull, and checkpoint logic.
- Handle offline, retryable, and permanent sync errors.
- Keep sync side effects isolated from domain packages.

## Out of scope
- Conflict UI beyond typed conflict output.
- Photo object upload lifecycle.
- Web adoption.

## Files expected to change
- Existing: operation handlers, database adapters, sync contracts.
- Proposed: packages/sync-engine.

## Data/migration impact
- Adds outbox/checkpoint tables if not present.
- Backup may include pending outbox only if it can resume safely after restore.
- Rollback pauses sync and leaves local operations authoritative.

## Implementation contract
- Every remote mutation uses idempotency derived from operation ID.
- Pull applies remote changes through the same validation layer as local imports.
- Sync never blocks local logging.

## Acceptance criteria
- Given offline mutations, when network returns, then queued operations push once.
- Given duplicate push retry, then remote state is not duplicated.
- Given invalid remote data, then sync quarantines the row and keeps local app usable.

## Tests required
- Unit tests for checkpoint and idempotency logic.
- Integration tests with mocked Supabase.
- Offline/online retry tests.

## Commands
- `npm run test -- --run sync-engine`
- `npm run typecheck`
- `npm run check`

## Manual verification
- Create local data offline, sign in, reconnect, and verify remote rows and local usability.

## Risks and rollback
- Risk: sync bugs corrupt user data. Keep backup/export path independent and require recovery tests.
- Rollback by disabling sync scheduler and preserving outbox rows.

## Completion update
- Mark SYN-003 complete here and in TASK_INDEX.md.
- Update PLAN.md when SYN-004 or WEB-002 becomes ready.
