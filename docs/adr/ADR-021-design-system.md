# ADR-021: Design System — Extension Protocol Instead of a Lucide Dependency, and the Text-Grade Split

**Status:** accepted
**Date:** 2026-10-05
**Deciders:** Wave 4 spec (Task 4-1 recon), implementing agents 4a/4d/4-6

## Context

Wave 4 of the UI/UX Transformation Report (Ch 13, Table 13.1) demanded an icon set extension, a CI contrast gate over every token pair, and primitive docs. Two of its recommendations, taken at face value, conflicted with the repo's established web-export-safety architecture and with itself:

1. Ch 6.2 recommends a **Lucide passthrough dependency** (`lucide-react-native`) for missing icon metaphors.
2. Ch 11 / Table 11.1 demand that **every colour pair passes AA** — but the app's light theme legitimately uses the same identity hues (protein blue, amber, violet, affirm green) as BOTH text and icon/stroke colours, and no single hex can sit at ≥4.5:1 as text AND keep the identity hue's artwork value for strokes. The report itself rejects "two stroke philosophies in one app" (Ch 6.2, Option-2 rejection) — the colour equivalent of the same inconsistency loomed.

## Decision

1. **No `lucide-react-native` dependency.** Missing metaphors are drawn in-house following a documented EXTENSION PROTOCOL (Icon.tsx header): take the NAME and GEOMETRY REFERENCE from the Lucide vocabulary (24px grid, 2px reference stroke) and draw at this set's 1.8 stroke. One stroke philosophy, zero new deps, no reliance on Metro tree-shaking. Precedents: Wave 1c's `bookOpen`/`sparkles`, Wave 4d's seven glyphs, the wrap's `warning`.
2. **Text-grade token split.** Identity hues (protein/carbs/fat/uncertain/affirm) stay at their artwork values for icons, ring strokes, chart series and tints (3:1 graphical tier); every `<Text>` use migrates to dedicated `*Text` slots at ≥4.5:1 (light: darker grades of the same hue; dark: the identity hexes, which already passed). `scripts/check-contrast.mjs` gates the full matrix in CI with a completeness guard, so a new or renamed slot can never silently escape the gate.

## Options Considered

### Option A: lucide-react-native passthrough (report's letter)
- Pros: complete icon vocabulary immediately; canonical geometry for free.
- Cons: a second stroke philosophy (2.0 vs the set's tuned 1.8) — the exact inconsistency the report eliminates; a new runtime dep on the Metro/bundle path with unreliable tree-shaking; ~60 existing call sites would mix two systems for years.

### Option B: in-house extension protocol (selected)
- Pros: one stroke philosophy; zero deps; the geometry discipline is enforced by Icon.test.ts; Lucide stays the naming/anatomy vocabulary so metaphors stay recognizable.
- Cons: each gap costs a hand-drawn glyph (bounded — the set reached 64 with 10 drawn since Wave 1c); the protocol must be documented or agents will reach for the dep.

### Option C: darken identity hues until they pass as text (no split)
- Pros: one slot per hue; no migration.
- Cons: kills the artwork value of the hues on strokes/tints and changes dark mode for nothing (dark already passed); amber cannot reach 4.5:1 as text without becoming brown — which is exactly what `carbsText #8F5E05` honestly is.

### Option D: `*Text` grade split (selected, paired with the CI gate)
- Pros: identity and text each get a slot at the correct WCAG tier; dark mode unchanged; the migration is mechanical (~55 sites, Wave 4a) and one-directional.
- Cons: two slots per hue — mitigated by the ESLint hex rule + the contrast gate + the "identity colour in a Text style is a violation" rule in docs/design-system.md.

## Consequences

### Positive
- Zero new UI dependencies (item (f) discipline preserved); one stroke philosophy; the AA contract is machine-checked, not eyeballed — the report's "[VERIFY] comment never has to exist again" is literally true.
- The last text glyphs standing in for symbols are dead (Ch 13 DoD), each killed by a real Icon glyph.

### Negative
- Icon gaps cost hand-drawing; a colour now has two names depending on usage (identity vs text grade).

### Risks
- An agent hand-draws a bad glyph — mitigated by the shared-stroke contract tests + adversarial path-grammar walks (Wave 4d precedent).
- An agent uses an identity slot as text colour — mitigated by the contrast gate (identity values fail the 4.5 tier it computes for text roles) and review.

## Migration Impact

Wave 4a migrated ~55 Text-style sites + Badge fg to the `*Text` slots; light `safety`/`carbs` were recomputed; `alert-web.ts`'s mirrored hexes were updated to the grades. No data or persistence impact. Dark mode renders identically (dark grades = identity hexes).

## Revisit Trigger

- A single wave needs >10 new icons → evaluate `lucide-react-native` (MIT, react-native-svg renderer, web-safe) instead of hand-drawing a library.
- A product redesign changes the identity hues → recompute both grades; the gate holds the line either way.

## Links

- Related ADRs: ADR-020 (testing stack — the gate/test pattern this builds on)
- Related specs: UI/UX Transformation Report Ch 6.2, Ch 11 / Table 11.1, Ch 12 / Table 12.1, Ch 13 Table 13.1; wave4-spec.md §4.3/§7
- Related docs: docs/design-system.md (§3.2 protocol, §2.2 slots, §6 dependency audit, §7 deviations)
