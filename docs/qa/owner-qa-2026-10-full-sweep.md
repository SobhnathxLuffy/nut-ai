# Owner QA Round — Full Sweep (2026-10-03)

Covers the owner's report: Train Programs/Schedule dead, Indian dish browser
"shows 10 of 350+", uncertainty not explained, "aloo inside aloo" recipe data,
and the used-vs-absorbed oil contradiction. Plus a whole-app sweep, an
APK-readiness audit, and a per-feature status matrix.

Evidence language follows AGENTS.md §3: **AUTOMATICALLY VERIFIED** (test,
command, script), **CODE-INSPECTED**, **NOT TESTED (device)**.

## 0. Baseline and final state

| Gate | Before round | After round |
|---|---|---|
| Unit tests (`npm test`) | 1599 passed (after building the gitignored corpus; 7 failed on a fresh clone because `nutrition.db` was never built) | **1613 passed / 0 failed** |
| Playwright e2e (`npx playwright test`) | 36 passed (Wave 5C claim) | **46 passed / 0 failed** (local run against freshly exported web bundle) |
| Composer-vs-engine reconciliation | 362/362 within 0.5 kcal | **362/362 within 0.5 kcal** (semantics-aware) |
| Mapping verification | 0 errors / 0 warnings | **0 errors / 0 warnings** (1,451 slots) |
| Duplicate-food audit | did not exist | **new gate, 362/362 pass** |
| Lint / strict typecheck / node-purity / contrast | green | **green** (19/19 packages, 104/104 pairs) |

Fresh-clone note: `nutrition.db` is a gitignored artifact. A fresh clone has
7 failing corpus-init tests and a non-exporting app until `npm run data:build`
runs. This round made that dependency impossible to hit silently: CI now
builds the corpus before export (see §5), and EAS builds run it via
`eas-build-post-install`.

## 1. TRAIN — "Programs and schedule… doesn't do anything"

**Verdict: real logic bug + UX dead-ends. AUTOMATICALLY VERIFIED fixed.**

### BUG-T1 (critical) — schedule stored weekdays, engine read cycle days
`programs.tsx` saved the schedule as calendar weekday indexes (`Sun`=0…`Sat`=6)
while `scheduledRoutine()` (packages/training/src/repository.ts) reads **cycle
days** — day `0` is the start date itself, whatever weekday it falls on. The
two models only agreed when a program started on a Sunday. With the default
start date of *today*, every day evaluated to "no routine scheduled today":
the program card said "No routine scheduled today" forever. The feature was
wired end-to-end — it could simply never fire.

**Fix** (commit `90cce29`):
- Engine boundary helpers `weekdayOfLocalDate` / `weekdayToCycleDay` /
  `cycleDayToWeekday` in `packages/training/src/repository.ts` — the editor now
  speaks calendar weekdays ("Wed = leg day") and converts at save/load. Moving
  the start date keeps the weekday plan.
- Regression-locked in `packages/training/src/routines.test.ts`, including the
  end-to-end case: a program starting Tuesday with a Wednesday assignment fires
  on real Wednesdays (`2026-09-02`, `2026-09-09`) and rests on the Tuesday start.

### BUG-T2 — no edit path; delete-only programs
`saveProgram` accepted an update `id` but no caller used it. **Fix:** program
rows are pressable (`ItemRow onPress`), the form loads the stored definition
(converting cycle days back to weekdays), and "Save changes" passes the id.
AUTOMATICALLY VERIFIED by a new `saveProgram(id)` update test.

