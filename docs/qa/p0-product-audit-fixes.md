# Product QA Section-B P0 fixes — P0-1 … P0-6

Status: **every Section-B P0 closed.** Gates: 626/626 unit tests (77 files),
typecheck, lint 0 warnings, node-purity 18/18, `npm run check` exit 0 end to
end, Playwright e2e 2 passed + 2 `fixme`, web boot smoke 0 console errors.

Two Section-B items (P0-3, P0-4) were closed in the earlier web rounds — see
[p0-web-fixes.md](p0-web-fixes.md). This file records the round that closed
the remaining four, plus one deeper root cause the golden tests exposed.

---

## P0-1 — Dish composer → food review double-scaled nutrition (~60% inflated logs)

**Was:** the composer computed the portion total (`totalKcal × portionG /
cookedYield` ≈ 916 kcal for the litti case) and stuffed it into
`nutrientSnapshot.kcal`. But the food-review payload contract is **per-100 g**
("Per-100 g. Always." — same basis as `ResolvedFood`): the review renders
`snapshot × grams / 100`, producing the reported 1,465 kcal — a
`(portion/100)` over-count on every household-variant log, silently corrupting
daily totals, reports and adaptive targets.

**Fix:** new pure helper `per100Snapshot(totals, portionG)`
(`apps/mobile/src/data/dish-snapshot.ts`) converts portion totals to the
per-100 g basis, collapses to zeros on a non-positive/non-finite portion, and
treats `null` component values as unknown (0, never fabricated). The composer
sends its snapshot through it and rejects non-positive portions up front.
Contract test locks the QA's litti numbers: snapshot × 160/100 must recover
915.9 kcal, not 1,465.

**Files:** `apps/mobile/src/data/dish-snapshot.ts` (+ test),
`apps/mobile/app/dish-composer.tsx`

---

## P0-2 — Literal dish names lost to alias junk and source shadowing

The report's root cause was real but incomplete. Golden tests against the real
corpus exposed **two stacked defects**:

1. **Alias rungs before literal rungs** (the QA's finding): the resolver
   interleaved `normalizedLadder[i]` before `literalLadder[i]`, so "biryani"
   → alias 'mixed rice' matched acceptable-scoring junk before the literal
   name ever ran. **Fix:** literal-first at every depth; specific aliases
   (toor → red gram, idly → idli) still catch what the literal term misses,
   one rung later.
2. **Source-cascade shadowing** (found by the new golden tests): the dish KB
   sat at source priority 65, BELOW IFCT (80) and USDA (70). `RouterSource`
   is a hard cascade — the first source with rows ends it — so any USDA row
   sharing one FTS token with a dish name ("Bread, chapati or roti,
   commercially prepared"; "Groundcherries, (cape-gooseberries or poha)")
   shadowed the CURATED dish identity entirely. **Fix:** dish KB priority
   **75** — above the generic corpora, below IFCT so ingredient queries
   ("paneer", "rice") keep resolving to ingredient rows.
3. **KB-less artifacts must yield, not throw:** at priority 75 the KB source
   is consulted before USDA even on fixture databases without dish tables;
   `DishKBSource` now probes `sqlite_master` once and returns empty results
   instead of throwing through `resolveById`.

Regression locks: golden queries (biryani, paneer, poha, roti, rajma, upma,
idli, toor dal) assert the top hit's identity against the real bundled corpus
and ban the reported junk; the IFCT alias test keeps its red-gram-to-B021
contract via "tuvar dal" (same pulse, no curated-dish collision — "toor dal"
itself now resolves to the CURATED Toor Dal dish, which the QA's expected
behavior endorses).

**Files:** `packages/resolver/src/index.ts`,
`packages/nutrition-sources/src/dish-kb-source.ts`,
`packages/resolver/src/resolver.golden.test.ts` (new),
`packages/nutrition-sources/src/ifct-corpus.test.ts`

---

## P0-3 — Web scan journey dead-ended at Unmatched Route /scan-result

Closed in the earlier web round (= WEB-002, commit `f0ae3b0`): the camera's
web fallback routes to `/result`; the e2e suite locks the journey. Nothing
further required.

---

## P0-4 — Household variants silently never persisted (web) / corpus write contract violation

Closed in the earlier web round (= WEB-003, commit `9824c95`): variants INSERT
into the writable user DB on every platform (shared screen code), failures
alert instead of vanishing, and the corpus DB is never written. Residual,
documented for a later round: variant saves do not yet round-trip through the
operations ledger.

---

## P0-5 — `npm run check` red on clean main

The report's nine lint errors were already gone (lint is clean with
`--max-warnings=0`). But the gate was still red for a fresh-clone reason this
round fixed: `indian-dishes:verify` imported three packages' `dist/` builds
that a fresh clone has never produced, crashing with
`Cannot find module .../db-adapter/dist/node.js`.

**Fix:** `indian-dishes:verify` now chains `build:tools-pkgs` (tsc builds of
core-schema, db-adapter, indian-dishes) before running; the validator fails
with the remedy (`run npm run data:build` / `npm run ifct:build`) instead of a
raw ENOENT stack when artifacts are missing.

**Files:** `package.json`, `tools/indian-dishes/validate.mjs`

---

## P0-6 — Web bundle silently shipped without the Indian Dish KB

**Was:** `data:build` built only the USDA/IFCT corpus; the 362-dish KB compile
was a separate, undocumented step; nothing asserted dish rows in the bundled
DB. Verified on this round's start: the local artifact had **no
`dish_definitions` table at all**.

**Fix:**
- `data:build` now chains the KB compile:
  `build.mjs && build-sqlite.mjs` — one documented command produces the whole
  corpus ("Compiled 362 dishes into … nutrition.db").
- `indian-dishes:verify` carries the integrity gate the report asked for:
  bundled `dish_definitions` count must equal the 362 mapped dishes, and a
  dish-FTS probe must return a CURATED biryani row from the same database the
  app ships.
- README setup and gate descriptions updated.
- The exported web bundle now ships the 6.5 MB nutrition.db (the QA's
  "with dishes" size signature) instead of the dish-less 4.9 MB one.

**Files:** `package.json`, `tools/indian-dishes/validate.mjs`, `README.md`
