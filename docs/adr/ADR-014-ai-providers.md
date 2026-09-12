# ADR-014: AI Provider Integration

## Context
We use LLMs for parsing natural language food logs and generating recipes.

## Decision
We decided to use a multi-provider adapter approach.

## Options Considered

### Multi-provider adapter (Selected)
- **Pros:** High resilience (fallback on outage), allows user choice, enables cost optimization by routing simpler tasks to cheaper models.
- **Cons:** Requires maintaining multiple API clients and normalizing disparate API responses.

### Single provider
- **Pros:** Simplest implementation, deep integration with specific features (e.g., OpenAI functions).
- **Cons:** Fragile to outages, potential vendor lock-in, no leverage on pricing.

### Router service
- **Pros:** Centralizes the logic off-device.
- **Cons:** Adds an unnecessary server dependency, increasing latency and operational burden.

## Consequences
- We can swap models and providers dynamically based on performance and cost.
