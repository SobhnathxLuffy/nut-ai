# ADP-004: Adaptive Target Suggestions

Status: complete
Phase: 5 - Day completeness and adaptive check-ins
Depends on: ADP-003
Parallel-safe with: None
Conflicts likely in: goals, profile settings, target persistence
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 11; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 31, 33
ADR links: docs/adr/ADR-017-units-and-dates.md

## Outcome
The app can suggest calorie, protein, and macro target adjustments from weekly evidence without applying them automatically.

## Why now
Metrics are available and the product needs explicit, reversible target suggestions before safety and consent UI is layered on.

## In scope
- Implement target suggestion calculations.
- Return explanation evidence and bounded deltas.
- Preserve manually locked targets.

## Out of scope
- Medical advice or diagnosis.
- Automatic target mutation.
- AI coaching prose.

## Files expected to change
- Existing: goals package, profile goal settings, tests.
- Proposed: adaptive target fixtures.

## Data/migration impact
- May add pending-suggestion records with UUID and expiry.
- Backup v2 must preserve accepted target history, not stale ephemeral suggestions.
- Rollback disables suggestions and retains existing targets.

## Implementation contract
- Suggestions must include old target, proposed target, reason, confidence, and safety flags.
- Locked manual targets are not overwritten.
- Deltas must obey configured maximum weekly change limits.

## Acceptance criteria
- Given stable complete data, when trend implies maintenance error, then a bounded calorie adjustment is suggested.
- Given too little data, then no suggestion is returned.
- Given a locked protein target, then protein is not changed by the suggestion.

## Tests required
- Unit tests for deficit/surplus/maintenance scenarios.
- Property tests for max-delta bounds.
- Regression tests for locked targets and missing data.

## Commands
- `npm run test -- --run adaptive-targets`
- `npm run typecheck`
- `npm run check`

## Manual verification
- Seed check-in weeks with loss, gain, maintenance, and missing-data scenarios and inspect suggestions.

## Risks and rollback
- Risk: unsafe changes for vulnerable users. ADP-005 must gate exposure before release.
- Rollback by suppressing suggestion display.

## Completion update
- Mark ADP-004 complete here and in TASK_INDEX.md.
- Keep PLAN.md next task on ADP-005 before any user-facing release.
