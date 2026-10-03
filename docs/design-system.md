# Design System Reference

> **Status:** implemented · **Verification:** AUTOMATICALLY VERIFIED (CI gates + vitest, per section) unless a row says otherwise.
> This is the reference for every token, primitive and gate that keeps the Nut AI UI from drifting. The failure mode it exists to prevent has already happened once here: a 17-size ad-hoc type scale, five chip implementations, three rings, and an icon system made of emoji. Wave 1–4 (UI/UX Transformation Report Ch 13) rebuilt all of it; this file is the map of what landed and what enforces it.

**Authority chain:** the UI/UX Transformation Report (design authority) → `apps/mobile/src/theme/tokens.ts` (single source of truth for every value) → this doc (reference). When this doc and `tokens.ts` disagree, tokens.ts wins and this doc is stale — fix the doc.

**Evidence classes** follow AGENTS.md §3. Anything not exercised on the Android device is `NOT TESTED (device)`, never "verified" by inference.

---

## 1. The enforcement gates

Six gates keep this file true. A UI change that bypasses them is a regression by definition:

| Gate | What it enforces | Command |
|---|---|---|
| Hex rule (eslint) | `tokens.ts` is the ONLY file allowed a hex colour literal | `npm run lint` |
| fontSize rule (eslint) | No ad-hoc `fontSize` outside the 7-step type scale; `MIN_TAP_TARGET` on interactive elements | `npm run lint` |
| Contrast gate | Every text/graphical token pair in BOTH themes passes WCAG 2.1 (104 gated pairs, 24 logged — incl. the Wave 5C filled option-chip pairs) — computed from `tokens.ts`, with a completeness guard that hard-fails on any unresolvable `Theme` key | `npm run check:contrast` (chained into `npm run check`) |
| Type-scale + dynamic-type tests | Exact token values, the 1.2× numeral caps, the 68px display headroom at every call site, and a repo sweep that font scaling is never disabled | `npx vitest run apps/mobile/src/theme/type-scale.test.ts` |
| Sweep tests (Badge/Icon/etc.) | One-primitive-per-family contracts and the icon-set rules, via source inspection | root vitest suite (`npm run test`) |
| Node purity | Shared packages stay React-Native-free so the token/type tests run under plain Node | `npm run check:node-purity` |

---

## 2. Tokens

All values live in `apps/mobile/src/theme/tokens.ts`. AUTOMATICALLY VERIFIED by `type-scale.test.ts` (exact-value assertions + sweeps) and `scripts/check-contrast.mjs` (WCAG computation).

### 2.1 Palette

The raw hex vocabulary. Neutrals are a 12-step ink ramp (`ink900`…`ink50`); identity colours are one-hue-per-concept:

| Group | Slots | Notes |
|---|---|---|
| Neutrals | `ink900 … ink50`, `white` | `ink450` is the computed faint-text grade (5.01:1 on white; `ink400` at 3.40:1 was the Wave 1a AA failure) |
| Macro identity | `protein #3E7BFA`, `carbs #F2A93B`, `fat #7B5EA7` | One macro, one hue, everywhere. `palette.carbs` stays the artwork hex; the light THEME slot resolves to the computed `#C68607` (3.08:1, clears the 3:1 graphical bar) |
| Uncertainty | `uncertain #8B7BD8`, `uncertainBg #F1EEFB` | Violet — an invitation to check, never a scold |
| Safety | `safety #C13A30`, `safetyBg #FDEDEC` | Wave 4 recomputed: 5.36:1 on white (was 4.43:1). Red is reserved for SAFETY warnings only |
| Affirm | `affirm #2E9E6B` | Quiet on purpose — logging a meal is not an achievement |
| Heart | `heart #E8615A` | Iconographic identity, never a status |

### 2.2 Semantic theme slots

`Theme` is resolved per theme by `ThemeProvider`. Every slot, both dialects:

