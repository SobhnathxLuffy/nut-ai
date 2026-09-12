# EVAL-002: Dataset Capture and Labeling Tool

Status: unstarted
Phase: 9 - Indian-food evaluation dataset
Depends on: EVAL-001
Parallel-safe with: NUT-003
Conflicts likely in: eval tooling and manifests
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 17; docs/planning/03_REQUIREMENTS_TRACEABILITY.md row 30
ADR links: docs/adr/ADR-019-observability.md

## Outcome
Maintainers can capture, validate, and label golden Indian-food samples using repo tooling without committing private media.

## Why now
The dataset spec is defined; tooling prevents inconsistent labels and accidental media leakage.

## In scope
- Add CLI or local tool for label creation and validation.
- Support weighed ingredients, cooked yield, dish family, and source-row references.
- Generate manifests and redacted summaries.

## Out of scope
- Mobile data collection from users.
- Model training.
- Public dataset release.

## Files expected to change
- Existing: eval package and scripts.
- Proposed: eval/tools/labeler, eval schema tests.

## Data/migration impact
- No app database migration.
- Private media paths must be ignored by git.
- Rollback removes eval tool files.

## Implementation contract
- Tool refuses samples without required consent/license metadata.
- Output labels are deterministic JSON or JSONL.
- Validation reports missing grams, source rows, and split assignment.

## Acceptance criteria
- Given a sample manifest, then the tool validates required fields and emits label JSON.
- Given missing consent, then validation fails.
- Given a private media path, then git status must not include the media file.

## Tests required
- CLI tests for valid and invalid manifests.
- Fixture tests for roti/rice/dal/sabzi/curry labels.
- Gitignore regression for private media directory.

## Commands
- `npm run test -- --run eval-labeler`
- `npm run check`

## Manual verification
- Run the labeler on example fixtures and inspect validation errors.

## Risks and rollback
- Risk: tooling normalizes bad labels. Keep human review step in manifest.
- Rollback by disabling capture tool scripts.

## Completion update
- Mark EVAL-002 complete here and in TASK_INDEX.md.
- Update dataset documentation with exact commands.
