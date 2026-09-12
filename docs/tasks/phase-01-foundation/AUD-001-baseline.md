# AUD-001: Reproduce Baseline and Correct Stale Documentation

Status: complete
Phase: 1 - Foundation
Depends on: None
Parallel-safe with: FND-001 after completion
Conflicts likely in: VERIFICATION.md, eslint config, THIRD-PARTY-DATA.md
Requirement links: docs/planning/01_REPOSITORY_AUDIT.md; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 1, 32
ADR links: docs/adr/ADR-001-monorepo-tooling.md, docs/adr/ADR-020-testing-stack.md

## Outcome
Baseline checks are reproduced, stale documentation is corrected, license docs exist, and lint/check commands report the real state.

## Why now
This is the first ready task because every later implementation needs truthful baseline commands and repository status.

## In scope
- Run current validation commands; add missing ESLint config only if still absent; verify THIRD-PARTY-DATA.md; correct VERIFICATION.md/README status claims.

## Out of scope
- Feature behavior changes; schema changes; committing or pushing changes.

## Files expected to change
- Existing: package.json scripts, VERIFICATION.md, README.md, THIRD-PARTY-DATA.md. Proposed: eslint.config.js if required.

## Data/migration impact
- No app data migration. Backup format unchanged. Rollback reverts docs/lint config only.

## Implementation contract
- Validation results must distinguish pre-existing failures from new regressions. No planned feature may be described as implemented.

## Acceptance criteria
- Given a fresh checkout, when the documented commands run, then their results match VERIFICATION.md. Given README status text, then it links planning docs without advertising planned features.

## Tests required
- Lint configuration smoke; full `npm run check` or documented failing subcommands; node-purity gate.

## Commands
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run check:node-purity`
- `npm run data:verify`
- `npm run check`

## Manual verification
- Inspect README and VERIFICATION.md for stale claims; verify no application feature behavior changed.

## Risks and rollback
- Risk: hiding pre-existing failures. Record real output and leave behavior untouched. Rollback by reverting docs/config edits.

## Completion update
- Mark AUD-001 complete here and in TASK_INDEX.md.
- Update PLAN.md, linked planning docs, and any release/checklist evidence touched by the task.