| Slot | Light | Dark | Used for |
|---|---|---|---|
| `bg` / `bgElevated` / `bgSunken` | white / white / ink50 | ink900 / ink800 / ink900 | page / cards / wells |
| `border` | ink200 | ink700 | hairlines |
| `text` / `textMuted` / `textFaint` | ink900 / ink500 / ink450 | ink50 / ink300 / ink400 | primary / secondary / caption text |
| `ring` / `ringTrack` | ink900 / ink100 | ink50 / ink700 | ProgressRing stroke + track |
| `protein` `carbs` `fat` | (carbs = `#C68607`) | `#6E9BFF` `#F5BC63` `#A288CC` | identity: icons, strokes, chart series |
| `uncertain` / `uncertainBg` | as palette | `#A99AE6` / `#241F38` | uncertainty identity + wash |
| `safety` / `safetyBg` | as palette | `#F0655B` / `#3A1E1C` | safety identity + wash |
| `affirm`, `heart` | as palette | `#4FBE8C`, `#F2766B` | affirm / heart identity |
| `proteinText` `carbsText` `fatText` `uncertainText` `affirmText` | `#2E63D9` `#8F5E05` `#7B5EA7` `#6754C2` `#1E744C` | = dark identity hexes | **text-grade slots** — any `<Text>` colour in an identity hue uses these (≥4.5:1). Identity slots stay on icons/strokes/tints (≥3:1) |
| `accent` / `accentTint` | ink900 / `#0B0B0F1F` | ink50 / `#F7F7FA1F` | the selected-state ink dialect (Button fill, tab pill) |
| `affirmTint` `uncertainTint` `proteinTint` `carbsTint` `fatTint` | `…1A`-family | `…26`-family | the only sanctioned way to tint a surface |
| `rowRaised`, `skeletonBase` / `skeletonSweep`, `bgSunkenStrong` `bgChrome` `bgSunkenVariant` | see tokens.ts | mirrored | raised rows, skeletons, onboarding chrome |

**The Wave 4 rule that matters most:** identity colour in a Text style is a violation — use the `*Text` slot. The contrast gate computes both grades on every run, so a rename or new slot that escapes the matrix hard-fails the gate (completeness guard).

### 2.3 Type scale (7 steps + the dynamic-type policy)

| Token | Size/leading | Weight | Scaling |
|---|---|---|---|
| `display` | 56/60 | 800, −1.5 tracking | **cap 1.2×** (`maxFontSizeMultiplier` on the token) + **`lineHeight: 68` headroom at every call site** (56×1.2 = 67.2 > 60) |
| `title` | 28/32 | 700, −0.5 | free |
| `heading` | 20/26 | 600 | free |
| `body` / `bodyStrong` | 16/24 | 400 / 600 | free |
| `label` | 14/18 | 500 | free |
| `caption` | 12.5/16 | 400 | free — the floor (11px micro is retired) |
| `monoData` | 16/22 | 600, `tabular-nums` | **cap 1.2×** (16×1.2 = 19.2 ≤ 22 — cannot clip) |

**Dynamic-type policy (report §11.1):**

| Text kind | Behaviour |
|---|---|
| Prose/labels (`body`…`caption`) | grow with the OS font scale — RN default, never disabled (sweep-gated) |
| Numerals (`monoData`) | cap 1.2× via the token; ~30 spread sites inherit |
| Display hero | cap 1.2× + `lineHeight: 68` at the call site (asserted for EVERY `type.display` spread in `type-scale.test.ts`) |
| `TextInput` | `allowFontScaling` stated explicitly — Android's default is OFF. Capped 1.2 on numeral cells (workout + log-exercise set tables); uncapped on content inputs (`Field`, `Screen.Field`, `EditableValue`) |
| Floor | 12.5px caption floor (type-scale + eslint) |

The 130% layout audit is an owner device pass — see §8 (NOT TESTED (device)).

### 2.4 Space, radius, elevation, state, motion

| Token set | Values |
|---|---|
| `space` (4pt scale) | xs 4 · sm 8 · md 12 · lg 16 · xl 24 · xxl 32 · xxxl 48 |
| `radius` | sm 8 · md 12 · lg 16 · **sheet 20** · xl 24 · pill 999 |
| `elevation` | subtle (r3) / medium (r12) / high (r28) — ink shadows + Android `elevation` |
| `darkElevationBorder` | dark mode substitutes a lighter border per level (shadows are invisible on near-black) — `elevationStyle(level, isDark)` is the only accessor |
| `stateLayer` (+`Dark`, `stateLayerFor`) | pressed 6% ink · disabled 38% + no shadow (spread AFTER any elevation) · selected 12% accent tint · focus 2px ring (web/keyboard only) |
| `motion` | instant 90 · fast 160 · base 240 · slow 380 · reveal 520 (× motionScale; 0 under reduce motion) |
| `MIN_TAP_TARGET` | 44pt — anything smaller MUST set `hitSlop` (eslint) |

