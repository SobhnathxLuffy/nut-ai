# AIP-003: Structured Meal Photo Analysis

Status: unstarted
Phase: 6 - AI providers, photo analysis, and chat
Depends on: AIP-002, IND-003
Parallel-safe with: None
Conflicts likely in: prompt package, gram engine integration, camera result flow
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 4, 7, 14; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 3, 8, 10
ADR links: docs/adr/ADR-014-ai-providers.md, docs/adr/ADR-006-ifct-integration.md

## Outcome
Photo analysis returns structured observations that feed deterministic food resolution, portion evidence, uncertainty, and editable review rows.

## Why now
The nutrition and provider boundaries are ready; the AI can now be limited to perception instead of owning displayed numbers.

## In scope
- Implement structured photo prompts and schema validation.
- Map observations to food resolver, recipe, and gram engine inputs.
- Surface uncertainty contributors and clarification prompts.

## Out of scope
- Local multimodal AI.
- Syncing photo objects.
- Evaluation calibration beyond fixture tests.

## Files expected to change
- Existing: prompt package, camera analysis flow, gram engine adapters, review UI.
- Proposed: photo-analysis fixtures.

## Data/migration impact
- Logged meals store deterministic nutrition snapshots, not raw provider numbers.
- Raw provider response retention follows AIP-002 policy.
- Rollback leaves manual/barcode/search logging active.

## Implementation contract
- Provider output is validated before use.
- Calories/macros are computed locally from source rows and portions.
- Ambiguous hidden-fat or portion conflicts become questions, not silent averages.

## Acceptance criteria
- Given a valid provider observation, when resolved, then displayed totals match deterministic engine output.
- Given malformed provider output, then the app shows a recoverable error and manual fallback.
- Given hidden-fat ambiguity, then the review flow asks a targeted question.

## Tests required
- Schema validation tests for provider responses.
- Integration fixtures for roti, rice, dal, sabzi, and curry photos.
- Regression tests that provider nutrition numbers are ignored.

## Commands
- `npm run test -- --run photo-analysis`
- `npm run data:verify`
- `npm run check`

## Manual verification
- Analyze representative Indian meals and confirm editable chips, uncertainty, and source rows before logging.

## Risks and rollback
- Risk: provider drift breaks structured output. Use strict schema errors and fallback UI.
- Rollback by disabling photo analysis entry points while preserving other input modes.

## Completion update
- Mark AIP-003 complete here and in TASK_INDEX.md.
- Add prompt version to docs/planning/13_AI_CHAT_AND_PROVIDER_ARCHITECTURE.md.
