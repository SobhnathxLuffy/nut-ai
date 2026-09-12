# REL-005: License and Data Release Compliance

Status: unstarted
Phase: 11 - Accessibility, security, performance, and release
Depends on: EVAL-004, IND-001
Parallel-safe with: REL-004
Conflicts likely in: license docs, data manifests, release packaging
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 6, 17; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 6, 32
ADR links: docs/adr/ADR-006-ifct-integration.md

## Outcome
Application, nutrition data, evaluation data, model assets, and third-party dependencies have documented licenses and release-compatible attribution.

## Why now
All data sources and optional model/evaluation artifacts must be known before beta packaging and public claims.

## In scope
- Verify AGPL application licensing, data source terms, IFCT permission record, attribution, and generated artifact manifests.
- Ensure no unrelated unlicensed data is included.
- Add release checks for manifests and attribution.

## Out of scope
- Legal advice beyond documented engineering checklist.
- Adding new data sources.
- Store submission.

## Files expected to change
- Existing: THIRD-PARTY-DATA.md, docs/data, release checklist, package metadata.
- Proposed: license verification script or manifest fixtures.

## Data/migration impact
- No user data migration.
- Generated data artifacts must carry source/version/license metadata.
- Rollback excludes non-compliant data from release artifacts.

## Implementation contract
- IFCT inclusion must trace to permission/source manifest.
- Evaluation media is excluded unless explicitly licensed and consented.
- Model assets require redistribution rights before packaging.

## Acceptance criteria
- Given release build inputs, then every data artifact maps to a license and source manifest.
- Given IFCT data, then attribution and permission records resolve.
- Given dependency list, then incompatible license findings are reviewed.

## Tests required
- Manifest validation tests.
- Link checks for attribution docs.
- Dependency license report review.

## Commands
- `npm run test -- --run license`
- `npm audit`
- `npm run check`

## Manual verification
- Inspect release bundle contents against THIRD-PARTY-DATA.md and source manifests.

## Risks and rollback
- Risk: license ambiguity delays release. Exclude unclear data rather than ship it.
- Rollback by removing non-compliant artifacts from packaging.

## Completion update
- Mark REL-005 complete here and in TASK_INDEX.md.
- Update release checklist with compliance evidence.
