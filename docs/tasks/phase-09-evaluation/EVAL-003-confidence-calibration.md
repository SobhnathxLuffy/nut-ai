# EVAL-003: Empirical Confidence Calibration

Status: unstarted
Phase: 9 - Indian-food evaluation dataset
Depends on: EVAL-002, AIP-003
Parallel-safe with: None
Conflicts likely in: confidence package, photo analysis metrics, eval harness
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 7, 17; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 10, 30
ADR links: docs/adr/ADR-019-observability.md

## Outcome
Confidence bands for Indian-food photo analysis are calibrated from measured errors rather than provider self-confidence.

## Why now
Golden samples and photo analysis exist; confidence can now be measured and fed back into user-facing uncertainty.

## In scope
- Compute empirical error bands by dish/category/source evidence.
- Compare predicted uncertainty with observed error.
- Export calibration artifacts for app use.

## Out of scope
- Training a new model.
- Publishing claims before release review.
- Changing nutrition source data.

## Files expected to change
- Existing: confidence package, eval harness, photo-analysis fixtures.
- Proposed: calibration artifact generator.

## Data/migration impact
- Calibration artifacts are generated data and must be versioned intentionally.
- No user backup impact.
- Rollback restores prior confidence bands.

## Implementation contract
- Provider confidence values are ignored for final bands.
- Calibration reports include sample count and coverage warnings.
- Bands widen when evidence is weak or category sample count is low.

## Acceptance criteria
- Given labeled samples, then the harness reports gram and macro error distributions.
- Given under-sampled category, then confidence output is marked insufficient or widened.
- Given app analysis, then displayed uncertainty uses calibration artifact version.

## Tests required
- Unit tests for calibration math.
- Fixture tests for under/over-confident categories.
- Regression tests for artifact loading under Node and mobile.

## Commands
- `npm run test -- --run confidence`
- `npm run test -- --run eval`
- `npm run check`

## Manual verification
- Run calibration on example labels and inspect generated report and app artifact.

## Risks and rollback
- Risk: small datasets create false precision. Enforce minimum sample thresholds.
- Rollback by reverting calibration artifact and widening default uncertainty.

## Completion update
- Mark EVAL-003 complete here and in TASK_INDEX.md.
- Update testing/evaluation docs with measured thresholds.
