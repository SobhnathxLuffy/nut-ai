# Product round — multi-source search, decomposer v2, mapping verification (2026-09-28)

Scope: five user-reported product defects around search source merging, the
decompose flow, and dish→ingredient mapping trust. Every item was first
verified against current main, then fixed, then locked with unit + e2e tests,
then gated.

## 1. Search shows only one database (cascade) — FIXED

- Root cause: `RouterSource.search` returned the first source's rows and
  stopped (`first source wins`), so a single query could never show USDA and
  IFCT results together.
- Fix (`packages/nutrition-sources/src/router-source.ts`):
  - fan out to ALL sources in parallel, per-corpus cap 15 rows,
  - merge in priority order, honoring per-row priority (dish KB grades) via
    `Math.max(row, class)`,
- Fix (`packages/resolver/src/scoring.ts`): `normalizeBm25` normalizes within
  each source cohort — cross-corpus BM25 magnitudes are never compared.
- Fix (`packages/resolver/src/index.ts`): the auto-accept decision is gated to
  the highest-priority source tier present (preserves the P0-2 contract that a
  dish-KB identity outranks generic USDA rows; golden queries pass
  unmodified), and `ResolveResult.topCandidates` exposes the merged ranked
  list so the UI can show every database's matches.
- UI (`apps/mobile/app/food-search.tsx`): result list renders `topCandidates`
  with per-source labels.
- Tests: `multi-source.test.ts` updated to the merged contract (both corpora
  visible, user food first); new e2e `multi-source search` journey asserts
  both IFCT and USDA labels in one result list.

## 2. Decompose only had one ingredient slot — FIXED

- Engine (`packages/indian-dishes/src/unknown-dish.ts`):
  - `extraIngredients: Array<{foodId, grams}>` — unlimited ingredients,
    deduped by food id with grams summed,
  - `userfood:` ids accepted (custom ingredients join the arithmetic),
  - `ingredientBreakdown` — per-ingredient kcal/P/C/F scaled to the portion,
  - `resolveCookedYieldGrams` exported as the single yield model.
- UI (`apps/mobile/app/food-search.tsx`): multi-ingredient rows with editable
  grams and remove buttons, quick-add chips, live searchable picker across
  user foods + IFCT + USDA (`apps/mobile/src/data/ingredient-options.ts`),
  editable oil grams, per-ingredient breakdown in the live result.
- Dish composer (`apps/mobile/app/dish-composer.tsx`):
  - fat now contributes NUTRIENTS (previously added mass while its calories
    silently vanished),
  - cooking-method yield model shared with the engine,
  - live cross-corpus ingredient search including custom foods,
  - confirmed grams/fat/method/portion persisted into the household template.
- Tests: `unknown-dish.test.ts` — multi-ingredient dedupe/sum, breakdown sums
  to serving totals, `userfood:` participation.

## 3. Saved foods must be searchable — VERIFIED + CLOSED THE GAP

- "Save to Foods" from the decomposer already wrote a custom food that
  `UserFoodSource` searches — verified.
- NEW GAP closed: "My Version" household dishes were saved to the user DB but
  no source searched them. New `HouseholdDishSource` (priority 85) makes them
  searchable and resolvable per-100 g, failing closed on missing data
  (`household-dish-source.test.ts`, 4 tests).
- Inline ingredient creation (per-100 g form) saves into the custom food DB
  via `createIngredientFood` and is immediately searchable; locked by e2e.

## 4. Verified mappings audited — ALL CORRECT

- New gate `tools/indian-dishes/verify-mappings.mjs` (wired into
  `npm run check` as `indian-dishes:verify-mappings`): resolves every mapped
  slot against the shipped corpora; hard-fails on unresolvable/empty foods;
  warns on label sanity mismatches (fat slots must be fat-dense, protein
  slots protein-rich, word-boundary matched so "eggplant" ≠ "egg").
- Result: 371/371 mapped slots resolve (157 IFCT + 214 USDA), 0 errors,
  0 warnings. Report at
  `docs/data/indian-dishes.mapping-verification.json`.

## 5. Unmapped draft dishes — name-derived suggestions shipped

- 312 draft dishes carry generic slots; blind auto-mapping would fabricate
  confidence, so the pipeline stays honest and the mapping happens at the
  interaction layer instead:
  - `tools/indian-dishes/dish-ingredient-suggestions.mjs` derives ingredients
    from each dish's own name ("Aloo Matar" → potato + peas) against a
    reviewed pin list of 68 distinct, corpus-validated IFCT ids (a stale id
    fails the script; coverage 170/312 draft dishes, 33 with ≥2 ingredients);
  - `tools/indian-dishes/build-sqlite.mjs` bakes `ingredientSuggestions` into
    every draft dish whose required slots are not already fully mapped (164
    dishes in the shipped KB);
  - the dish composer pre-seeds its ingredient list from them — each
    suggestion resolves to a real food row with nutrients, user edits grams.
- Ingredients that exist in NO database: the inline create flow covers them
  (per-100 g custom ingredient → searchable immediately).

## Gate results

`npm run check` exit 0:

- lint 0 warnings, strict typecheck (root + mobile)
- Vitest **655/655 across 81 files** (was 649/80)
- node purity 18/18, data:verify 26/26, IFCT verify 542 rows
- indian-dishes verify 362 dishes, **mapping verify 371/371**
- Playwright web e2e **18 passed + 2 fixme** (3 new journeys: multi-source
  list, decomposer multi-ingredient + cross-DB picker, custom-ingredient
  creation)
