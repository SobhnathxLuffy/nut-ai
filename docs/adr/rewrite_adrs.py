import os

adrs = {
    "ADR-001-monorepo-tooling.md": """# ADR-001: Monorepo Tooling

## Context
As we scale our workspace across multiple applications and packages, we need a reliable monorepo tool to manage dependencies, orchestrate builds, and share code efficiently.

## Decision
We decided to adopt npm workspaces.

## Options Considered

### npm workspaces (Selected)
- **Pros:** Zero configuration required, comes built-in with node, and it's already working well for our initial setup.
- **Cons:** Slower build times compared to caching solutions, less advanced graph visualization.

### Turborepo
- **Pros:** Significantly faster builds via caching, excellent task orchestration.
- **Cons:** Adds another layer of tooling and configuration overhead.

### Nx
- **Pros:** Highly graph-aware, powerful generators, robust plugin ecosystem.
- **Cons:** Extremely complex, steep learning curve, overkill for our current scale.

### pnpm
- **Pros:** Faster installs, strict dependency resolution, disk-space efficient.
- **Cons:** Introduces a different lockfile format, requires team to install a new package manager.

## Consequences
- We rely on native npm features, reducing our dependency tree.
- Build times may increase as the repository grows.
""",
    "ADR-002-mobile-database.md": """# ADR-002: Mobile Database Architecture

## Context
Our application relies on a large dataset of food and exercise information (the corpus) and user-generated data. We need to decide how to structure the local SQLite database for the mobile app.

## Decision
We decided to use a two-database architecture.

## Options Considered

### Two-db (Selected)
- **Pros:** The read-only corpus is never corrupted by user writes and can be shipped as a pre-bundled asset.
- **Cons:** Requires cross-database querying (ATTACH DATABASE) or application-level joins, adding some query complexity.

### Single-db
- **Pros:** Simpler queries, no need to attach databases.
- **Cons:** Risk of corrupting the entire database including the corpus if a migration or user write fails.

## Consequences
- We can ship updates to the corpus DB independently of the user DB.
- User data backup/restore is simpler since the DB size is smaller.
""",
    "ADR-003-web-stack.md": """# ADR-003: Web Stack Selection

## Context
We need a web stack for our browser-based client that supports offline-first capabilities, local databases, and shares code with our mobile clients.

## Decision
We decided to use Vite + React.

## Options Considered

### Vite + React (Selected)
- **Pros:** Full control over the build process, excellent support for OPFS (Origin Private File System) SQLite for offline functionality.
- **Cons:** Requires manual setup for routing and some boilerplate that a framework would handle.

### Expo Web
- **Pros:** Maximum code sharing with the React Native mobile app.
- **Cons:** Poor support for robust SQLite implementations in the browser, weak offline and desktop-class UX.

### Next.js
- **Pros:** Excellent developer experience, robust routing, large ecosystem.
- **Cons:** Server-Side Rendering (SSR) is unnecessary and actively counterproductive for an offline-first, local-database application.

## Consequences
- Web and mobile codebases will share business logic but may diverge on some UI/platform integrations.
- Superior performance and reliability for offline web users.
""",
    "ADR-004-identity-strategy.md": """# ADR-004: Identity and Primary Key Strategy

## Context
We need a robust primary key strategy for our distributed, offline-first data model that supports syncing without conflicts.

## Decision
We decided to use UUIDv7 while keeping integer PKs alongside them.

## Options Considered

### UUIDv7 (Selected)
- **Pros:** Time-ordered (excellent for database index locality), standard RFC, 128-bit uniqueness.
- **Cons:** Slightly larger storage footprint than integers.

### UUIDv4
- **Pros:** Standard, completely random.
- **Cons:** Terrible for database index performance due to random distribution.

### ULID / CUID2
- **Pros:** Time-ordered, compact string representations.
- **Cons:** Non-standard (or less standard than UUIDv7).

### Replace integer PKs entirely
- **Pros:** Single primary key format.
- **Cons:** Destructive migration, significant performance hit (SQLite integer PKs are 2x faster for JOINs).

## Consequences
- We get the best of both worlds: integer IDs for fast local JOINs and UUIDv7s for global uniqueness and syncing.
""",
    "ADR-005-nutrition-source-adapter.md": """# ADR-005: Nutrition Source Architecture

## Context
We integrate with multiple nutrition data sources (e.g., IFCT, USDA). We need a strategy to ingest, normalize, and query this data.

## Decision
We decided to use the adapter pattern for nutrition sources.

## Options Considered

### Adapter Pattern (Selected)
- **Pros:** Clean separation of concerns, allows per-source license tracking, supports independent update cycles for different sources.
- **Cons:** Requires writing and maintaining a separate adapter for each source.

### Monolithic Table
- **Pros:** Simplest schema, easy to query.
- **Cons:** Loses data provenance, making it difficult to respect source-specific licenses or track updates accurately.

### GraphQL Federation
- **Pros:** Highly flexible querying across disparate data models.
- **Cons:** Massive over-engineering for a local-first application, adds unnecessary latency and complexity.

## Consequences
- Each data source remains isolated, ensuring high data integrity.
- Adding a new source requires explicit adapter implementation.
""",
    "ADR-006-ifct-integration.md": """# ADR-006: IFCT Data Integration

## Context
The Indian Food Composition Tables (IFCT) is a critical dataset for our application. We need to decide how to deliver this data to mobile users.

## Decision
We decided to bundle the IFCT data directly in the app.

## Options Considered

### Bundle in app (Selected)
- **Pros:** Works completely offline immediately upon installation, zero network dependency for core functionality.
- **Cons:** Increases the initial app download size (APK/IPA).

### Fetch on demand
- **Pros:** Smaller initial app download size.
- **Cons:** Breaks our core offline-first philosophy; users cannot use the app without an initial network connection.

### Companion download
- **Pros:** Keeps app small, allows selective downloading.
- **Cons:** Introduces significant user friction; users have to wait and manually manage data packs.

## Consequences
- Excellent out-of-the-box user experience.
- App binary size will be moderately larger.
""",
    "ADR-007-recipe-versioning.md": """# ADR-007: Recipe Versioning

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
""",
    "ADR-008-universal-search.md": """# ADR-008: Universal Search Engine

## Context
Users need to search across foods, exercises, and custom recipes rapidly, entirely offline.

## Decision
We decided to use SQLite FTS5.

## Options Considered

### SQLite FTS5 (Selected)
- **Pros:** Operates entirely offline, requires no separate server, supports the Porter stemmer, and allows trigram fallback for typos.
- **Cons:** Less advanced relevance tuning out-of-the-box compared to dedicated search engines.

### Elasticsearch
- **Pros:** Enterprise-grade search capabilities, complex aggregations.
- **Cons:** Requires a dedicated server, utterly incompatible with our offline-first architecture.

### Algolia
- **Pros:** Incredible developer experience, fast out of the box.
- **Cons:** Cloud-only, SaaS dependency, fails the offline-first requirement.

### In-memory
- **Pros:** Trivial to implement for small datasets.
- **Cons:** Won't scale to the size of our food and exercise corpus without causing memory issues on low-end devices.

## Consequences
- Search is fast, private, and works everywhere.
- We must manually tune our FTS match queries to ensure good relevance.
""",
    "ADR-009-training-domain.md": """# ADR-009: Training Domain Schema

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
""",
    "ADR-010-pr-derivation.md": """# ADR-010: Personal Record (PR) Derivation

## Context
Users want to know their all-time best lifts (Personal Records). We need a performant way to calculate and display this.

## Decision
We decided to use persisted records for PRs.

## Options Considered

### Persisted records (Selected)
- **Pros:** Extremely fast reads, recalculation only happens asynchronously upon data correction or new entries.
- **Cons:** Requires cache invalidation and background computation logic.

### Pure derived (compute on demand)
- **Pros:** Always accurate, zero cache invalidation logic needed.
- **Cons:** Slow for full history scans, especially as the user's data grows over years.

### Materialized view
- **Pros:** The database handles the complexity of caching and updating.
- **Cons:** SQLite does not natively support true materialized views with automatic refreshing.

## Consequences
- The UI can display PRs instantly.
- We must maintain robust background tasks to update the PR tables when historical data changes.
""",
    "ADR-011-timeline-strategy.md": """# ADR-011: Timeline Aggregation Strategy

## Context
The user's daily timeline displays foods eaten, exercises performed, and body measurements.

## Decision
We decided to use a UNION view.

## Options Considered

### UNION view (Selected)
- **Pros:** No data duplication, the timeline is always strictly consistent with the underlying tables.
- **Cons:** Complex view definition, can be slightly slower than a dedicated table for very large day queries.

### Dedicated timeline table
- **Pros:** Very fast reads.
- **Cons:** Duplicates data across domains, high risk of sync complexity and data anomalies (e.g., an entry deleted in the food table but orphaned in the timeline table).

### Event-sourced
- **Pros:** Natural fit for a timeline.
- **Cons:** Too complex to retro-fit and complicates simple CRUD operations.

## Consequences
- The timeline is guaranteed to reflect the truth of the domain tables.
""",
    "ADR-012-undo-operations.md": """# ADR-012: Undo Operations Architecture

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
""",
    "ADR-013-sync-architecture.md": """# ADR-013: Synchronization Architecture

## Context
While offline-first, users eventually want their data backed up or synced across devices.

## Decision
We decided to use Supabase.

## Options Considered

### Supabase (Selected)
- **Pros:** Provides Postgres, Row Level Security (RLS), real-time subscriptions, and storage out of the box; open-source and standard SQL.
- **Cons:** Requires maintaining a Postgres instance and mapping SQLite schema to Postgres.

### Firebase
- **Pros:** Excellent SDKs, massive scale.
- **Cons:** Vendor lock-in, Firestore is not SQL, mismatch with our local SQLite architecture.

### Custom server
- **Pros:** Total control.
- **Cons:** Huge engineering effort to build robust sync, auth, and real-time features from scratch.

### CRDTs
- **Pros:** True masterless sync, mathematically sound.
- **Cons:** Massive overkill for personal health data; most user data has a single writer (the user).

## Consequences
- We leverage standard relational database technologies on both the client and server.
""",
    "ADR-014-ai-providers.md": """# ADR-014: AI Provider Integration

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
""",
    "ADR-015-photo-storage.md": """# ADR-015: Photo Storage Strategy

## Context
Users can take photos of their meals and progress pictures.

## Decision
We decided on local-first storage with opt-in lazy sync.

## Options Considered

### Local-first with opt-in sync (Selected)
- **Pros:** Respects user privacy, works flawlessly offline, saves user bandwidth unless explicitly requested.
- **Cons:** Device storage can fill up if the user takes many photos.

### Immediate cloud
- **Pros:** Prevents data loss if the device is destroyed.
- **Cons:** Serious privacy violation for sensitive progress pictures, breaks the offline experience.

### Lazy sync
- **Pros:** Good middle ground, syncs when on WiFi.
- **Cons:** Can lead to unpredictable sync states and confusing UX if not communicated clearly.

## Consequences
- User privacy is prioritized by default.
""",
    "ADR-016-health-adapters.md": """# ADR-016: Health Platform Integration

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
""",
    "ADR-017-units-and-dates.md": """# ADR-017: Canonical Units and Dates

## Context
Users expect to see data in their local units (lbs vs kg, oz vs ml) and timezones.

## Decision
We decided to use metric as canonical storage, with dual presentation.

## Options Considered

### Metric canonical (Selected)
- **Pros:** Matches primary scientific data sources (IFCT, USDA), India-first alignment, prevents precision loss during arithmetic.
- **Cons:** Requires strict conversion layers at the UI boundary for imperial users.

### Imperial canonical
- **Pros:** Matches US user expectations.
- **Cons:** Would require constant conversion for Indian users and misaligns with scientific databases.

### Dual storage
- **Pros:** Fast reads for both user bases.
- **Cons:** Redundant storage, high risk of drift and inconsistency.

## Consequences
- All database columns and backend services strictly speak metric and UTC.
- UI components are strictly responsible for localization.
""",
    "ADR-018-health-score-removal.md": """# ADR-018: Health Score Deprecation

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
""",
    "ADR-019-observability.md": """# ADR-019: Observability and Telemetry

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
""",
    "ADR-020-testing-stack.md": """# ADR-020: Testing Framework

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
"""
}

