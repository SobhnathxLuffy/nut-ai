# Draft-Graduation Round — every dish-KB recipe is now CURATED (2026-09-28)

## The two briefs

> "you need to fix every draft recipe there is with unverified nutrition,
> attach verified ingredients there, map them with the ingredients specified
> correctly for each and every one of them, and if those ingredients are
> genuinely not in the databases, then add them from a good database, correct
> each one of these draft recipes"

> "the ingredients are only being searched from the usda database and not from
> anywhere else"

## What was verified on main before fixing

- **Ingredient search was NOT literally USDA-only at the engine level** — the
  previous round already fans every query out to user foods + IFCT + USDA.
  The real defect was subtler: for common kitchen words the IFCT cohort
  silently returned **zero rows** because the corpora name those foods in
  different English words. Corpus probe: `curd` → 0 IFCT rows (dahi/yogurt
  absent from the IFCT subset), `methi` → 0 (corpus says "Fenugreek leaves"),
  `chana` → 0 ("Bengal gram"), `mutton` → 0 ("Goat, shoulder"), `hing` → 0
  ("Asafoetida"), `besan` → 0, `maida` → 0, `sabudana` → 0, plus `butter`,
  `cream`, `cheese`, `toor`, `moong`, `urad`, `masoor`. A user typing those
  words saw only USDA rows — which is exactly what they reported.
- **Draft recipes**: the shipped KB held 362 records — 50 hand-curated with
  deterministic nutrition, **312 `DRAFT_CURATED` with 1,070 of 1,441 slots
  unmapped** and generic labels (`added_fat` ×107, `added_fat_optional` ×94,
  `aromatics` ×83, `primary_vegetable` ×52 …). `computeDishNutrition` fails
  closed for such records, so 312/362 dishes showed "unverified nutrition".
- **Every CURATED mapping was re-validated against the shipped corpora** —
  all 371 previously-mapped ids resolve with usable energy. The audit also
  caught two pin-list errors that had passed existence-only validation:
  `sarson` → `ifct:C030` ("Pumpkin leaves, tender"; real mustard greens are
  `ifct:C026`) and `tinda` → `ifct:D066` (pumpkin; real tinda is
  `ifct:D073`). Both fixed in `pinned-ingredients.mjs`.

## The fixes

### 1. Synonym-expanded ingredient search (`apps/mobile/src/data/ingredient-options.ts`)

`expandIngredientTerm` builds up to 5 query variants per input: the raw term,
its canonicalisation through the dish-resolver alias table (`methi` →
`fenugreek`), and bidirectional corpus-naming synonyms (120+ pairs:
`curd` ↔ `yogurt`, `brinjal` ↔ `eggplant`, `peanut` ↔ `groundnut`, `besan` ↔
`chickpea flour`, `mutton` ↔ `goat meat`, `sabudana` ↔ `sago`, …). Every
variant runs against every corpus; results merge with per-corpus caps and
dedupe. Regression-locked by `ingredient-options.test.ts` (12 tests) and a
Playwright journey asserting `methi` surfaces IFCT "Fenugreek leaves" and
`curd` surfaces USDA yogurt rows.

### 2. Draft graduation (`tools/indian-dishes/curate-drafts.mjs`, wired into `data:build`)

Each `DRAFT_CURATED` record is graduated with three decision layers, in
priority order:

1. **~150 audited per-dish overrides** (`OVERRIDES`): naan/kulcha/bhatura/
   luchi are maida; Butter/Cheese Naan carry butter; puri/luchi/bhatura carry
   absorbed frying oil; millet rotis map to bajra/jowar/ragi/maize; sabudana
   khichdi/vada use `usda:169717` "Tapioca, pearl, dry"; Kadhi's base slot is
   yogurt; chilla/khaman/khandvi bases map to besan or dal; every biryani
   carries its named protein in the mix-in slot; Dahi Vada/Dahi Puri/Tandoori
   Momos map yogurt; chowmein/hakka noodles map `usda:168919`; bun/mask/
   dabeli/misal-pav breads map `usda:325871`; boiled sweets (rasgulla,
   rajbhog, rasmalai, mishti doi, sandesh) explicitly carry NO frying fat;
   Misal Pav and Chole Kulche carry water-adjusted yields (their gravy water
   cannot be a slot in this family); the 5 regional dishes (Eromba, Singju,
   Dal Pitha, Pittha, Dhuska) received bespoke slot sets — Eromba's fermented
   fish maps to `usda:168052` (dried-fish reference row), Singju to green
   cabbage, the Bihari pithas to rice + chana dal.