---

## 3. Icon system

`apps/mobile/src/components/Icon.tsx`. AUTOMATICALLY VERIFIED by `Icon.test.ts` (union/case parity, shared-stroke contract, extension-protocol header, text-glyph kills).

- **64 glyphs**, hand-drawn SVG paths on a 24×24 grid, **stroke weight 1.8** (the set's optical weight — do NOT adopt Lucide's 2.0 base), round caps + joins, `fill: none`, colour inherited from `color ?? theme.text`.
- **`ICON_SIZES`** = `{ default: 24, dense: 20, inline: 16 }` — the vocabulary; the numeric `size` prop stays authoritative.
- **A11y rule:** an icon rendered WITHOUT adjacent text must carry `label` (→ `accessibilityLabel` + role `image`). Beside a label or inside a labelled Pressable: leave it unset. Caveat: react-native-svg's web renderer may drop the prop.

### 3.1 Glyph table

| Name | Purpose | Name | Purpose |
|---|---|---|---|
| `flame` | energy/streak identity | `check` | confirmation, selected markers |
| `protein` | protein macro (drumstick) | `chevron` | navigation/disclosure |
| `carbs` | carbs macro (wheat) | `plus` / `plusCircle` | add action / log-a-meal row action (W4d) |
| `fat` | fat macro (droplet) | `close` | dismiss |
| `fiber` `sugar` `sodium` | nutrient identities | `pencil` | edit |
| `steps` `water` | activity identities | `heart` | heart health |
| `home` `chart` `person` | tab identities | `clock` | time, rest timer |
| `scan` | scan action | `target` | goals |
| `barcode` `nutritionLabel` `receipt` | capture modes | `dot1` `dot3` `dot6` | density family; `dot3` = overflow row-menu |
| `run` | cardio | `bowlPlus` | "save as usual meal" (W4d) |
| `search` | search, unknown-honesty marker | `trash` | delete actions (W4d) |
| `bookmark` | saved | `share` | share/export (W4d) |
| `dumbbell` `muscle` | training | `crown` | premium/supporter (W4d) |
| `scale` `scaleBalance` | body weight / balanced | `uturnBack` `uturnFwd` | undo / redo (W4d) |
| `male` `female` `nonbinary` | onboarding sex tiles | `warning` | caution marker for unverified rows (Wave 4 wrap) |
| `arrowUp` `arrowDown` `minus` | deltas / decrement | `bowl` | meal identity |
| `thumbUp` `thumbDown` | feedback | `bookOpen` | recipes (W1c) |
| `calendar` `handshake` | date / provider link | `sparkles` | AI assistant (W1c) |
| `burger` `bars` `apple` `sun` `lotus` `leaf` `fish` `meat` `sprout` | diet/lifestyle/health identities | | |

### 3.2 Extension protocol (the lucide decision)

When a metaphor is missing: pick the NAME and GEOMETRY REFERENCE from the Lucide vocabulary (24px grid, 2px reference stroke) and draw it in-house at 1.8. One stroke philosophy, zero new dependencies, and Metro's unreliable tree-shaking can never strand the bundle. Precedents: Wave 1c `bookOpen`/`sparkles`; Wave 4d's seven; the wrap's `warning` (Lucide triangle-alert anatomy).

- **No `lucide-react-native` dependency** — deliberate Wave 4 deviation (report Ch 6.2 superseded), recorded in ADR-021.
- **REVISIT trigger:** if a single wave needs >10 new glyphs, evaluate the dependency then.
- **No text glyphs standing in for symbols** (report Ch 13 DoD): the last three — review.ts's `"✓ "/"? "` prefixes, result.tsx's `"⚠ Estimated"`, search.tsx's `"✓ Selected"` — are dead and sweep-tested. `×` in quantity strings ("Option × 2") is typography, not an affordance.

---

## 4. Deep links (`nutai://`)

`apps/mobile/src/navigation/deep-links.ts` (+ `DeepLinkRedirect.tsx`, `app/scan|log|home.tsx`, `app/+not-found.tsx`). AUTOMATICALLY VERIFIED by `deep-links.test.ts` (map + resolver + route-file existence) and `e2e/wave4.spec.ts` (web path equivalents).

**Strategy — alias route files, NOT a `Linking` subscription.** The scheme is declared in `app.config.ts`; expo-router registers it with the OS and web router automatically. A root `Linking` subscription races the router's own dispatch (404-flash) and Android double-delivery — do not build one.

