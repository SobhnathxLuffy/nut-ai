# AIP-008: Local Android Multimodal AI Spike

Status: deferred
Phase: 10 - Local Android AI and live controls
Depends on: AIP-003, EVAL-003
Parallel-safe with: TRN-006
Conflicts likely in: Android native runtime, model asset policy, app size budget
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 14, 15; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 4, 5
ADR links: docs/adr/ADR-014-ai-providers.md

## Outcome
A measured Android-only spike determines whether a local multimodal model can meet privacy, size, latency, and accuracy gates.

## Why now
Local AI is intentionally later-phase and should be attempted only after cloud analysis and calibration provide a benchmark.

## In scope
- Evaluate candidate on-device runtimes and model packaging.
- Measure latency, memory, battery, APK/download size, and accuracy on the golden set.
- Produce go/no-go recommendation.

## Out of scope
- Shipping local AI as default.
- Replacing deterministic nutrition calculations.
- iOS local model support.

## Files expected to change
- Proposed: local-ai spike docs, benchmark scripts, optional ignored model asset instructions.
- Existing: evaluation harness if benchmark hooks are needed.

## Data/migration impact
- No user schema migration.
- Model binaries must not be committed unless license and size gates are approved.
- Rollback removes spike code and docs.

## Implementation contract
- Local AI can produce observations only; deterministic engine still owns nutrition numbers.
- Benchmarks must compare against AIP-003 cloud baseline.
- Model licenses and redistribution rights must be documented.

## Acceptance criteria
- Given candidate model, then benchmark report includes latency, memory, size, and accuracy.
- Given license uncertainty, then candidate is rejected or deferred.
- Given poor accuracy, then local AI remains unavailable.

## Tests required
- Benchmark smoke tests.
- Evaluation harness comparison.
- License manifest check for any downloaded model.

## Commands
- `npm run test -- --run local-ai`
- `npm run test -- --run eval`
- `npm run check`

## Manual verification
- Run benchmark on target Android hardware and inspect generated report.

## Risks and rollback
- Risk: model assets bloat repo or app. Keep assets ignored and require explicit approval.
- Rollback by deleting spike integration and keeping cloud/manual flows.

## Completion update
- Mark AIP-008 complete or deferred-with-reason here and in TASK_INDEX.md.
- Update ADR-014 if a local runtime is selected.
