# ADP-001: Day Status Rules and Analytics Exclusions

Status: unstarted
Phase: 5 - Day completeness and adaptive check-ins
Depends on: FND-004, TLN-001
Parallel-safe with: None
Conflicts likely in: goals, reports contracts, day aggregation logic
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 11; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 23, 33
ADR links: docs/adr/ADR-017-units-and-dates.md

## Outcome
Day status values COMPLETE, PARTIAL, UNKNOWN, and FASTING consistently control which days count in nutrition and weight trend calculations.

## Why now
Adaptive check-ins and reports must not average incomplete days as if they were real low-intake days.

## In scope
- Implement day-status domain rules and analytics exclusion helpers.
- Define fasting behavior separately from unknown/missed logging.
- Expose deterministic aggregation contracts for reports and check-ins.

## Out of scope
- Check-in UI.
- Goal changes.
- Sync conflict UI for day status.

## Files expected to change
- Existing: goals package, day completeness schema, timeline aggregation.
- Proposed: packages/day-status or goals/day-status module.

## Data/migration impact
- Uses FND-004 storage.
- Backup must preserve day status and status provenance.
- Rollback treats all days as UNKNOWN for adaptive logic.

## Implementation contract
- COMPLETE and FASTING count as intentionally finalized days.
- PARTIAL and UNKNOWN are excluded from calorie-average denominators.
- Exercise calories must not be auto-added back into food targets.

## Acceptance criteria
- Given a week with partial days, when averages are calculated, then partial/unknown days are excluded.
- Given a fasting day, when reports run, then it is represented as intentional rather than missing.
- Given no explicit status, then the day defaults to UNKNOWN.

## Tests required
- Unit tests for all status transitions and average denominators.
- Property tests for weekly aggregation with mixed statuses.
- Regression test for exercise-calorie policy.

## Commands
- `npm run test -- --run day-status`
- `npm run typecheck`
- `npm run check`

## Manual verification
- Mark days with each status in a dev fixture and inspect calculated averages.

## Risks and rollback
- Risk: trend changes surprise users. UI copy must explain exclusions without judgment.
- Rollback by disabling adaptive use of day status while preserving stored values.

## Completion update
- Mark ADP-001 complete here and in TASK_INDEX.md.
- Update docs/planning/09_NUTRITION_ENGINE.md if exclusion constants change.
