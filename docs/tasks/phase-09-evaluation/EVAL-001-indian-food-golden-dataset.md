# EVAL-001: Indian Food Golden Dataset Specification

Status: unstarted
Phase: 9 - Indian-food evaluation dataset
Depends on: IND-003, AIP-003
Parallel-safe with: REL-005
Conflicts likely in: eval manifests, privacy rules, data licenses
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 5, 7, 17; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 30, 32
ADR links: docs/adr/ADR-019-observability.md, docs/adr/ADR-006-ifct-integration.md

## Outcome
The repository defines the golden dataset schema, consent rules, capture protocol, labels, metrics, and licensing constraints for Indian-food evaluation.

## Why now
Photo analysis exists, but published confidence must be measured against a clear dataset before claims or calibration.

## In scope
- Specify sample metadata, weighed ground truth, region/dish coverage, consent, and retention.
- Define metrics for identification, grams, macros, hidden fats, and confidence calibration.
- Add manifest templates for non-committed private media.

## Out of scope
- Collecting real user photos into the repo.
- Publishing accuracy claims.
- Training local AI.

## Files expected to change
- Existing: eval docs, data manifests, privacy/security docs.
- Proposed: eval/golden-dataset schema docs and fixtures.

## Data/migration impact
- No app schema migration.
- No private photos or secrets committed.
- Rollback removes dataset spec documents only.

## Implementation contract
- Golden media stays outside git unless explicitly licensed and scrubbed.
- Labels include food identity, cooked/raw basis, grams, source rows, and uncertainty notes.
- Dataset splits prevent prompt overfitting.

## Acceptance criteria
- Given a new sample, then the spec explains required metadata and acceptance checks.
- Given an evaluator, then metrics can be computed from labels without app UI.
- Given no media permission, then the sample is excluded.

## Tests required
- Schema validation test for example labels.
- Link/license checks for dataset docs.
- Secret/media scan in release checks.

## Commands
- `npm run test -- --run eval`
- `npm run check`

## Manual verification
- Create one synthetic/example label file and validate it against the schema.

## Risks and rollback
- Risk: private media leakage. Keep real media outside git and document storage controls.
- Rollback by deleting non-code dataset spec additions.

## Completion update
- Mark EVAL-001 complete here and in TASK_INDEX.md.
- Update docs/planning/17_TESTING_AND_EVALUATION.md.
