# FND-001: Schema v2 - UUID Identity and Sync Metadata

Status: complete
Phase: 1 - Foundation
Depends on: AUD-001
Parallel-safe with: FND-002, FND-004 after migration review
Conflicts likely in: schema.ts, migrations, seed/test fixtures
Requirement links: docs/planning/07_DATABASE_SCHEMA_AND_MIGRATIONS.md; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 1, 29
ADR links: docs/adr/ADR-004-identity-strategy.md, docs/adr/ADR-013-sync-architecture.md

## Outcome
Local schema gains stable UUID identity and sync metadata without changing visible behavior.

## Why now
Backup, undo, sync, and web depend on stable identifiers before new entities multiply.

## In scope
- Add forward migration; backfill UUIDs; add sync columns; update schema docs and tests.

## Out of scope
- Cloud sync engine; UI redesign; destructive migration reset.

## Files expected to change
- Existing: schema.ts, migrations, db tests, backup fixtures. Proposed: migration v2 fixtures.

## Data/migration impact
- Schema version increments to v2. Backup/import must preserve UUIDs and sync metadata. Rollback uses restore from pre-migration backup.

## Implementation contract
- Integer local IDs may remain internal; UUIDs are external/sync identity. Backfill is deterministic and idempotent.

## Acceptance criteria
- Given existing v1 data, when migration runs, then every syncable row has UUID metadata. Given app restart, then IDs remain stable.

## Tests required
- Migration tests, idempotency tests, backup round-trip, typecheck.

## Commands
- `npm run test -- --run migration`
- `npm run test -- --run backup`
- `npm run check`

## Manual verification
- Upgrade a populated dev database and confirm existing logs still open.

Verified 2026-09-12 on Samsung SM-M146B: the installed debug app upgraded its
app-private database from v1 to v6; foreign-key check was clean and all existing
syncable rows had non-null UUID identity after migration.

## Risks and rollback
- Risk: identity bugs corrupt future sync. Require backup before manual migration and keep migration forward-only.

## Completion update
- Mark FND-001 complete here and in TASK_INDEX.md.
- Update PLAN.md, linked planning docs, and any release/checklist evidence touched by the task.
