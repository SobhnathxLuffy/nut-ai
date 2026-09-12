# ADR-019: Observability and Telemetry

## Context
We need to know if the app is crashing and what features are being used, without violating user privacy.

## Decision
We decided to implement privacy-safe structured events.

## Options Considered

### Privacy-safe structured events (Selected)
- **Pros:** Provides critical diagnostic value without leaking any personal data (PII) or user content (e.g., specific food names).
- **Cons:** Requires discipline to define and maintain the event schema.

### Full telemetry
- **Pros:** Deep insight into user behavior.
- **Cons:** Severe privacy violation for a health app, risks leaking sensitive logs.

### None
- **Pros:** Perfect privacy.
- **Cons:** Completely blind to crashes and bugs in production.

## Consequences
- We can track app stability and feature adoption safely.
