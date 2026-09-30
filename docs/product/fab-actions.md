# FAB quick actions — rationale

Moved here from `apps/mobile/app/(tabs)/_layout.tsx` (QA P3-U14: product
rationale belongs in docs, not a 13-line comment in code).

## GROUPS IS GONE

A social feed cannot be local-first without a server we operate, it needs
Apple 1.2 moderation machinery before it can ship at all, and it is the
highest eating-disorder-risk surface in this product category. Cutting it is
the decision, not a gap.

## The FAB is ALWAYS present and ALWAYS opens real logging

The reference paywalls this button, which is the direct cause of its
most-reported complaint. No IAP is configured anywhere in this project, which
is what leaves App Store Guideline 3.1.1 nothing to attach to.

## Distinct icons (P3-U14)

"Food Database" uses `bars` (a catalogue listing) and "AI Assistant" uses
`sparkle`-adjacent `lotus`… see `_layout.tsx` for the current mapping; the
point is that no two actions in the sheet may share an icon, because the
quick-action sheet is navigated visually at arm's length.
