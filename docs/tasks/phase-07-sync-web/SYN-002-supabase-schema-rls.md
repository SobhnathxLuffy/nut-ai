# SYN-002: Supabase Schema and RLS Draft

Status: unstarted
Phase: 7 - Accounts, sync, Supabase, and web
Depends on: SYN-001
Parallel-safe with: None
Conflicts likely in: supabase migrations, RLS policy docs, sync contracts
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 16; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 26, 29
ADR links: docs/adr/ADR-013-sync-architecture.md

## Outcome
Supabase migrations and row-level-security policies mirror the syncable local model without weakening local-only mode.

## Why now
The outbox engine needs a concrete remote schema and policy contract before it can synchronize safely.

## In scope
- Add Supabase migration files for syncable entities.
- Draft and test RLS policies by account/user boundary.
- Document non-syncable local-only and secret fields.

## Out of scope
- Deploying production Supabase.
- Web UI.
- Object storage lifecycle.

## Files expected to change
- Proposed: supabase/migrations, supabase/tests, sync schema docs.
- Existing: sync architecture docs if policy names differ.

## Data/migration impact
- Remote schema is additive and versioned separately from local SQLite migrations.
- Backup remains local export, not a Supabase dump.
- Rollback drops remote migration draft before deployment.

## Implementation contract
- Remote rows include UUID, owner/account ID, sync version, updated/deleted metadata, and conflict fields.
- RLS must deny cross-account reads/writes in tests.
- Provider keys and raw secret material are not syncable.

## Acceptance criteria
- Given two test accounts, then neither can read or mutate the other's rows.
- Given a soft-deleted row, then it remains syncable for tombstone propagation.
- Given non-syncable fields, then migrations omit them.

## Tests required
- Supabase local migration tests.
- RLS positive and negative access tests.
- Schema parity tests against local sync contracts.

## Commands
- `npx supabase db lint`
- `npx supabase db test`
- `npm run check`

## Manual verification
- Run local Supabase, seed two accounts, and verify RLS with service and user roles.

## Risks and rollback
- Risk: RLS errors can expose private data. Treat failing negative tests as release blockers.
- Rollback by not deploying migrations.

## Completion update
- Mark SYN-002 complete here and in TASK_INDEX.md.
- Record RLS policy names in sync planning docs.
