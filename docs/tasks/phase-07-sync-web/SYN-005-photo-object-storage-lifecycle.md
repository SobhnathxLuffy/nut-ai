# SYN-005: Photo Object Storage Lifecycle

Status: unstarted
Phase: 7 - Accounts, sync, Supabase, and web
Depends on: SYN-002, AIP-002
Parallel-safe with: SYN-004
Conflicts likely in: media refs, storage policies, privacy settings
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 15, 16; docs/planning/03_REQUIREMENTS_TRACEABILITY.md row 27
ADR links: docs/adr/ADR-015-photo-storage.md, docs/adr/ADR-013-sync-architecture.md

## Outcome
Optional synced photos use Supabase object storage with explicit retention, ownership, deletion, and metadata rules.

## Why now
Photo analysis privacy exists and sync schema exists; object lifecycle can be added without blocking core text/data sync.

## In scope
- Define storage bucket policy, metadata rows, retention jobs, and delete semantics.
- Upload only sanitized photos.
- Support user choice for no-photo-retention mode.

## Out of scope
- Raw unsanitized photo upload.
- Social sharing.
- Local AI assets.

## Files expected to change
- Proposed: supabase storage policy docs/migrations, media sync adapter.
- Existing: privacy settings, photo metadata model.

## Data/migration impact
- Adds remote object references and local metadata when user opts in.
- Backup includes references only when restorable and safe.
- Rollback disables photo upload and deletes pending object tasks.

## Implementation contract
- Object paths include account ownership and never expose predictable cross-user URLs.
- Deleting a meal/photo tombstones metadata and schedules object deletion.
- Retention policy must be testable without production cron.

## Acceptance criteria
- Given opt-in retention, when a sanitized photo is logged, then object metadata is linked to the meal.
- Given delete, then local and remote references tombstone and object deletion is queued.
- Given retention disabled, then no object upload occurs.

## Tests required
- Unit tests for object path and retention policy.
- Integration tests for upload/delete queue behavior.
- RLS/storage policy tests.

## Commands
- `npm run test -- --run photo-storage`
- `npx supabase db test`
- `npm run check`

## Manual verification
- Upload a sanitized meal photo, delete it, and inspect object storage plus local metadata.

## Risks and rollback
- Risk: storage policies expose private media. Require negative access tests.
- Rollback disables upload scheduler and retains local text logs.

## Completion update
- Mark SYN-005 complete here and in TASK_INDEX.md.
- Update THIRD-PARTY-DATA.md only if storage metadata affects attribution.