| `nutai://…` | Route | Note |
|---|---|---|
| `scan` | `/camera` | hero action; widget/notification tap |
| `log` | `/food` | Food write-surface tab |
| `home` | `/` | Home tab |
| `train` | `/train` | direct route — no alias file |
| `workout` | `/workout` | direct |
| `assistant` | `/assistant` | direct |
| `progress` | `/progress` | direct |
| `weight` | `/log-weight` | direct |

`resolveDeepLink(url)`: case-insensitive scheme+host, strips `?query`/`#hash`/trailing slash, `null` for non-nutai / bare / unknown (falls through to `+not-found.tsx` — an Empty primitive, never a crash).

**To add one:** add the entry to `DEEP_LINK_ROUTES` (with an honest `description`); if the alias names no real route file, add a 2-line `app/<alias>.tsx` rendering `<DeepLinkRedirect path="<alias>" />`. The test asserts every mapped route has a real file.

---

## 5. Primitives

All in `apps/mobile/src/components/` unless noted. Every entry: implemented; the cited test locks it. Consuming rules: **one primitive per family — do not hand-roll a variant beside it** (that is the drift this library exists to prevent).

### 5.1 `Screen` + Header — the ONE screen wrapper (report §7.2 / Wave 1c)

Safe areas, scrolling, and the large-title header: `type.title` 28/700 collapses to a bodyStrong inline title at a 48px scroll threshold, hairline fading in with it. Back slot is chevron/close (`backIcon`), right slot up to two icon-only `HeaderAction`s (label mandatory — icon-only controls always carry one). Reduce motion → static inline header, no choreography.

| Prop | Type | Notes |
|---|---|---|
| `title` | string | large title + inline twin |
| `back` / `backLabel` / `backIcon` | bool / string / `'chevron'｜'close'` | `router.back()` |
| `headerActions` | `HeaderAction[]` | capped at 2, silently |
| `largeTitle` | bool | false → inline-only |

A11y: ONE header role (the large title; the collapse twin carries none — opacity-0 text stays in the RNW a11y tree). Tokens: `t.bg`, `t.border`, `type.title/bodyStrong`. Status: AUTOMATICALLY VERIFIED — `Screen.header.test.ts`.

### 5.2 `Button` — the ONE Button (report Table 5.1 / 12.2 / Wave 2)

| Prop | Type | Notes |
|---|---|---|
| `label` | string | visible text + a11y label |
| `onPress` / `disabled` / `selected` | fn / bool / bool | `selected` fills with `t.accent` (Wave 4) + `accessibilityState` |
| `icon` | `IconName` | one glyph left of the label, content-coloured (18 md / 22 lg) |
| `size` | `'md'｜'lg'` | 48pt r14 / 56pt pill |
| `style` | ViewStyle | layout overrides, merged after |

Press feedback via PressableFX (Table 9.1). Tokens: `accent`, `bgSunken`, `text`, radius, space. Status: AUTOMATICALLY VERIFIED — `Screen.button.test.ts` (selected fill = `t.accent`, exact-value assertions).

```tsx
<Button label="Log it" size="lg" selected icon="check" onPress={save} />
```

### 5.3 `Field` ×2 — the TWO labelled inputs (report Table 5.1 / P2-30)

**`Screen.Field`** — label + error + hint slots, error drives the safety border + alert-role caption; focus ring (stateLayer.focus) on web only. **`Field.tsx` (compact)** — value/onValueChange, optional unit suffix, numeric keyboard, container/input overrides; `onChange` trap named honestly. Both state `allowFontScaling` explicitly (Android default is OFF); both are minHeight inputs — content grows, no cap. Status: AUTOMATICALLY VERIFIED — `type-scale.test.ts` source inspection + `wave3-food.test.ts` / `Screen.button.test.ts`.

```tsx
<Screen.Field label="Grams" error={e} keyboardType="decimal-pad" value={v} onChangeText={setV} />
<Field label="Weight" value={v} onValueChange={setV} numeric unit="kg" />
```

### 5.4 `Label`, `Card`, `Row`, `useAction` (Screen.tsx)

