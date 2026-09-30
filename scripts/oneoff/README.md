# one-off scripts

Already-applied data patches and postmortem reports (QA P3-D18). They are
KEPT for the audit trail but are NOT re-runnable gates — re-running a patch
whose fix is already baked into the shipped artifacts/sources either no-ops
or corrupts state.

Live gates live in `scripts/` proper and are wired into `npm run check`:

- `audit-ingredient-density.mjs`
- `audit-filling-slots.mjs`
- `verify-composer-equivalence.mjs`
- `check-node-purity.mjs`
- `patch-expo-modules-jsi.mjs` (postinstall hook)

Everything in `oneoff/`:

- `report-before-after.mjs` — before/after diff report for a past fix round.
- `fix-incoherent-yields.mjs` — one-time yield-coherence patch (applied).
- `add-missing-fillings.mjs` — one-time fillings patch (applied).
