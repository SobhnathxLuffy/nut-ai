# ADP-005: Check-in Consent and Safety Guardrails

Status: complete
Phase: 5 - Day completeness and adaptive check-ins
Depends on: ADP-004
Parallel-safe with: None
Conflicts likely in: safety rules, profile settings, check-in UI copy
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 11, 15; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 31, 33
ADR links: docs/adr/ADR-018-health-score-removal.md

## Outcome
Adaptive check-ins require explicit acceptance, enforce hard safety constraints, and avoid arbitrary health scores or medical claims.

## Why now
Suggestions exist; release requires consent and safety gates before any target can change.

## In scope
- Add confirmation flow for applying suggestions.
- Enforce guardrails for minors, pregnancy/lactation, eating-disorder risk signals, and extreme deltas.
- Store accepted changes with audit evidence.

## Out of scope
- Diagnosis or treatment advice.
- Chatbot counseling.
- Push reminder system.

## Files expected to change
- Existing: goals UI, profile settings, safety copy, operation handlers.
- Proposed: safety guardrail fixtures.

## Data/migration impact
- Accepted target changes must be versioned and backup-safe.
- Rejected/expired ephemeral suggestions do not need backup.
- Rollback disables apply action while preserving historical targets.

## Implementation contract
- No target change is applied without a user confirmation operation.
- Safety warnings use plain language and never shame missed logging.
- Health-score surfaces must not be reintroduced.

## Acceptance criteria
- Given a safe suggestion, when accepted, then a versioned target change is stored.
- Given a blocked safety condition, then the app refuses the change and suggests professional guidance.
- Given the user rejects a suggestion, then current targets remain unchanged.

## Tests required
- Unit tests for each guardrail.
- Integration tests for accept/reject operations.
- UI/accessibility tests for confirmation and blocked states.

## Commands
- `npm run test -- --run checkin-safety`
- `npm run typecheck`
- `npm run check`

## Manual verification
- Exercise accept, reject, missing-data, and blocked-safety flows on Android.

## Risks and rollback
- Risk: copy may imply medical advice. Review against privacy/safety docs before completion.
- Rollback by hiding adaptive apply controls.

## Completion update
- Mark ADP-005 complete here and in TASK_INDEX.md.
- Update PLAN.md and release gates when adaptive check-ins are ready.
