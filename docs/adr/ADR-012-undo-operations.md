# ADR-012: Undo Operations Architecture

## Context
Users make mistakes. We need a reliable way to offer "Undo" functionality for recent actions (e.g., accidental deletion).

## Decision
We decided to use an operations log.

## Options Considered

### Operations log (Selected)
- **Pros:** Simple to implement using previous/new JSON states, naturally bounded retention (we only keep the last N operations).
- **Cons:** Requires a structured way to serialize and deserialize state changes.

### Event sourcing
- **Pros:** Built-in undo for free.
- **Cons:** Unbounded complexity, radically changes the entire application architecture.

### Command pattern
- **Pros:** Standard object-oriented approach.
- **Cons:** Doesn't inherently capture state easily across app restarts without additional persistence layers.

## Consequences
- We can offer localized, session-persistent undo capabilities without over-engineering the core data model.
