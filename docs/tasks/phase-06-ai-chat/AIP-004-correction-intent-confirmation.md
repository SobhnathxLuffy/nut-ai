# AIP-004: Correction Intent Parser and Confirmation

Status: unstarted
Phase: 6 - AI providers, photo analysis, and chat
Depends on: AIP-003, FND-003
Parallel-safe with: None
Conflicts likely in: correction flow, operation handlers, meal review UI
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 4, 14; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 3, 8, 40
ADR links: docs/adr/ADR-012-undo-operations.md, docs/adr/ADR-014-ai-providers.md

## Outcome
Text corrections produce structured proposed operations that require confirmation before changing logged nutrition or workout data.

## Why now
Photo analysis creates editable results; corrections need the same operation safety model before assistant write actions expand it.

## In scope
- Parse correction intents for meal components, portions, ingredients, and hidden fats.
- Show before/after deltas and require confirmation.
- Apply confirmed corrections through the operation log with undo.

## Out of scope
- Free-form medical or coaching chat.
- Training routine generation.
- Sync conflict resolution.

## Files expected to change
- Existing: Fix Result flow, operation handlers, review UI.
- Proposed: correction intent fixtures.

## Data/migration impact
- Corrections are operation-log mutations and must be backup-safe.
- Historical nutrition snapshots remain immutable except through explicit new correction versions.
- Rollback disables AI correction parser and leaves manual edits.

## Implementation contract
- AI may propose operations but cannot directly mutate storage.
- Unmentioned components remain unchanged.
- Confirmation displays changed fields, confidence, and provenance impact.

## Acceptance criteria
- Given "make it 2 rotis not 3", when confirmed, then only the roti quantity changes.
- Given ambiguous correction text, then the app asks a clarification or falls back to manual edit.
- Given undo after correction, then previous meal state is restored.

## Tests required
- Intent fixture tests for quantity, ingredient add/remove, and portion corrections.
- Operation/undo integration tests.
- UI tests for confirmation and cancellation.

## Commands
- `npm run test -- --run correction`
- `npm --prefix apps/mobile run typecheck`
- `npm run check`

## Manual verification
- Correct a photo result with targeted text, cancel once, confirm once, then undo.

## Risks and rollback
- Risk: AI over-edits. Enforce field-level diffs and reject broad unvalidated mutations.
- Rollback by disabling AI correction while preserving manual edit.

## Completion update
- Mark AIP-004 complete here and in TASK_INDEX.md.
- Update assistant write policy docs if contracts change.