# Write ADRs
for filename, content in adrs.items():
    filepath = os.path.join('/home/sobhnath/Music/nut ai/nut-ai/docs/adr/', filename)
    with open(filepath, 'w') as f:
        f.write(content)

readme_content = """# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records (ADRs) for the project. An ADR is a short document capturing an important architectural decision made along with its context and consequences.

## Index

- [ADR-001: Monorepo Tooling](ADR-001-monorepo-tooling.md)
- [ADR-002: Mobile Database Architecture](ADR-002-mobile-database.md)
- [ADR-003: Web Stack Selection](ADR-003-web-stack.md)
- [ADR-004: Identity and Primary Key Strategy](ADR-004-identity-strategy.md)
- [ADR-005: Nutrition Source Architecture](ADR-005-nutrition-source-adapter.md)
- [ADR-006: IFCT Data Integration](ADR-006-ifct-integration.md)
- [ADR-007: Recipe Versioning](ADR-007-recipe-versioning.md)
- [ADR-008: Universal Search Engine](ADR-008-universal-search.md)
- [ADR-009: Training Domain Schema](ADR-009-training-domain.md)
- [ADR-010: Personal Record (PR) Derivation](ADR-010-pr-derivation.md)
- [ADR-011: Timeline Aggregation Strategy](ADR-011-timeline-strategy.md)
- [ADR-012: Undo Operations Architecture](ADR-012-undo-operations.md)
- [ADR-013: Synchronization Architecture](ADR-013-sync-architecture.md)
- [ADR-014: AI Provider Integration](ADR-014-ai-providers.md)
- [ADR-015: Photo Storage Strategy](ADR-015-photo-storage.md)
- [ADR-016: Health Platform Integration](ADR-016-health-adapters.md)
- [ADR-017: Canonical Units and Dates](ADR-017-units-and-dates.md)
- [ADR-018: Health Score Deprecation](ADR-018-health-score-removal.md)
- [ADR-019: Observability and Telemetry](ADR-019-observability.md)
- [ADR-020: Testing Framework](ADR-020-testing-stack.md)

## How to Create a New ADR

1. Create a new markdown file in this directory.
2. Use the numbering convention: `ADR-XXX-short-title.md` where `XXX` is the next available sequential number (e.g., `ADR-021-new-feature.md`).
3. Follow the standard template structure:
   - **Context**: What is the problem?
   - **Decision**: What did we decide?
   - **Options Considered**: Specific alternatives with real pros/cons.
   - **Consequences**: What happens next?
4. Update the Index in this `README.md` to include your new ADR.

## Status Lifecycle

ADRs progress through the following statuses:
- **Proposed**: Under review, pending approval.
- **Accepted**: Approved and ready for implementation, or already implemented.
- **Deprecated**: No longer relevant or supported, but kept for historical context.
- **Superseded**: Replaced by a newer ADR (reference the new ADR).
"""

with open('/home/sobhnath/Music/nut ai/nut-ai/docs/adr/README.md', 'w') as f:
    f.write(readme_content)

print("Done writing ADRs")
