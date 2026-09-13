# ADP-003: Weekly Check-in Metrics Engine

Status: complete
Phase: 5 - Day completeness and adaptive check-ins
Depends on: ADP-001, TRN-004
Parallel-safe with: ADP-002
Conflicts likely in: goals, analytics, report fixtures
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 11; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 18, 24
ADR links: docs/adr/ADR-017-units-and-dates.md

## Outcome
A deterministic weekly check-in engine summarizes weight trend, average intake, protein compliance, training consistency, and excluded-day evidence.

## Why now
Adaptive target suggestions need a tested metrics layer before changing any user-visible recommendations.

## In scope
- Implement weekly metric calculations.
- Include day completeness exclusions and evidence counts.
- Keep exercise calories separate from food target math.

## Out of scope
- Applying new macro targets.
- AI-written coaching text.
- Reports UI beyond fixture outputs.

## Files expected to change
- Existing: goals package, analytics fixtures, training PR summaries.
- Proposed: weekly check-in engine module.

## Data/migration impact
- No schema migration expected.
- Derived metrics excluded from backup unless cached and rebuildable.
- Rollback leaves goal calculations on existing static targets.

## Implementation contract
- Weight trend uses EWMA or the ADR-pinned trend method.
- Days excluded by ADP-001 must be visible in returned evidence.
- Training consistency counts completed workouts, not active/incomplete sessions.

## Acceptance criteria
- Given seven complete days, when metrics run, then weekly averages match fixture arithmetic.
- Given partial days, then returned evidence lists excluded dates.
- Given no weigh-ins, then trend output is unavailable rather than guessed.

## Tests required
- Unit tests for intake, protein, weigh-in, and training consistency metrics.
- Property tests for denominator handling.
- Snapshot tests for full check-in metric payloads.

## Commands
- `npm run test -- --run weekly-checkin`
- `npm run typecheck`
- `npm run check`

## Manual verification
- Run a seeded dev account through one complete and one incomplete week and inspect metric payloads.

## Risks and rollback
- Risk: incomplete data looks like failure. Include neutral unavailable states.
- Rollback by disabling the weekly check-in entry point.

## Completion update
- Mark ADP-003 complete here and in TASK_INDEX.md.
- Document metric constants in planning docs.
