# ADR-008: Universal Search Engine

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
