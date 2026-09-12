# WEB-003: Web Food Timeline and Training Views

Status: unstarted
Phase: 7 - Accounts, sync, Supabase, and web
Depends on: WEB-002, TLN-002, TRN-005
Parallel-safe with: None
Conflicts likely in: shared UI contracts, web routes, responsive layouts
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 2, 3, 12; docs/planning/03_REQUIREMENTS_TRACEABILITY.md rows 22, 25, 37
ADR links: docs/adr/ADR-003-web-stack.md, docs/adr/ADR-011-timeline-strategy.md

## Outcome
The web app renders usable Food, Timeline, Train, and Progress views from shared local-first data.

## Why now
The web shell and storage are ready; the first serious web surface should reuse mature mobile contracts rather than create new product behavior.

## In scope
- Implement responsive web timeline, food logging read views, workout history, and training overview.
- Add keyboard-friendly search and navigation.
- Reuse shared calculations and read models.

## Out of scope
- Mobile UI rewrites.
- Native Health adapter flows.
- Marketing pages.

## Files expected to change
- Existing: apps/web routes and components, shared timeline/training contracts.
- Proposed: web visual and route tests.

## Data/migration impact
- No new schema expected.
- Web mutations must use existing operation contracts.
- Rollback leaves web shell and storage without feature routes.

## Implementation contract
- Web UI must not duplicate nutrition or training calculations.
- Text and controls must fit at mobile, tablet, and desktop widths.
- Empty, offline, loading, conflict, and permission states must render.

## Acceptance criteria
- Given synced data, when web opens, then Food timeline and Train history render consistently with mobile read models.
- Given keyboard use, then search and route navigation are operable.
- Given offline mode, then cached local data remains visible.

## Tests required
- Web route/component tests.
- Playwright smoke tests for desktop and mobile widths.
- Shared calculation parity tests.

## Commands
- `npm --prefix apps/web run build`
- `npm run test -- --run web`
- `npm run check`

## Manual verification
- Run web locally, inspect Food, Train, Progress, and You routes at desktop and mobile widths.

## Risks and rollback
- Risk: web becomes a second product. Keep surfaces contract-driven and aligned with mobile.
- Rollback by disabling incomplete feature routes.

## Completion update
- Mark WEB-003 complete here and in TASK_INDEX.md.
- Update docs/planning/15_MOBILE_AND_WEB_UX.md with screenshots or route inventory.