- `Label` — body text, `muted` variant for secondary. Token: `text`/`textMuted`.
- `Card` — elevated container: `bgElevated` + border + `radius.xl`, `space.lg` padding.
- `Row` — wrapping flex row, `space.sm` gap.
- `useAction(refresh?)` — async action state: `run` (double-tap guarded), `busy` (spinner), `error` (safety-coloured alert text + Retry Button via `feedback`). AGENTS §8.4's idle/pending/failure+retry in one hook.

Status: AUTOMATICALLY VERIFIED via the Screen/field tests above + consumers.

### 5.5 `Badge` — the ONE badge/chip (report Table 5.1 / 12.2 / Wave 2)

Nine variants (`default outline selected protein carbs fat affirm safety uncertain`) × two sizes (`sm` md). `badgeColorsFor` maps variant → token pair: macro/tone labels use the `*Text` slots on their tint washes (Wave 4); selected flips to the ink dialect. Interactive (an `onPress`) → 44pt target, button/radio role, press feedback, web aria fix (aria-checked/aria-pressed — RNW drops accessibilityState). Status: AUTOMATICALLY VERIFIED — `Badge.test.ts` (exact light hexes, *Text slots, web aria).

```tsx
<Badge label="High protein" variant="protein" />
<Badge label="Quick" role="radio" selected={quick} onPress={toggle} />
```

### 5.6 `ChipRow` — the ONE option-chip row (P2-30)

Horizontal scroll of selectable chips: `items/keyOf/label/a11yLabel/isActive/onPress` + style slots. Selected = the Badge macro dialect — `proteinTint` fill + `proteinText` caption + `protein` border (Wave 5C closed the old solid-protein-fill deviation, §7); `accessibilityState.selected`; 44pt. The hand-rolled siblings (indian-dishes filter chips, food-search quick-add chips, dish-composer yield/method chips) render the same dialect — one family. Status: implemented — AUTOMATICALLY VERIFIED via `ChipRow.test.ts` (source lock over all five sites) + the contrast gate's filled-chip pairs; consumers swept by `wave3-food.test.ts`.

### 5.7 `ItemRow` — the ONE list row (report Ch 8.5 / §5)

Icon + label + muted value caption + trailing glyph (chevron when pressable, custom slot otherwise). Pressable or static; `destructive` → safety label; 52pt+ target. Status: implemented — AUTOMATICALLY VERIFIED via `wave3-profile.test.ts` (consumers).

### 5.8 `Sheet` + `MenuSheet` — the ONE bottom sheet (report Ch 8.5 / Wave 3)

Modal + spring rise + `radius.sheet` + tap-outside + swipe-down dismiss (96px or fling) + reduce-motion static; NO haptic on open/close (Table 9.2). JS driver only (web-safe — reanimated stays off the bundle). The drag-vs-tap suppression flag survives from the FAB sheet: RNW drops `onClickCapture`, so a drag's synthesized click is swallowed exactly once. `MenuSheet` renders grouped icon rows (`MenuSection[]` — caption + items with label/icon/hint/destructive) and closes BEFORE the action runs. Status: implemented — AUTOMATICALLY VERIFIED via `wave2-nav.test.ts` / `wave3-food.test.ts` (consumers).

### 5.9 `Toast` + `toast-store` — the ONE feedback system (report §10.1 / Wave 1b)

`showToast({ message, action?, tone? 'default'|'success'|'error', durationMs? })` — queued, top-anchored, one visible, ~4s auto-dismiss (8s for errors, which also fire the error haptic — the tone IS the failure signal). Swipe/fling to dismiss. Host mounts ONCE at the app root. Rules enforced at call sites: toasts confirm success and offer the next action; they never ask questions; Alerts are for destructive confirmations. Store is React-free and fake-timer tested. Status: AUTOMATICALLY VERIFIED — `Toast.test.ts` (queue semantics, durations, action dispatch).

```tsx
showToast({ message: 'Meal logged', action: { label: 'Undo', onPress: undo }, tone: 'success' })
```

### 5.10 Skeleton family (report §9.2 / Table 9.1 / Wave 1c)

`Skeleton` (block), `SkeletonLine`, `SkeletonRow` (avatar + tapering lines), `SkeletonCard`. NN/g placement: under 1s show nothing; 1–10s content-shaped skeletons; over 10s spinner + textual progress (exception: the scan analyzing state keeps spinner + honest copy AND the skeleton list, by report §8.4). ONE slow sweep — 1.2s loop, 20% band (`SKELETON_SWEEP_MS`), never a pulse; reduce-motion → static 8% ink fill. Frame-only skeletons are forbidden — every composition places content-shaped blocks. Tokens: `skeletonBase`/`skeletonSweep`. Status: AUTOMATICALLY VERIFIED — `Skeleton.test.ts`.

