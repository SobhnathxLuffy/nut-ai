# AIP-007: Provider Fallbacks, Timeouts, Retries, and Cache

Status: unstarted
Phase: 6 - AI providers, photo analysis, and chat
Depends on: AIP-001, AIP-003
Parallel-safe with: AIP-006
Conflicts likely in: provider orchestration and telemetry
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 14, 15; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 5, 27
ADR links: docs/adr/ADR-014-ai-providers.md

## Outcome
AI calls use deterministic fallback, timeout, retry, and optional local cache behavior without leaking secrets or duplicating mutations.

## Why now
Photo analysis and assistant calls need operational hardening before sync, web, and release security reviews depend on them.

## In scope
- Implement provider fallback order and per-capability timeout policy.
- Add retry rules for retryable failures.
- Add cache semantics for safe, non-secret structured results when enabled.

## Out of scope
- New provider integrations not already selected.
- Evaluation calibration.
- Local model runtime.

## Files expected to change
- Existing: provider adapters, AI call sites, logging/telemetry utilities.
- Proposed: provider orchestration tests.

## Data/migration impact
- Cache, if persisted, must exclude raw secrets and obey photo retention policy.
- Backup excludes ephemeral provider cache unless explicitly user-visible.
- Rollback reverts to single-provider calls.

## Implementation contract
- Non-idempotent writes cannot retry after partial mutation because providers only return proposals.
- Fallback must preserve original sanitized media and prompt version.
- Errors exposed to users must be actionable and provider-neutral.

## Acceptance criteria
- Given primary provider timeout, when fallback is configured, then secondary provider is called once.
- Given auth failure, then retry does not loop and setup UI is shown.
- Given identical safe request with cache enabled, then cached structured result is reused according to policy.

## Tests required
- Unit tests for retry matrix and fallback order.
- Integration tests with mocked provider failures.
- Secret scanning test for cache payloads.

## Commands
- `npm run test -- --run provider-fallback`
- `npm run typecheck`
- `npm run check`

## Manual verification
- Simulate timeout, auth failure, and quota failure in provider settings and inspect user-facing errors.

## Risks and rollback
- Risk: fallback increases user cost. Show provider used and avoid hidden repeated calls.
- Rollback by disabling fallback and retries through configuration.

## Completion update
- Mark AIP-007 complete here and in TASK_INDEX.md.
- Update privacy/security and provider ADR docs with final timeout constants.
