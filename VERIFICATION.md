# Verification report

Every claim below was produced by running the thing, not by reading the code.
Reproduce with `npm run check` plus `npm run data:build && npm run data:verify`.

| Gate | Command | Result |
|---|---|---|
| ESLint | `npm run lint` | **clean**, 0 errors, 0 warnings |
| Unit + property + integration tests | `npx vitest run` | **414 passed**, 36 files |
| Typecheck — packages | `tsc -p tsconfig.json` | clean, strict |
| Typecheck — app | `tsc --noEmit` in `apps/mobile` | clean, strict |
| Node-purity gate | `node scripts/check-node-purity.mjs` | **13/13 packages** React-Native-free |
| Corpus golden queries | `npm run data:verify` | **26/26 passed**, corpus accepted |
| IFCT corpus verification | `npm run ifct:verify` | **528-row corpus accepted**; ragi, rice, atta, paneer, rohu golden queries passed |
| iOS bundle | `expo export --platform ios` | **1,597 modules**, 3.7 MB |
| Android physical-device build | `npm run android` | **built and installed** on Samsung SM-M146B |
| Android schema upgrade | cold launch, inspect app-private `user.db` | **migrations 1-9 present**, integrity check clean |
| Android IFCT asset | inspect app-private `ifct.db` | **528 rows**, official PDF SHA-256 matches manifest |

The complete `npm run check` gate was rerun on 2026-09-12 after the Phase 2
correction pass. Focused coverage includes deterministic identity backfill,
post-migration production writes, operation allowlists, lossless meal-ledger
undo, reused-ID conflict protection, truncated-backup rejection,
transient-path scrubbing, database-level day-status validation, source-qualified
multi-database resolution, recipe v7-to-v8 repair, Hindi-script aliases, and
bounded Open Food Facts parsing.

Phase 2 physical-device verification was completed on Samsung SM-M146B. Food
Database displayed `528 IFCT foods · 7,928 USDA foods · offline`; searching
`ragi` returned `ifct:A010` with IFCT 2017 / ICMR-NIN attribution. The extracted
app-private `ifct.db` passed `PRAGMA integrity_check`, contained 528 IFCT rows,
and carried source PDF hash
`e87629581a58faca286f4886504bc75f33d6d3771a50fb4e40e2afee2b2b32dd`.

