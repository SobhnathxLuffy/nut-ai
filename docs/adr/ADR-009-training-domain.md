# ADR-009: Training Domain Schema

## Context
We are expanding the app to track resistance training, moving beyond simple cardio/calorie tracking.

## Decision
We decided to create new dedicated tables for the training domain.

## Options Considered

### New tables (Selected)
- **Pros:** Clean schema, properly models the set/rep/load domain, prevents polluting the nutrition/cardio tables.
- **Cons:** Requires more upfront schema design and UI work.

### Extend exercise_entries
- **Pros:** Keeps the number of tables low.
- **Cons:** Would require breaking changes to the existing calorie-only schema, leading to a messy, sparsely-populated table.

### Separate database
- **Pros:** Maximum isolation.
- **Cons:** Unnecessary isolation; users frequently want to view nutrition and training data together on the same timeline.

## Consequences
- Training data is robustly modeled and can evolve independently of diet tracking.
