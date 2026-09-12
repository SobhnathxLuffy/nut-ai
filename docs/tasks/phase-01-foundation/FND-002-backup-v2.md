# FND-002: Backup Format v2 - Round-Trip All Tables

Status: complete
Phase: 1 - Foundation
Depends on: FND-001
Parallel-safe with: FND-003, SYN-004, REL-004
Conflicts likely in: backup-core.ts, import/export allowlists
Requirement links: docs/planning/08_BACKUP_UNDO_AND_RECOVERY.md; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 4, 26, 40
ADR links: docs/adr/ADR-012-undo-operations.md, docs/adr/ADR-013-sync-architecture.md

## Outcome
Backup v2 exports and imports all user tables in FK-safe order while excluding secrets and transient media.

## Why now
New schema identity must be recoverable before undo, sync, and health integrations add more tables.

## In scope
- Define v2 manifest; include UUID metadata; add import validation; update backup tests.

## Out of scope
- Provider key backup; cloud restore; new feature schema beyond v2 identity.

## Files expected to change
- Existing: backup core/tests, schema docs, fixtures. Proposed: v2 backup fixtures.

## Data/migration impact
- Backup format increments to v2 with backward import for supported v1 data. Rollback keeps v1 importer.

## Implementation contract
- Exports are deterministic, secret-free, and validated before import transaction commit.

## Acceptance criteria
- Given a full database, when exported/imported, then restored records match originals. Given corrupt backup, then no partial import commits.

## Tests required
- Round-trip tests, corrupt backup tests, secret exclusion tests, migration compatibility tests.

## Commands
- `npm run test -- --run backup`
- `npm run check`

## Manual verification
- Export from Android, import into a clean install, and inspect meals/goals/settings.

Completed: automated round-trip, corruption rollback, table completeness, media
path scrubbing, secret exclusion, day-status, operations, and recipe backup
tests pass.

## Risks and rollback
- Risk: partial restore. Use transactions and clear validation errors.

## Completion update
- Mark FND-002 complete here and in TASK_INDEX.md.
- Update PLAN.md, linked planning docs, and any release/checklist evidence touched by the task.