### BUG-T3 — cards lied about program state
"Rest day scheduled for today" rendered for programs that had not started and
for programs long finished. **Fix:** `programDayStatus()` returns
`scheduled | rest | before(daysUntil) | finished`; both `programs.tsx` and the
Train tab render the true state ("Starts in 3 days", "Program finished — edit
it…").

### BUG-T4 — false "auto-launching" promise
The screen advertised "auto-launching" while nothing schedules or launches
anything in the background (no `expo-notifications` dependency anywhere; this
is an explicitly deferred M5 feature). **Fix:** copy now says exactly what
happens — the Train tab shows today's session, one tap starts it.

### BUG-T5 — hard dead-end with zero routines
The editor said "create at least one routine" and offered no way to do so.
**Fix:** a "Create a routine first" button routes to `/routines`.

**Still open (device):** the actual Train-tab program journey on hardware, and
the Exercise Library device bug reported 2026-09-14 — both NOT TESTED (device)
this round.

## 2. FOOD — Indian dish browser "shows 10 of 350+"

**Verdict: stale on-device corpus that could never refresh, behind hardcoded
copy. AUTOMATICALLY VERIFIED fixed (commit `e430d90`).**

### BUG-F1 (critical) — the corpus never refreshed
`nutrition.db` (gitignored, 6.5 MB) is imported once with
`importDatabaseFromAssetAsync(forceOverwrite: false)` and the only freshness
probe was "does the `dish_definitions` table exist". Any install that had ever
imported an early/partial corpus kept it forever, while the screen's
placeholder/empty-state hardcoded "362" — count from copy, list from stale
data. The FlatList also renders an initial window (~12 rows), which is what a
stale-or-halted list looked like: "10 recipes, 350+ claimed".

**Fix:**
- `tools/indian-dishes/build-sqlite.mjs` stamps a **content-derived
  `corpus_revision`** (sha256 over the dish records + food/portion counts)
  inside the artifact's own `build_manifest`, mirrored into generated
  `apps/mobile/src/data/corpus-revision.ts`.
- `openNutritionDb()` compares the on-disk revision against the bundled
  constant and **force-reimports on mismatch** (missing table/manifest ⇒ stale
  beyond rescue ⇒ reimport). The corpus is generated data, never user data, so
  re-copying is safe; a matching revision still imports exactly once with no
  4.7–6.5 MB re-copy.
- Regression-locked in `apps/mobile/src/db/corpus-init.test.ts`: stale revision
  and missing manifest both re-import; matching revision imports once.

### BUG-F2 — counts were literals
The browser's headline, placeholder, and empty-state now read the shipped
artifact's own `dish_kb_dishes` manifest key (`Showing N dishes` was already
dynamic). The literal "362" in live UI is gone (prose docs keep the
build-gated number; `validate.mjs` hard-fails if the corpus is not exactly 362
dishes).

### BUG-F3 — search cap confusion
`DishKBSource.search` caps FTS hits at 10 per query (by design, per-source
ranking inside unified search), while the Food Database header states
"362 dish KB". Distinct surface, intentional cap — documented here so it is
not re-reported as the browser bug.

## 3. FOOD — "Recipes are uncertain but don't show what for"

**Verdict: three real display gaps. AUTOMATICALLY VERIFIED fixed (commit
`e7e820e`).**

### BUG-U1 — 251 of 362 dishes had zero uncertainty UI
`generateClarifications` asked questions only for slots labeled
`added_fat_optional`/`cooking_oil` — 2 of the 11 fat label families, and no
non-fat unknowns at all. 251 dishes (Idli, Dal Tadka, Biryanis, Litti, …)
carried an uncertainty model and rendered nothing. **Fix:** a "What this
estimate is unsure about" disclosure lists the model's own `highImpactUnknowns`
in words whenever there is no answerable question.

### BUG-U2 — the fat question missed 44 frying dishes
Aloo Tikki, Samosa, Pakora, … carry their fat in `added_fat_or_frying_oil` —
never asked. **Fix:** `isFatSlot()` (engine) matches `role: 'fat_variable'` or
any fat/oil/ghee label; Groundnut Oil and Butter joined the options;
`dishOpenUnknowns` now accepts any answered fat slot as closing fat-identity
unknowns. Regression-locked in `dish-clarifications.test.ts`.

### BUG-U3 — unknowns vanished when ingredients were unresolved
The composer's summary card hid the badge AND the "Open unknowns: …" line
whenever any ingredient was unresolved — hiding the uncertainty exactly when
the estimate was least reliable. **Fix:** the open-unknowns line renders in
every state; the numbers stay hidden until resolvable.

### BUG-U4 (bonus) — literal unicode escapes rendered as text
`\u00b7` inside JSX text is NOT an escape — every dish row displayed
"CURATED RECIPE \u00b7 Street food snack" literally (verified with esbuild:
JSX text passes escapes through raw). Fixed to real glyphs in the affected
strings.

## 4. FOOD — oil semantics ("pan oil into body oil")

**Verdict: contradiction confirmed everywhere the fat is charged. Designed,
implemented, and gated (commit `fc75b78`).**

### The new model — `packages/recipe-engine/src/oil.ts` (one source of truth)
- **Non-fried dishes** (tadka, ghee finish, simmered curries): oil used = oil
  eaten, confidence **high**.
