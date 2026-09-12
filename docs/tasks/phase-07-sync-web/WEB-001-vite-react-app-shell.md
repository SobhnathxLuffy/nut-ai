# WEB-001: Vite React App Shell

Status: unstarted
Phase: 7 - Accounts, sync, Supabase, and web
Depends on: SYN-001
Parallel-safe with: SYN-002 after package boundary review
Conflicts likely in: workspace config, shared package exports, app routing
Requirement links: docs/planning/02_PRODUCT_SPEC.md sections 2, 3; docs/planning/03_REQUIREMENTS_TRACEABILITY.md row 25
ADR links: docs/adr/ADR-003-web-stack.md, docs/adr/ADR-001-monorepo-tooling.md

## Outcome
The repository contains a Vite React web app shell that imports only approved shared packages and builds without creating a replacement application.

## Why now
Auth contracts exist and web sync work needs an actual app target inside the existing monorepo.

## In scope
- Add apps/web using Vite and React.
- Wire workspace scripts, TypeScript, lint, and routing shell.
- Create responsive skeleton routes for Home, Food, Train, Progress, and You.

## Out of scope
- Implementing feature logic beyond route placeholders connected to real contracts.
- Landing page or marketing site.
- Deployment.

## Files expected to change
- Existing: package.json workspaces/scripts, tsconfig, node-purity checks.
- Proposed: apps/web source files and tests.

## Data/migration impact
- No database migration.
- No sync persistence until WEB-002.
- Rollback removes apps/web and workspace script entries.

## Implementation contract
- Web app must use shared domain packages, not duplicate business logic.
- It must not import React Native packages.
- First screen is the usable app shell, not marketing.

## Acceptance criteria
- Given `npm --prefix apps/web run build`, then the Vite app builds.
- Given `npm run check:node-purity`, then shared packages remain Node-pure.
- Given desktop and mobile browser widths, then the five app surfaces are navigable.

## Tests required
- Build test.
- Route smoke tests.
- Node-purity regression test.

## Commands
- `npm --prefix apps/web run build`
- `npm run typecheck`
- `npm run check`

## Manual verification
- Run the web dev server and inspect the app shell at desktop and mobile widths.

## Risks and rollback
- Risk: web setup drags UI abstractions into shared packages. Keep app-specific UI inside apps/web.
- Rollback by removing the web workspace.

## Completion update
- Mark WEB-001 complete here and in TASK_INDEX.md.
- Update docs/planning/04_TARGET_ARCHITECTURE.md with actual web app layout.
