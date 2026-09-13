# AIP-001: AI Provider Interface and Key Storage Contract

Status: completed
Phase: 6 - AI providers, photo analysis, and chat
Depends on: NUT-001, FND-003
Parallel-safe with: None
Conflicts likely in: provider contracts, secure storage settings, app configuration
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 14, 15; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 5, 24, 27
ADR links: docs/adr/ADR-014-ai-providers.md

## Outcome
Cloud and future local AI providers share a strict interface, key storage policy, error model, and no-shared-secret invariant.

## Why now
Photo analysis and chat should not encode provider-specific behavior into UI or nutrition logic.

## In scope
- Define provider request/response/error contracts.
- Wire BYO key storage through OS secure storage only.
- Add provider capability discovery for photo, OCR, chat, and structured output.

## Out of scope
- Prompt implementation for food photos.
- Local model runtime.
- Account sync for keys.

## Files expected to change
- Existing: provider adapters, settings screens, prompt package exports.
- Proposed: packages/ai-provider or provider contract module.

## Data/migration impact
- No database storage of provider keys.
- Backup must exclude all keys and secret material.
- Rollback returns existing provider-specific calls while preserving stored OS keys.

## Implementation contract
- Provider keys never enter SQLite, logs, backups, crash reports, or web bundles.
- Errors classify as auth, quota, timeout, unavailable, schema, and safety.
- All mutating AI suggestions return proposed operations, not direct writes.

## Acceptance criteria
- Given no key, when a cloud provider is selected, then the app offers setup and does not send media.
- Given a provider timeout, then the caller receives a typed retryable error.
- Given backup export, then no provider key appears in the artifact.

## Tests required
- Unit tests for provider capability and error mapping.
- Secure-storage mock tests for key save/delete/read.
- Backup exclusion regression test.

## Commands
- `npm run test -- --run ai-provider`
- `npm --prefix apps/mobile run typecheck`
- `npm run check`

## Manual verification
- Add, validate, delete, and re-add a BYO key on Android without network secrets appearing in logs.

## Risks and rollback
- Risk: accidental key persistence. Add explicit tests that scan exported backup payloads.
- Rollback by disabling new provider UI and keeping existing adapters.

## Completion update
- Mark AIP-001 complete here and in TASK_INDEX.md.
- Update privacy/security docs if storage behavior changes.
