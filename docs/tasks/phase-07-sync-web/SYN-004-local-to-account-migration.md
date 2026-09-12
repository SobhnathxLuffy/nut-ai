# SYN-004: Local-to-Account Migration

Status: unstarted
Phase: 7 - Accounts, sync, Supabase, and web
Depends on: SYN-003, FND-002
Parallel-safe with: SYN-005
Conflicts likely in: onboarding, backup/import, sync bootstrap
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 16; docs/planning/03_REQUIREMENTS_TRACEABILITY.md row 26
ADR links: docs/adr/ADR-013-sync-architecture.md

## Outcome
A local-only user can attach an account and migrate existing local data into sync without duplication or data loss.

## Why now
Sync exists, but the product promise requires a safe path from no-account use to optional account use.

## In scope
- Add migration preflight checks and backup prompt.
- Assign remote ownership to existing syncable records.
- Resume sync from a known checkpoint.

## Out of scope
- Multi-account merge.
- Production deployment automation.
- Web UI beyond sync bootstrap contract.

## Files expected to change
- Existing: onboarding/account settings, backup flow, sync engine.
- Proposed: migration fixtures.

## Data/migration impact
- Migration must be reversible only by restore from backup or explicit account disconnect policy.
- Backup before migration is strongly recommended and tested.
- Rollback restores from preflight backup.

## Implementation contract
- Migration is explicit and cannot start silently on sign-in.
- All migrated records retain original UUIDs and local timestamps.
- Failures produce resumable or rollback-safe states.

## Acceptance criteria
- Given local records, when migration completes, then remote contains one row per syncable local record.
- Given migration interruption, then rerun resumes without duplicates.
- Given user cancels preflight, then no account ownership is written.

## Tests required
- Integration tests for complete, cancelled, interrupted, and retried migrations.
- Backup restore regression test.
- UI tests for preflight and progress states.

## Commands
- `npm run test -- --run account-migration`
- `npm run check`

## Manual verification
- Use a populated local profile, attach an account, interrupt once, resume, and verify no duplicates.

## Risks and rollback
- Risk: ownership mistakes are hard to unwind. Require backup and dry-run summary.
- Rollback through verified backup restore.

## Completion update
- Mark SYN-004 complete here and in TASK_INDEX.md.
- Update sync docs with actual migration states.
