# AIP-009: Offline Local AI Parser Integration

Status: deferred
Phase: 10 - Local Android AI and live controls
Depends on: AIP-008, AIP-005
Parallel-safe with: None
Conflicts likely in: parser fallback chain, assistant tools, model assets
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 14; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 4, 5
ADR links: docs/adr/ADR-014-ai-providers.md

## Outcome
When approved by the spike, an offline local parser handles text/chat food and training intents before cloud fallback.

## Why now
The product should preserve no-key utility, but local AI must wait for measured runtime and license viability.

## In scope
- Add local parser into deterministic/local/cloud/manual fallback order.
- Support bounded food logging and training read intents.
- Measure confidence and fallback behavior.

## Out of scope
- Autonomous write execution.
- Large model download UX beyond approved runtime.
- Local image analysis unless AIP-008 proves it.

## Files expected to change
- Existing: assistant parser, provider orchestration, settings.
- Proposed: local parser adapter and fixtures.

## Data/migration impact
- May add model availability preference, excluded from backup if device-specific.
- No user data migration expected.
- Rollback disables local parser feature flag.

## Implementation contract
- Local parser returns structured observations or tool proposals only.
- Low-confidence output falls back to deterministic/manual/cloud route.
- Model artifacts follow documented license and size policy.

## Acceptance criteria
- Given "2 rotis and dal", then offline parser proposes a structured meal draft.
- Given unsupported query, then fallback behavior is deterministic and visible.
- Given no model installed, then app remains usable.

## Tests required
- Parser fixture tests.
- Fallback-order tests.
- Android performance smoke tests.

## Commands
- `npm run test -- --run local-parser`
- `npm --prefix apps/mobile run typecheck`
- `npm run check`

## Manual verification
- Disable network and run supported/unsupported chat intents on Android.

## Risks and rollback
- Risk: weak local parser frustrates users. Keep manual fallback immediate.
- Rollback by disabling feature flag and removing model assets.

## Completion update
- Mark AIP-009 complete or deferred-with-reason here and in TASK_INDEX.md.
- Update local AI docs with measured constraints.