### 5.11 `Empty` — the ONE empty/error state (report Ch 6.3 / Table 10.1 / Wave 1c)

Icon (what is empty) + title + message (what fills it) + action (the create-first next step, rides Button `selected`) + optional quiet `secondaryAction`. An empty list is never dead space. `pressEmptyAction` exported for the testable-dispatch trick. Status: AUTOMATICALLY VERIFIED — `Empty.test.ts` (+not-found is a consumer).

```tsx
<Empty icon="search" title="Nothing here yet" message="Log your first meal to see the day." action={{ label: 'Log food', onPress: go }} />
```

### 5.12 `ProgressRing` + `CountUp` (report Table 5.1 / 12.2 / Wave 2)

One ring: track circle + primary stroke + (over target) a thinner inner overflow arc in uncertain — over-target is STATED, never clamped-at-100% lying. Every value change tweens 600ms ease-out (`RING_COUNT_MS`, Table 9.1); reduce-motion renders instantly. `ringGeometry(size, stroke)` is the shared geometry (exported, tested). `CountUp` animates the hero number WITH the ring in `monoData` tabular figures. JS driver only. Tokens: `ring`, `ringTrack`, `uncertain`, macro identity colors. Status: AUTOMATICALLY VERIFIED — `ProgressRing.test.ts` (geometry, tween, no-reanimated manifest lock).

### 5.13 `PressableFX` + `useReducedMotion` (report Table 9.1 / Wave 2)

The app-wide press feedback: scale 0.97 pressed + 6% ink state layer, 90ms in / 120ms out; disabled = 38% + no shadow. Reduce motion: states apply instantly, no choreography (feedback is information). `useReducedMotion()` folds the token scale + the web media query (RNW doesn't implement `AccessibilityInfo`). The caller's style lands on the scaled visual box so the hit area keeps the padding. Status: AUTOMATICALLY VERIFIED — `PressableFX.test.ts`.

### 5.14 `Disclosure` (report Ch 8.8 / Table 12.3 / Wave 3)

Collapsed-by-default row expanding in place: label + caption + rotating chevron, `accessibilityState.expanded`, 44pt head. The pattern that lets Profile fold licenses/disclaimers without deleting a word. Status: implemented — AUTOMATICALLY VERIFIED via `wave3-profile.test.ts` (consumers).

### 5.15 `ConfidenceChip` (SPEC-ui §0.2 / report §8.4)

Domain composite over `Badge variant="uncertain" size="sm"`: tier glyph + range label; tap reveals reasons (never behind a modal — `ConfidenceReasons`). Tier 'none' renders null (no false modesty). Colour is violet (invitation, not scold); the glyph carries the tier independently of colour. A11y label speaks value + range + "tap for why". Tokens: `uncertainText` on `uncertainBg`. Status: AUTOMATICALLY VERIFIED — `Badge.test.ts` + `wave3-scan.test.ts`.

### 5.16 Charts — `LineChart` / `BarChart` (pre-Wave survivors, audited)

SVG line/bar charts with measured extent, normalization cap, gaps for missing periods, tap-to-scrub points, `accessibilityRole="image"` + count label, empty-state text. Consumers pass series with identity colours (chart series = graphical 3:1 tier). Status: implemented — CODE-INSPECTED + source-locked by `wave3-screens.test.ts` (Charts.tsx source assertions); on-device chart QA still open (AGENTS §0.2).

### 5.17 `Icon` — see §3.

---

## 6. Dependency policy appendix (report Ch 12 / Table 12.1, Wave 4a audit)

| Dependency | Disposition | Evidence |
|---|---|---|
| `react-native-reanimated` | **REMOVED (Wave 4a)** — was present with zero imports; the shipped web-export-safety architecture (RN `Animated`, JS driver) is locked by test, so the report's "enable reanimated" was superseded by its own KILL intent | lockfile clean of our pin (survives only as drawer-layout's optional transitive peer); `ProgressRing.test.ts` asserts the manifest is free of it |
| `@expo/ui` | **ABSENT** — nothing to do | both manifests grep-verified |
| `react-native-screens` | KEEP, no direct imports — platform-required (expo-router native stack) | audit |
| `@expo/metro-runtime` | KEEP, no direct imports — platform-required (Metro web export runtime) | audit |
| `react-dom` | KEEP, no direct imports — platform-required (web render tree via react-native-web) | audit |
| every other dep in both `package.json`s | KEEP, used (usage counts verified: expo-router 56, safe-area 30, expo-sqlite 15, …) | audit |

