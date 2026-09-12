# TLN-004: Progress Dashboard and Combined Charts

Status: unstarted
Phase: 8 - Reports, micronutrients, and health adapters
Depends on: TLN-003, TRN-004
Parallel-safe with: NUT-003
Conflicts likely in: Progress tab, chart contracts, mobile/web responsive UI
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 3, 10, 12; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 18, 22, 37
ADR links: docs/adr/ADR-011-timeline-strategy.md

## Outcome
Progress dashboards display report summaries and combined charts for nutrition, training, and body metrics without implying false causality.

## Why now
The report engine exists and the PR engine exists; chart surfaces can now show real computed data.

## In scope
- Add dashboard cards and combined chart contracts.
- Support overlays such as protein intake versus squat e1RM.
- Add empty, sparse-data, loading, and offline states.

## Out of scope
- AI-generated conclusions.
- PDF export.
- Wearable sync.

## Files expected to change
- Existing: Progress tab, web Progress route, chart utilities.
- Proposed: chart fixtures and visual tests.

## Data/migration impact
- No schema migration expected.
- Chart preferences may be backed up if persisted.
- Rollback hides dashboard sections.

## Implementation contract
- Charts must show source range, excluded days, units, and unavailable values.
- Axes and legends must be accessible and readable on small screens.
- No arbitrary 0-100 health/readiness score can be introduced.

## Acceptance criteria
- Given report data, then dashboard summaries match TLN-003 payloads.
- Given sparse data, then the chart renders gaps rather than connecting false points.
- Given screen reader mode, then chart summaries are available as text.

## Tests required
- Component tests for chart data mapping.
- Accessibility tests for summaries and controls.
- Visual smoke tests at mobile and desktop widths.

## Commands
- `npm run test -- --run progress-dashboard`
- `npm --prefix apps/mobile run typecheck`
- `npm --prefix apps/web run build`
- `npm run check`

## Manual verification
- Inspect Progress dashboard with dense, sparse, and empty data on Android and web.

## Risks and rollback
- Risk: charts overstate relationships. Keep copy descriptive and avoid causal conclusions.
- Rollback by reverting dashboard route adoption.

## Completion update
- Mark TLN-004 complete here and in TASK_INDEX.md.
- Update UX docs with final dashboard inventory.
