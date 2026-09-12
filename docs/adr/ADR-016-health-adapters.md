# ADR-016: Health Platform Integration

## Context
We need to read step counts and active energy from Apple HealthKit and Android Health Connect.

## Decision
We decided to build an abstraction layer over the health APIs.

## Options Considered

### Abstraction layer (Selected)
- **Pros:** Allows sharing core business logic between platforms, enables capability-gating fields if one platform lacks a specific metric.
- **Cons:** Adds a layer of indirection.

### Direct API calls
- **Pros:** Maximum access to platform-specific features.
- **Cons:** Leads to massive platform-specific code duplication and tangled React Native modules.

## Consequences
- The core app queries a unified `HealthService`, agnostic of whether it is running on iOS or Android.
