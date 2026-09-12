# MIC-002: Micronutrient UI and Missing Data States

Status: unstarted
Phase: 8 - Reports, micronutrients, and health adapters
Depends on: NUT-002, TLN-003
Parallel-safe with: TLN-004
Conflicts likely in: Food details, Progress reports, data quality copy
Requirement links: docs/planning/02_PRODUCT_SPEC.md section 13; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 39, 41
ADR links: docs/adr/ADR-005-nutrition-source-adapter.md

## Outcome
Food details and reports show micronutrient amounts, units, provenance, and missing-data coverage without treating unknowns as zeros.

## Why now
The storage model exists and report payloads can expose coverage; users need clear inspection surfaces.

## In scope
- Add micronutrient rows to food detail and report views.
- Show coverage score and unknown/estimated states.
- Link to source/provenance details where available.

## Out of scope
- Medical dosing advice.
- Supplement marketplace features.
- Data quality inspector tooling beyond user-facing display.

## Files expected to change
- Existing: Food detail UI, Progress reports, report formatting utilities.
- Proposed: micronutrient display fixtures.

## Data/migration impact
- No new migration expected beyond NUT-002.
- User display preferences may be backed up if persisted.
- Rollback hides micronutrient sections.

## Implementation contract
- Unknown values render as unknown, not 0.
- Units must be canonical and localized consistently.
- Low coverage must be visible before comparing days.

## Acceptance criteria
- Given unknown vitamin data, then UI displays unknown with coverage context.
- Given a known zero nutrient, then UI displays 0 with provenance.
- Given low coverage day, then reports warn about incomplete micronutrient interpretation.

## Tests required
- Component tests for known zero, unknown, estimated, and measured states.
- Accessibility tests for tables/lists.
- Snapshot tests for report micronutrient sections.

## Commands
- `npm run test -- --run micronutrient-ui`
- `npm --prefix apps/mobile run typecheck`
- `npm run check`

## Manual verification
- View micronutrients for foods and days with full, partial, and no coverage.

## Risks and rollback
- Risk: users misread unknown as poor intake. Keep visual distinction clear and neutral.
- Rollback by hiding micronutrient panels.

## Completion update
- Mark NUT-003 complete here and in TASK_INDEX.md.
- Update UX docs if display placement changes.
