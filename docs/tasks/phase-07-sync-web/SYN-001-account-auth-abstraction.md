# SYN-001: Account and Auth Abstraction

Status: unstarted
Phase: 7 - Accounts, sync, Supabase, and web
Depends on: FND-001, FND-003
Parallel-safe with: WEB-001 after interface review
Conflicts likely in: profile settings, onboarding, auth contracts
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 16; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 26, 29
ADR links: docs/adr/ADR-013-sync-architecture.md

## Outcome
The app supports local-only and optional account modes through a provider-independent auth/account boundary.

## Why now
Sync and web must not hard-code Supabase auth into domain or mobile UI.

## In scope
- Define account identity, local profile, auth state, and migration preconditions.
- Add settings surfaces for local-only versus signed-in state.
- Keep app fully usable without account creation.

## Out of scope
- Supabase database schema.
- Outbox sync.
- Web app implementation beyond contract needs.

## Files expected to change
- Existing: profile/onboarding settings, domain identity contracts.
- Proposed: packages/auth or sync-auth contract module.

## Data/migration impact
- Local user IDs from FND-001 remain stable.
- Backup preserves local identity but not auth tokens.
- Rollback hides account UI and preserves local-only mode.

## Implementation contract
- Account mode is optional and reversible only through explicit sign-out/migration rules.
- Auth tokens never enter backup or operation logs.
- Domain packages depend on account contracts, not Supabase SDKs.

## Acceptance criteria
- Given no account, when the app starts, then all local features remain available.
- Given sign-in state changes, then UI updates without losing local data.
- Given backup export, then auth tokens are absent.

## Tests required
- Unit tests for auth state transitions.
- Backup exclusion test for tokens.
- UI tests for local-only and account settings states.

## Commands
- `npm run test -- --run auth`
- `npm --prefix apps/mobile run typecheck`
- `npm run check`

## Manual verification
- Start local-only, open account settings, simulate sign-in/sign-out, and verify data remains local.

## Risks and rollback
- Risk: account prompts undermine local-first promise. Keep local-only path primary and complete.
- Rollback by hiding account settings.

## Completion update
- Mark SYN-001 complete here and in TASK_INDEX.md.
- Update docs/planning/14_OFFLINE_SYNC_AND_WEB.md with final auth boundary.
