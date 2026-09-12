# REL-004: Backup Recovery Disaster Drill

Status: unstarted
Phase: 11 - Accessibility, security, performance, and release
Depends on: SYN-006, FND-002
Parallel-safe with: REL-005
Conflicts likely in: backup/import, sync recovery, migration docs
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 16; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 26, 40
ADR links: docs/adr/ADR-012-undo-operations.md, docs/adr/ADR-013-sync-architecture.md

## Outcome
Backup, restore, local-to-account migration, sync recovery, and disaster scenarios are drilled and documented before beta release.

## Why now
All data-bearing features are present; recovery guarantees must be verified against the full schema and sync model.

## In scope
- Execute backup/restore scenarios across local-only, account, pending outbox, conflicts, photos, and health links.
- Fix gaps found by the drill.
- Document user-safe recovery steps.

## Out of scope
- New backup format features unless required to fix drill failures.
- Production incident response automation.
- Store submission.

## Files expected to change
- Existing: backup/import tests, sync recovery code, docs.
- Proposed: disaster drill report fixtures.

## Data/migration impact
- May patch backup v2 allowlists and migrations.
- Must preserve backward import compatibility where promised.
- Rollback uses known-good backup format and disables unsafe restore paths.

## Implementation contract
- Restore never imports provider keys.
- Restored account data must not duplicate remote rows after sync resumes.
- Corrupt backups fail safely with actionable errors.

## Acceptance criteria
- Given a full local backup, then restore recreates meals, workouts, recipes, goals, and settings.
- Given pending sync outbox, then restore/resume behavior matches documented policy.
- Given corrupt backup, then no partial unsafe restore is committed.

## Tests required
- End-to-end backup/restore tests.
- Sync resume after restore tests.
- Corrupt and old-version backup tests.

## Commands
- `npm run test -- --run backup`
- `npm run test -- --run sync`
- `npm run check`

## Manual verification
- Perform backup and restore on Android with local-only and signed-in profiles.

## Risks and rollback
- Risk: recovery bugs destroy trust. Block release on unresolved data-loss scenarios.
- Rollback by disabling affected import/sync paths.

## Completion update
- Mark REL-004 complete here and in TASK_INDEX.md.
- Update docs/templates/RELEASE_CHECKLIST.md with drill evidence.