- **Fried dishes** (`cook_or_fry`, `deep_fried`, or the dish's own
  `frying_oil_absorption` unknown): absorbed = **35–65% of the oil used**
  (the owner's spec: 14 g poured → 4.9–9.1 g eaten), capped at the
  28%-of-food-weight physical ceiling. Confidence **medium**.
- Absorption values are UNROUNDED in arithmetic — the model is exactly
  scale-free, so the per-100 g engine and the per-serving composer produce
  identical factors (rounding drift was caught live by the equivalence gate
  mid-implementation and fixed). `roundGrams()` is display-only.

### Where it is charged
| Surface | Behavior before | Behavior now |
|---|---|---|
| `computeDishNutrition` (dish KB numbers) | full fat slot as eaten | fried: absorbed mid charged; batch mass / verified yield / per-serving grams unchanged; result carries `oilSemantics` (used, low–mid–high per serving, confidence) |
| Unknown-dish decomposer | full used fat + phantom "absorption top-up" oil added to yield | absorbed subset charged; assumptions state what happened to the rest of the pour; yield no longer double-counts |
| Household recipes (`computeRecipeServing`) | `addedOilG` always 100% | `preparation: 'fried'` charges absorbed; boiled/roasted/raw unchanged (tadka/dressing fat IS consumed) |
| Dish composer UI | "Fat used (g)" = eaten | "Oil in the pan (g)" + "Estimated absorbed by the food: X–Y g (medium confidence)" + summary line "Oil: N g in the pan → ~M g absorbed" |
| `verify-composer-equivalence.mjs` | locked the full-fat semantics | simulates absorbed semantics AND asserts engine/composer agree on WHEN absorption applies and the used-gram value |

**Worked example — Aloo Tikki, 120 g serving (AUTOMATICALLY VERIFIED via
`computeDishNutrition`):**
- Oil in the pan: **6.9 g** → estimated absorbed **2.4–4.5 g** (medium
  confidence); nutrition charges **3.4 g** → 177.6 kcal / 4.9 g fat
  (was 13.4 g fat "eaten" from the same pour, alongside an open
  "frying oil absorption" unknown).
- Non-fried dishes are numerically untouched (300+ dishes identical, proven by
  the 362/362 reconciliation).

## 5. FOOD — recipe data ("aloo inside aloo", besan missing)

**Verdict: family-prior inheritance bug affecting 9 dishes; zero detection
coverage. AUTOMATICALLY VERIFIED fixed (commit `2c97484`).**

The `street_snack` family prior (samosa-style: wrapper + potato filling) was
inherited by Aloo Tikki, whose override only patched the patty slot → potato
patty + "potato filling". Name claims re-mapped other slots onto the same food
across the corpus. Nothing detected duplicates.

Fixed dishes (all re-derived through the reviewed graduation pipeline, all
gates re-run):
| Dish | Before | After |
|---|---|---|
| Aloo Tikki | potato patty + potato "filling", no besan | potato patty **62–72%**, **besan binder 5–10%** (`binding_or_batter`), griddle oil re-prior'd 3–6% (the deep-fry pour no longer applies), salt |
| Aloo Tikki Chaat | potato ×2 + yogurt | potato (patty + chunks, one slot), yogurt, **besan binder + sev**, **tamarind chutney** |
| Dahi Vada | yogurt ×2 | urad vada, yogurt bath, salt + roasted-cumin garnish |
| Moong Dal Chilla | moong ×2 | moong batter, water, ghee |
| Aloo Matar | peas ×2, no potato | potato **and** peas, onion base, tomato gravy |
| Corn Masala | corn as its own "aromatics" | corn + onion aromatics |
| Sev Tameta | tomato ×2, no sev | one tomato mass, **besan-sev topping** |
| Tomato Chokha | tomato ×2 | one roasted-tomato mass |
| Mutton Keema | goat ×2 | goat + onion bhunao |

Tooling hardened so this cannot silently recur:
- Graduation overrides support `removeSlots` / `appendSlots` (reviewed slot
  surgery) and `--regraduate="Name,…"` to re-run overrides on already-CURATED
  records. The loop is idempotent (appended labels resolve on re-runs; labels
  dedupe) — the slot-count gate in `validate.mjs` caught a duplicate-append
  regression DURING this round, which is the gate working as intended.
- **`scripts/audit-duplicate-slots.mjs`** (new, wired into `npm run check`)
  hard-fails any dish with the same food in two slots. Zero exemptions.
  362/362 pass.
- New slot labels humanized in the composer ("Besan binder", "Second
  vegetable", "Crunch topping (sev, optional)").

Every other recipe passes the full gate battery: verify-mappings (0 errors / 0
warnings, 1,451 slots), ingredient-density audit, filling-slot audit (40
stuffed dishes), slot-grams plausibility, golden queries.

## 6. APK readiness

**Verdict: READY-WITH-GAPS → code-side gaps closed this round; account-side
steps remain for the owner.**

Closed this round (commit with the report):
1. **`apps/mobile/eas.json`** — `preview` profile builds a sideloadable
   **APK** (`buildType: apk`, internal distribution); `production` builds an
   AAB with `autoIncrement`.
2. **`android.versionCode: 1`** baseline + adaptive icon completed:
   `backgroundImage` + `monochromeImage` wired (both assets existed on disk,
   unreferenced — Android 13 themed icon now available).
3. **Corpus bundling story** — `eas-build-post-install` runs
   `build:tools-pkgs + data:build` on EAS builders, so the gitignored
   `nutrition.db` exists at bundle time; CI (`web-e2e.yml`) got the same step
   before `expo export`.
4. **Proven by local run:** `npx expo export --platform web` succeeds from
   this tree with the corpus embedded (nutrition.db 6.5 MB + ifct.db 328 KB as
   assets), and the full Playwright suite (46 tests) passes against it.

Owner steps before `eas build -p android --profile preview`:
1. `cd apps/mobile && npx eas init` (writes `extra.eas.projectId`; requires an
   Expo account — cannot be done from here).
2. Optionally `npm i -D eas-cli` locally.
3. Keystore: EAS manages one on first Android build (`--no-wait` then follow
   prompts) or supply your own.

Device-only items deliberately NOT claimed (AGENTS.md honesty ledger): first
native rebuild since the reanimated removal, 130% font-scale walk, deep-link
ADB taps, TalkBack pass, reboot/airplane-mode persistence, live-provider SSE +
native SecureStore. These need the phone and are unchanged from the Wave 4/5
device-audit list.

## 7. Per-feature status matrix

| Feature | Status after this round | Evidence class |
|---|---|---|
| Train: quick workout, exercise library, equipment, routines, active workout, history | Working; unchanged this round | AUTOMATICALLY VERIFIED (1613 unit + 46 e2e); device re-verification still open |
| Train: Programs & Schedule | **Fixed** (schedule semantics, edit, status cards, honest copy) | AUTOMATICALLY VERIFIED (routines.test.ts); device journey NOT TESTED |
| Food: search (multi-source), review, log, undo/redo | Working; untouched | AUTOMATICALLY VERIFIED (e2e multi-source, p1/p2 regressions) |
| Food: Indian dish browser | **Fixed** (freshness, counts, per-row uncertainty) | AUTOMATICALLY VERIFIED (corpus-init.test.ts, validate gates) |
| Food: dish composer / My Version | **Improved** (uncertainty disclosure, oil semantics, besan etc.) | AUTOMATICALLY VERIFIED (composer-equivalence 362/362, clarification tests) |
| Food: unknown-dish decomposer | **Fixed** (absorbed oil, honest assumptions) | AUTOMATICALLY VERIFIED (oil.test.ts, unknown-dish tests) |
| Food: household recipes | Working; fried recipes now charge absorbed oil | AUTOMATICALLY VERIFIED (recipe-engine.test.ts) |
| Photo scan / barcode / label / receipt | Untouched this round; pipeline's absorbed-oil row model unchanged | CODE-INSPECTED; browser-side gateway CORS still NOT TESTED |
| AI assistant (read/write) | Untouched; write path e2e-locked (Wave 5B) | AUTOMATICALLY VERIFIED (assistant-write.spec) |
| Progress / reports / check-ins | Untouched; prior P2 fixes stand | AUTOMATICALLY VERIFIED (analytics suites); chart device QA open |
| Onboarding / backup / restore | Untouched; restore e2e-locked | AUTOMATICALLY VERIFIED (e2e restore journey) |
| Settings / data-methods / about | Untouched; copy references build-gated counts | CODE-INSPECTED |
| Web export & deep links | Re-verified this round (export + 46 e2e incl. route matrix) | AUTOMATICALLY VERIFIED |
| APK build | eas.json + versionCode + icons + corpus bundling done; `eas init` pending (owner) | AUTOMATICALLY VERIFIED (local export; config) + NOT TESTED (device/EAS cloud) |

## 8. Commit index

| Commit | Wave |
|---|---|
| `90cce29` | Train: schedule semantics, program edit, honest copy |
| `e430d90` | Food: corpus freshness gate, dynamic counts, per-row uncertainty |
| `e7e820e` | Food: uncertainty disclosure for model-only dishes, fat question for every fat slot, JSX escape fixes |
| `2c97484` | Data: 9 recipe fixes, duplicate-slot audit gate, remove/append slot surgery |
| `fc75b78` | Oil: used-vs-absorbed semantics everywhere, re-prior'd tikki oil |
| this commit | APK readiness (eas.json, versionCode, icons, corpus bundling, CI corpus step) + this report |