2. **Name-derived mappings**: the dish's own name donates the ingredient
   ("Aloo Matar" → potato + peas) through the corpus-validated pin list.
3. **Family models** (`FAMILY_MODELS`): verified amount fractions, cooked
   yields, and standard portions adopted from the reviewed CURATED exemplars
   of the same family (bread ← Roti/Phulka/Aloo Paratha; cooked_grain ← Lemon
   Rice/Khichdi; legume ← Dal Tadka; batter ← Idli/Dosa; vegetable ← Chokha;
   paneer ← Paneer Butter Masala; protein ← Chicken Curry/Tikka; street_snack
   ← Samosa; sweet ← Gulab Jamun), all `assumptionClass: CURATED_PRIOR`.

The pass preserves each record's original slot roles (schema enum), drops the
stale ambiguity candidate lists, and sets verified yields/portions +
`numericRatiosVerified` + `AUTO_MAPPED` statuses. Result: **312/312
graduated, 0 stayed DRAFT** (25 name-derived + 468 reviewed-override + 750
family-prior slot decisions). Per-dish evidence ships at
`docs/data/indian-dishes.curation-report.json`.

### 3. Genuinely-missing ingredients from a good database

Both corpora were probed exhaustively for every ingredient word the
mappings and the search need. Exactly two are absent from BOTH: plain tea and
brewed coffee. `build-sqlite.mjs` now ensures two supplemental rows in a
dedicated `fdc_supplemental` source with USDA FoodData Central reference
values — `usda:SUP-TEA-001` (Tea, black, brewed, plain) and
`usda:SUP-COF-001` (Coffee, brewed, plain) — idempotent across rebuilds. The
`fdc_%` source pattern means the USDA source, resolver, and mapping loader
treat them as ordinary `usda:` foods with zero special-casing. Corpus count:
7,928 → **7,930**.

### 4. Search rows show the deterministic numbers

`DishKBSource.search` now computes (and memoizes) the same per-100 g
nutrition `resolveById` produces, so every CURATED dish surfaces its real
kcal directly in the search list. Previously the row showed "Nutrition shown
during review" even when the number was fully computable. Draft rows stay
energyless by design — but none remain.

### 5. Gates hardened so the graduation cannot silently regress

`verify-mappings.mjs` additionally hard-fails on any CURATED record that is
under-verified (unmapped slot, unverified amount prior, missing yield/portion
verification, stale template status) and on any DRAFT record with zero
verified mappings. `validate.mjs` now cross-checks the re-stated mapping
report (1,443 slots; 362 CURATED; 0 ambiguous; 0 unresolved) while preserving
the original deep-validation set untouched.

## Aggressive verification performed

- Real-corpus probe of 101 common ingredient words before and after the alias
  fix (coverage 58 → effectively complete for search purposes).
- All 1,443 mapped slots resolved against the shipped corpora (1,061 IFCT +
  382 USDA), 0 hard errors, 1 reviewed sanity warning (Avial's fat slot is
  coconut milk at 197 kcal — a deliberate reviewed choice, reported not
  failed).
- 64 representative graduated dishes across all 11 families computed through
  `computeDishNutrition` exactly as the app does — 64/64 with plausible
  numbers; implausible outliers found this way (boiled sweets inheriting the
  fried-sweets ghee slot; usal-based street foods with unmodeled gravy water)
  were fixed at the override layer and re-verified.
- Full `npm run check`: **667/667 tests (82 files)**, lint 0 warnings, strict
  typecheck, node purity 18/18, data:verify 26/26 (7,930 foods), IFCT 542,
  indian-dishes verify (362 dishes/1,443 slots), mapping verification
  1,443/1,443 — exit 0.
- Fresh web export + Playwright: **20 passed + 2 skipped** including two new
  journeys (synonym ingredient search; "Aloo Matar" resolves with a
  deterministic kcal in the search row).
