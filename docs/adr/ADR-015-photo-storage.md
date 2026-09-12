# ADR-015: Photo Storage Strategy

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