Strict mode means `strict` plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`,
`noPropertyAccessFromIndexSignature` and `verbatimModuleSyntax`. Two of the bugs
below were caught by those flags alone.

---

## What the tests actually prove

### The two defining bugs are structurally impossible

**A 27-million-calorie output cannot reach a user.** `@nutai/clamp` recomputes
calories from macros via Atwater whenever the model's own figure disagrees by
more than 15%, and the test asserts the string `27000000` appears nowhere in the
output. This runs on every scan, on both inference paths, and is not skippable.
It ships *before* any LLM verifier, not instead of one: a second model call to
check the first model's arithmetic costs money, adds latency, and can itself be
wrong. Arithmetic cannot.

**A macro edit cannot leave calories stale.** The reported failure — protein
edited 226 g → 175 g with calories frozen at 2,964 kcal — is unreachable because
no field exists for a stale total to live in. Totals derive from
`(grams, per-100g snapshot)` on every read. A **500-run property test** over
arbitrary add / remove / edit-grams / set-fraction sequences asserts the total
always equals the sum of its own rows. A single-example test would not have
caught the original bug either, because it only appears after a specific
*sequence*.

### The pipeline works against real data, not fixtures

`packages/pipeline/src/pipeline.corpus.test.ts` runs the real pipeline against
the real 7,928-food corpus:

- A three-item plate resolves every item to a genuine USDA row — **zero** fall to
  the AI-estimate path
- **Twenty common foods resolve with zero zero-hits**, well under the 5% rate that
  §5.5 sets as the trigger to add an embedding layer
- Displayed calories are reproducible from displayed macros across ten real foods
- No item exceeds a physically possible energy density
- A full scan completes in **under 500 ms**

### Honesty is measurable, not aspirational

The merge gate blocks a prediction that is only **4% off** — an excellent MAPE —
because its band claimed ±1% and missed the truth. That is the ship-blocker the
whole product rests on: being wrong is survivable, claiming confidence you have
not earned is not.

`baselines.json` self-declares `provenance: "seeded"` and every stratum carries a
citation for where its number came from. It flips to `"measured"` only after a
real golden-set run.

---

## Nine real bugs found and fixed

Listed because each one was a genuine defect, not a test adjustment.

1. **The clamp rejected real food.** `MAX_KCAL_PER_100G` was 900 on the reasoning
   that "pure fat is ~884". Real USDA data says otherwise: `Fat, beef tallow`,
   `Lard` and every fish oil in SR Legacy are **902 kcal/100 g**, because USDA
   applies a food-specific Atwater factor of 9.02 kcal/g rather than the rounded
   9. Anyone logging a spoon of lard would have been told their food was
   physically impossible. Raised to 920. *Found by the golden-query gate running
   against the actual corpus — which is the entire argument for having it.*

2. **One bad number killed a whole scan.** `model_gram_estimate` carried
   `.max(5000)` in Zod, so a single absurd value on one item of a five-item meal
   rejected the **entire payload** and the user got nothing back from a scan they
   paid for. Range checks belong to the clamp, which nulls the value and lets the
   ladder fall through. Structural violations still fail the payload; value-range
   violations no longer do.

3. **A type lie.** `ResolvedFood.foodId` was declared `string` while SQLite
   returns `INTEGER`. TypeScript was satisfied; every `===` downstream silently
   failed.

4. **Non-independence in the spec's own algorithm.** A trusted personal prior is
   computed *as* `model_estimate × ratio`, so blending it back against
   `model_guess` diluted the user's own correction with the very number they were
   correcting — and did so *harder* the more consistent they had been. A user who
   corrects 150 g → 200 g five times now sees 200, not 189.

5. **Double-counted uncertainty.** The band composed the pathway floor and the
   measured spread in quadrature when they describe the same quantity, inflating
   `packaged_exact`'s honest ±2% to ±2.8%.

6. **`better-sqlite3` throws synchronously** on a constraint violation, so
   `return Promise.resolve(stmt.run(...))` threw before a promise existed and a
   caller using `.catch()` on an async-looking interface would never see it.

7. **Metro vs. Node module resolution.** `packages/*` use explicit `./foo.js`
   specifiers because Node requires that when consuming built `dist/` — and the
   eval harness does exactly that. `tsc` and Vitest map `.js` → `.ts`; Metro takes
   it literally and fails. Fixed in `metro.config.js` rather than by dropping the
   extensions (breaks the Node build) or pointing the app at `dist/` (would mean
   the app runs different bytes from the harness).

8. **`newArchEnabled` no longer exists** in `ExpoConfig` — the New Architecture is
   the default in SDK 57 and the option was removed.

9. **The spec's assumed `reanimated ~4.1` cannot install** against SDK 57: it
   peer-deps to RN 0.78–0.82 and the SDK ships RN 0.86.

## Two research gaps closed

**FDC column names, previously UNCONFIRMED.** Two prior research passes could not
read USDA's field-description PDF (403 both times), so the shape of
`food_portion` was a guess. Verified against the real file: `id, fdc_id, seq_num,
amount, measure_unit_id, portion_description, modifier, gram_weight`. The build
validates every header and fails loudly on a mismatch.

**A self-contradiction in `SPEC-accuracy-engine.md` §6.3.** The stated rounding
rule ("one decimal for grams under 10 g") contradicts its own worked example,
which rounds 6.19 g fat to `6` and reports 466 kcal. We follow the stated rule
(6.2 g → 468 kcal): it preserves information that matters at a ~60 g daily fat
target, and the property that counts — displayed calories derived from displayed
macros — holds either way. Documented at the test.

---

## What is NOT built

Stated plainly so nothing here reads as more finished than it is.

**Blocked on you, by design:**
- Path B on-device inference (M3) — needs your physical iPhone/Android
- Golden-set ground truth (M4) — needs a kitchen scale and real food; ~40–60
  dishes after the Nutrition5k import, down from the plan's 200
- Store submission (M7) — needs your Apple and Google accounts

**Not built / Partial:**
- Onboarding (routes scaffolded, full functional integration pending), goals UI (edit-goals route exists, partial), key-entry screen
- Trends / Foods / You are placeholder screens
- Offline queue, barcode scanning UI, saved meals, custom foods
- HealthKit, Health Connect, widgets (M6)
- Branded-foods tier and the five verified-open national tables (UK CoFID, Japan
  MEXT, France CIQUAL, Germany BLS, Australia FSANZ) — the pipeline is built and
  they are additive stages
- ESLint: configured (`eslint.config.mjs`) and passing cleanly
- The current Phase 1 dev-client build has run on physical Android hardware.
  Interactive delete/undo/restart and document-picker backup/restore walkthroughs
  still need a human tap-through.

Honestly: **M0 and M0.5 complete, M1 complete, M2 and M5–M8 untouched.** Roughly
8–10 of the plan's 20+ engineer-weeks.
