# REL-003: Performance Budgets and Profiling

Status: unstarted
Phase: 11 - Accessibility, security, performance, and release
Depends on: TLN-004, WEB-003
Parallel-safe with: REL-002
Conflicts likely in: timeline rendering, search, sync, app startup, reports
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 1, 12; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 1, 35, 37
ADR links: docs/adr/ADR-020-testing-stack.md

## Outcome
Search, logging, workout, timeline, reports, sync, and web startup meet measured performance budgets on target devices.

## Why now
All core workflows exist; performance work can profile the real product instead of placeholders.

## In scope
- Define and measure budgets for startup, search, timeline scroll, workout interactions, photo preprocessing, sync, and reports.
- Optimize bottlenecks without changing product behavior.
- Add regression benchmarks where practical.

## Out of scope
- New UI features.
- Model accuracy improvements.
- Store submission.

## Files expected to change
- Existing: performance-critical packages, mobile/web routes, tests.
- Proposed: benchmark scripts and profiling reports.

## Data/migration impact
- No schema migration expected.
- Derived caches must be rebuildable and excluded from backup unless user-visible.
- Rollback reverts individual optimizations.

## Implementation contract
- Local search target remains under the budget documented in release gates.
- Timeline scroll must not overlap or resize rows unexpectedly.
- Optimizations cannot break Node-purity or offline behavior.

## Acceptance criteria
- Given target Android hardware, then search and timeline meet documented budgets.
- Given web cold start, then app loads within budget on supported browsers.
- Given report generation, then large local datasets complete without UI freeze.

## Tests required
- Benchmark smoke tests.
- Regression tests for cache invalidation.
- Manual profiling evidence for Android and web.

## Commands
- `npm run test -- --run performance`
- `npm --prefix apps/web run build`
- `npm run check`

## Manual verification
- Profile startup, search, timeline scroll, active workout logging, report generation, and sync on target Android device plus web browser.

## Risks and rollback
- Risk: premature caching creates stale data. Prefer measured bottleneck fixes with invalidation tests.
- Rollback by disabling caches or reverting targeted optimizations.

## Completion update
- Mark REL-003 complete here and in TASK_INDEX.md.
- Update release gates with final measured budgets.
