# WEB-002: Web Local Store and Sync Bootstrap

Status: unstarted
Phase: 7 - Accounts, sync, Supabase, and web
Depends on: WEB-001, SYN-003
Parallel-safe with: None
Conflicts likely in: web storage adapter, sync engine, auth bootstrap
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 2, 16; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 25, 26
ADR links: docs/adr/ADR-003-web-stack.md, docs/adr/ADR-013-sync-architecture.md

## Outcome
The web app has local-first storage and can bootstrap sync from an account without bypassing shared validation.

## Why now
The web shell exists and sync engine exists; data access can now be connected before feature screens are built.

## In scope
- Add IndexedDB/OPFS/SQLite-WASM storage choice per ADR-003.
- Wire auth state and sync bootstrap.
- Reuse shared import/export and validation contracts.

## Out of scope
- Full web Food/Train UI.
- Offline PWA install polish.
- Production hosting.

## Files expected to change
- Existing: apps/web, db-adapter package, sync engine.
- Proposed: web storage adapter tests.

## Data/migration impact
- Web local schema version must align with mobile migration contracts.
- Backup/import remains versioned and tested.
- Rollback clears web bootstrap path without touching mobile data.

## Implementation contract
- Remote data is validated before entering web local store.
- Web can open offline after initial bootstrap.
- Secrets use browser-safe storage appropriate to ADR-003 and never enter exported backups.

## Acceptance criteria
- Given a signed-in account with data, when web bootstraps, then records load into local storage.
- Given network loss after bootstrap, then read-only local screens still render.
- Given invalid remote data, then bootstrap reports quarantine rather than crashing.

## Tests required
- Web storage adapter tests.
- Sync bootstrap integration tests.
- Browser smoke test for offline reload.

## Commands
- `npm --prefix apps/web run build`
- `npm run test -- --run web-storage`
- `npm run check`

## Manual verification
- Bootstrap a test account in the web app, reload offline, and inspect local data rendering.

## Risks and rollback
- Risk: browser storage differences cause data loss. Keep import/export recovery available.
- Rollback by disabling web sync bootstrap.

## Completion update
- Mark WEB-002 complete here and in TASK_INDEX.md.
- Update PLAN.md if WEB-003 becomes ready.
