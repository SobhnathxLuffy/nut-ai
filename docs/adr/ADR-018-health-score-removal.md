# ADR-018: Health Score Deprecation

## Context
We previously provided an aggregated "Health Score", which proved arbitrary and unscientific.

## Decision
We decided to remove the health score entirely.

## Options Considered

### Remove entirely (Selected)
- **Pros:** Aligns with our "no meaningless score" principle, forces focus on actionable metrics.
- **Cons:** Some users who liked the gamification might be upset.

### Deprecate gradually
- **Pros:** Softer landing for users.
- **Cons:** Confuses users, extends the maintenance lifetime of bad code.

### Make optional
- **Pros:** Pleases everyone.
- **Cons:** Adds significant maintenance burden to support a feature we philosophically disagree with.

## Consequences
- The UI is simplified, focusing purely on objective metrics (calories, macros, sets, reps).
