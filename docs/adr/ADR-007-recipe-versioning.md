# ADR-007: Recipe Versioning

## Context
Users create and edit recipes. Since past log entries reference these recipes, changing a recipe could alter the historical nutritional data of a user's logs.

## Decision
We decided to use an append-only versions strategy.

## Options Considered

### Append-only versions (Selected)
- **Pros:** Preserves historical accuracy for past logs without complex system overhead.
- **Cons:** Requires more storage over time as old versions accumulate.

### Mutable overwrite
- **Pros:** Simplest to implement, minimal storage.
- **Cons:** Loses historical accuracy; changing a recipe today alters the calorie counts from a year ago.

### Event-sourced
- **Pros:** Perfect audit trail, can reconstruct any state.
- **Cons:** Far too complex for this specific domain, makes querying current state significantly harder.

## Consequences
- Past diary entries remain strictly accurate.
- UI needs to communicate which version of a recipe is being viewed.
