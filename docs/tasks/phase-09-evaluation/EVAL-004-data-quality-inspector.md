# EVAL-004: Data Quality Inspector

Status: unstarted
Phase: 9 - Indian-food evaluation dataset
Depends on: NUT-002, EVAL-003
Parallel-safe with: REL-005
Conflicts likely in: Food detail UI, provenance contracts, source diagnostics
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 7; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 31, 41
ADR links: docs/adr/ADR-005-nutrition-source-adapter.md, docs/adr/ADR-019-observability.md

## Outcome
Users can inspect why a number appears, including source row, recipe version, portion evidence, uncertainty, and micronutrient coverage.

## Why now
Calibration and micronutrient provenance are ready; inspection can now show measured quality rather than placeholder explanations.

## In scope
- Add inspector payload and UI for meal components.
- Show assumptions, source versions, portion evidence, and coverage.
- Include report/debug hooks for data quality review.

## Out of scope
- Admin backend.
- Editing IFCT source data inside the app.
- Medical interpretation.

## Files expected to change
- Existing: Food detail/review UI, nutrition provenance contracts.
- Proposed: inspector fixtures and component tests.

## Data/migration impact
- No schema migration expected if provenance is already stored.
- Backup unaffected beyond stored provenance.
- Rollback hides inspector affordance.

## Implementation contract
- Inspector must cite immutable logged snapshot and source version.
- Unknown micronutrients and weak portion evidence are explicit.
- It must not ask the AI to justify numbers after logging.

## Acceptance criteria
- Given a logged recipe, then inspector shows recipe version, yield, oil assumptions, and source rows.
- Given weak portion evidence, then uncertainty contributors are listed.
- Given missing micronutrients, then coverage explains unknown data.

## Tests required
- Contract tests for inspector payload.
- UI tests for source, recipe, portion, and micronutrient states.
- Accessibility tests for expandable details.

## Commands
- `npm run test -- --run data-quality-inspector`
- `npm --prefix apps/mobile run typecheck`
- `npm run check`

## Manual verification
- Inspect photo-logged, manually logged, recipe, and packaged foods on Android.

## Risks and rollback
- Risk: overwhelming UI. Keep inspector behind a "why this number" affordance.
- Rollback by hiding inspector entry points.

## Completion update
- Mark EVAL-004 complete here and in TASK_INDEX.md.
- Update release compliance docs if provenance language changes.
