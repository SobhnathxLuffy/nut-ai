# AIP-006: Assistant Write Actions with Confirmation

Status: unstarted
Phase: 6 - AI providers, photo analysis, and chat
Depends on: AIP-004, AIP-005
Parallel-safe with: AIP-007
Conflicts likely in: assistant confirmations, operation handlers, routine creation
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 14; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 24, 40
ADR links: docs/adr/ADR-012-undo-operations.md, docs/adr/ADR-014-ai-providers.md

## Outcome
Assistant write requests create proposed operations for meals, targets, workouts, and routines, and apply only after explicit confirmation.

## Why now
Read tools and correction operations exist; write actions can reuse them without inventing unsafe mutation paths.

## In scope
- Define write tool proposal schemas.
- Add confirmation UI with before/after diff.
- Apply confirmed writes via operation log and undo.

## Out of scope
- Fully autonomous coaching.
- Medical recommendations.
- Sync conflict handling.

## Files expected to change
- Existing: assistant route, operation handlers, routine/meal creation flows.
- Proposed: assistant write fixtures.

## Data/migration impact
- Writes use existing entity schemas and operation log.
- Backup must round-trip resulting entities and operations.
- Rollback disables assistant write tools only.

## Implementation contract
- Every write proposal includes entity type, diff, source text, confidence, and required confirmation.
- Cancelled proposals leave no durable mutation.
- Safety-guarded goal changes delegate to ADP-005.

## Acceptance criteria
- Given "make me a push workout", then a draft routine appears and is not saved until confirmed.
- Given "log 2 rotis", then a meal proposal shows nutrition sources before saving.
- Given cancellation, then no records are created.

## Tests required
- Proposal schema tests.
- Integration tests for meal and routine proposals.
- UI tests for confirm/cancel/undo.

## Commands
- `npm run test -- --run assistant-write`
- `npm --prefix apps/mobile run typecheck`
- `npm run check`

## Manual verification
- Request a meal log and routine creation through chat, cancel one, confirm one, and undo the confirmed operation.

## Risks and rollback
- Risk: broad prompts create surprising changes. Limit tool scope and require field-level confirmation.
- Rollback by disabling write-capable tools.

## Completion update
- Mark AIP-006 complete here and in TASK_INDEX.md.
- Update task index if new write-action slices are split out.