**Rule: a new UI dependency requires an ADR.** The set above is the audited floor; the icon system's no-lucide decision (§3.2) is the standing example of the discipline.

Gate-visibility note (honest): `check:contrast` parses `tokens.ts` only. `src/ui/alert-web.ts` mirrors two light hexes by hand (updated to the Wave 4 grades — `#C13A30` destructive, `#2E63D9` default action) and is covered by that file's own "mirrors the palette exactly" contract, not by the gate.

---

## 7. Deviations — closed and open

**Closed:**

1. **Filled-protein chip fill pair — CLOSED (Wave 5C, 2026-10-03).** The
   ChipRow selected state (and its hand-rolled siblings: the indian-dishes
   filter chips, the food-search quick-add ingredient chips, the
   dish-composer yield/method chips) used to render a `bg` label on a SOLID
   `theme.protein` fill — 3.88:1 in light, the last accepted deviation. The
   chips now render the Badge macro dialect (`proteinTint` wash +
   `proteinText` label + `protein` border; selection still doubled in
   `accessibilityState.selected`), locked two ways: `ChipRow.test.ts`
   (source sweep over all five sites — the retired pattern cannot regrow)
   and the contrast gate's two filled-chip pairs over the page bg (label
   4.78:1 light / 6.00:1 dark, border 3.44:1 / 6.00:1 — 104/104 gated pairs
   total). One-time adversarial proof: re-adding the retired `bg on protein`
   pair to the gate manifest fails at exactly 3.88:1.
2. **Residual of the same class (recorded, open):** two FILLED BUTTONS
   still render a `bg` label on a solid `protein` fill — the decomposer's
   "Review & log dish" action (`food-search.tsx`) and the
   `NewIngredientForm` save button. Buttons, not chips — outside the 5C chip
   scope; the next a11y pass should move them to the accent ink dialect
   (the Button selected pattern) or a proteinText fill, and add the gate
   pair.

**Open — NOT TESTED (device), the owner pass list:**

1. **130% device font audit.** Checklist for the owner pass: Android
   Settings → Display → Font size max; Home hero ring card, macro stat rows,
   slot-guide disclosure, set table (cells / prev / set-number columns), rest
   chip, tab bar labels — plus the Wave 5 day-detail and clarification-card
   layouts. The caps, headroom and input scaling that make it pass are
   AUTOMATICALLY VERIFIED; the rendered layout is not.
2. **Native rebuild after reanimated removal.** Zero source imports
   (autolinking-only risk); web export + e2e re-verified after removal.
3. **Deep-link device taps.** `adb shell am start -a android.intent.action.VIEW
   -d "nutai://scan"` (and `log`, and the Wave 5 `day` alias) is the owner
   pass; unit + web e2e cover the resolution and the not-found fallback.

The browser-emulation suite has landed and is green:
`apps/mobile/e2e/wave5-a11y.spec.ts` (tree walk: Sheet dialog naming,
honesty-row announcement, camera/day-strip/tab naming, Toast live region),
`wave5-font-scale.spec.ts` (the 130% audit for Home hero + macro rows,
Camera, and the workout set table — two-pronged CSS injection emulating
the native 1.2 numeral cap; 3 journeys, no cut text), and
`wave5-routes.spec.ts` (all 8 direct routes + 3 aliases render their real
screens). Final e2e: **46 passed / 0 skipped / 0 failed** (29 at the start
of Wave 5). Prebuild proof: `npx expo prebuild --platform android
--no-install` exits 0 with zero reanimated references in autolinking (the
only template mention is a static proguard keep-rule, harmless); the
hardware halves (native VoiceOver, ADB taps, a real gradle build, hardware
glyph rendering) remain the owner's.

---

## 8. Related records

- ADR-021 — design-system deviations (lucide fallback protocol; Text-slot grade split).
- `VERIFICATION.md` — the Wave 4 + Wave 5 round entries (gate runs, counts, adversarial proofs).
- `AGENTS.md` §8 — the binding UI rules; §13 the command list.
- The UI/UX Transformation Report (Ch 13 Table 13.1) — the wave program this implements.
