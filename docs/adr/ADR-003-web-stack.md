# ADR-003: Web Stack Selection

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
