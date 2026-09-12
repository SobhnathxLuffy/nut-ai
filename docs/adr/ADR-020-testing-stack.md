# ADR-020: Testing Framework

## Context
We need a fast, reliable testing framework for our monorepo that supports both node and browser environments.

## Decision
We decided to use Vitest with fast-check.

## Options Considered

### Vitest + fast-check (Selected)
- **Pros:** Native ESM support, incredibly fast, compatible with our Vite workspace, excellent for property-based testing.
- **Cons:** Slightly smaller ecosystem than Jest.

### Jest
- **Pros:** Industry standard, massive ecosystem.
- **Cons:** Requires complex transform configurations for ESM, slower execution.

### Mocha
- **Pros:** Highly flexible.
- **Cons:** Less integrated, requires manual wiring of assertion libraries and mocks.

## Consequences
- Developers enjoy a fast, modern testing experience that shares configuration with the build step.
