/**
 * The design system, as typed tokens.
 *
 * SPEC-ui.md §4. This is the ONLY file in the app allowed to contain a hex
 * colour — an ESLint rule enforces it. That is not tidiness: a hardcoded colour
 * is a colour that silently ignores dark mode and never gets contrast-checked.
 *
 * UI/UX Transformation Report (Wave 1): this file carries the canonical
 * seven-step type scale (report Table 3.1), the elevation + state-layer tokens
 * (report §4.3), and the caption contrast fix (report §11 / Table 11.1).
 *
 * Wave 4 (report Table 11.1 "compute all pairs", §11.1 "contrast verification
 * becomes a CI gate"): the light palette is now CONTRAST-GRADED — every identity
 * colour that is used as text has a dedicated *Text slot at ≥4.5:1 on its
 * surfaces, light `carbs`/`safety` were recomputed to clear their bars, and the
 * accent slot the report demanded (§3.2) landed. `scripts/check-contrast.mjs`
 * recomputes the full WCAG 2.1 matrix from this file on every CI run, so no pair
 * here is ever "designed but uncomputed" again.
 *
 * THE COLOUR RULE THAT MATTERS MOST:
 *
 *   Red is reserved for SAFETY warnings only. Never for food, never for a missed
 *   goal, never for a number being "bad".
 *
 * The app we are replacing reuses one coral hue for both "protein" and "you
 * missed your goal", which turns a food-group identity colour into a shame
 * signal. Uncertainty here is VIOLET — an invitation to check, not a scold.
 * A scolding colour is what makes people switch the indicator off, which defeats
 * the entire point of having one.
 */

import type { TextStyle, ViewStyle } from 'react-native'

export const palette = {
  // Neutrals
  ink900: '#0B0B0F',
  ink800: '#16161C',
  ink700: '#22222B',
  ink600: '#3A3A46',
  ink500: '#5C5C6B',
  // Wave 1a (report §11 / Table 11.1): the faint-text tier. ink400 on white is
  // 3.40:1 — the 11px micro text that failed WCAG AA. ink450 is the computed
  // replacement: 5.01:1 on white (verified in type-scale.test.ts, which
  // recomputes the ratio from these hexes on every CI run).
  ink450: '#6E6E7D',
  ink400: '#8A8A99',
  ink300: '#B8B8C4',
  ink200: '#DCDCE4',
  ink100: '#EFEFF3',
  ink50: '#F7F7FA',
  white: '#FFFFFF',

  // Macro identity. These are IDENTITY colours: one macro, one hue, everywhere.
  // They never double as status.
  protein: '#3E7BFA',
  // Wave 4: the PALETTE hex stays the artwork/brand identity — but 2.00:1 on
  // white fails even the 3:1 graphical bar for ring strokes and chart series,
  // so `lightTheme.carbs` now resolves to the computed #C68607 (3.08:1) and
  // darkTheme keeps its own literal. Same pattern the dark theme already used.
  carbs: '#F2A93B',
  fat: '#7B5EA7',

  // Uncertainty. Violet, deliberately not amber and never red.
  uncertain: '#8B7BD8',
  uncertainBg: '#F1EEFB',

  // Safety only. If you are reaching for this and it is not a safety warning,
  // you want `uncertain` or a neutral.
  // Wave 4: #D5453B was 4.43:1 on white — under the 4.5:1 AA text bar it is
  // used at (in-line error copy). #C13A30 is 5.36:1 on white and ≥4.5:1 on
  // every light surface it renders on; one-slot fix, no `safetyText` needed.
  safety: '#C13A30',
  safetyBg: '#FDEDEC',

  // Success is quiet on purpose. Logging a meal is not an achievement to
  // celebrate; it is a thing you did.
  affirm: '#2E9E6B',

  // Heart/health identity coral (onboarding health tile, charts artwork).
  // Iconographic anatomy colour — NOT a status; never use it for warnings.
  heart: '#E8615A',
} as const

export interface Theme {
  bg: string
  bgElevated: string
  bgSunken: string
  border: string
  text: string
  textMuted: string
  textFaint: string
  ring: string
  ringTrack: string
  protein: string
  carbs: string
  fat: string
  uncertain: string
  uncertainBg: string
  safety: string
  safetyBg: string
  affirm: string
  /** Heart/health identity coral (iconographic, never a status). */
  heart: string
  /**
   * Text-grade colors (Wave 4, report Table 11.1 "compute all pairs") — one
   * per identity hue that is ever set as a `<Text>` color. The IDENTITY colors
   * above are for icons, ring strokes, chart series and tints (3:1 graphical
   * bar); any text label uses its *Text slot so it clears the 4.5:1 text bar.
   * Light values are darker grades of the same hue; dark values are the same
   * hexes as the dark identity colors, which already passed.
   */
  /** Text-grade protein — `theme.protein` as Text color is a Wave 4 violation. */
  proteinText: string
  /** Text-grade carbs — light is a brown-grade amber; carbs-as-text was never AA. */
  carbsText: string
  /** Text-grade fat — light equals palette.fat (5.25:1, already passing). */
  fatText: string
  /** Text-grade uncertain — the violet "please double-check" label color. */
  uncertainText: string
  /** Text-grade affirm — the quiet success color (check glyphs, saved copy). */
  affirmText: string
  /**
   * The accent slot (report §3.2 "tighten and complete the semantic set" —
   * Wave 4, previously promised at the stateLayer comment). The ink dialect:
   * ink900 on light, ink50 on dark — exactly what the selected-state surfaces
   * hardcoded before. Same values, now a named token the CI gate can check.
   */
  accent: string
  /** 12% accent wash — the selected-state surface tint (same alpha family as the macro tints). */
  accentTint: string
  /** Low-alpha washes for "tinted card" moments — the only sanctioned way to tint. */
  affirmTint: string
  uncertainTint: string
  proteinTint: string
  /** Macro identity tints (Wave 2 Badge) — one per macro, same alpha family. */
  carbsTint: string
  fatTint: string
  /** A barely-there raised row inside an elevated card. */
  rowRaised: string
  /**
   * Skeleton placeholders (UI/UX report §9.2, Wave 1c): the resting block is
   * 8% ink — quiet structure, never a spinner — and the ONE slow shimmer
   * sweep (Table 9.1: 1.2s loop, 20% band) runs a lighter overlay across it.
   * Dark mirrors with white ink, same alphas.
   */
  /** Resting skeleton fill: 8% ink (light) / 8% white (dark). */
  skeletonBase: string
  /** The moving sweep band: a lighter overlay crossing the resting fill. */
  skeletonSweep: string
  /**
   * Onboarding chrome fills (QA P2-19). These exist so the flow's light-gray
   * surfaces come from tokens instead of `theme.isDark ? token : hex`
   * ternaries — dark mode gets a contrast-checked value, not a leftover.
   * Each light value preserves the exact hex the ternaries used.
   */
  /** Track/step surfaces one step stronger than bgSunken (progress track, disabled CTA). */
  bgSunkenStrong: string
  /** The circular back button fill on onboarding headers. */
  bgChrome: string
  /** Wells inside an elevated card (option glyph circle, segmented track). */
  bgSunkenVariant: string
  isDark: boolean
}

export const lightTheme: Theme = {
  bg: palette.white,
  bgElevated: palette.white,
  bgSunken: palette.ink50,
  border: palette.ink200,
  text: palette.ink900,
  textMuted: palette.ink500,
  // Wave 1a (report §11): ink400 (3.40:1 on white) failed AA for the caption
  // tier. ink450 is 5.01:1 on white — every faint text now passes 4.5:1. No
  // single hex can pass 4.5:1 on BOTH white and ink900 (the luminance window
  // is empty), so the faint tier stays theme-resolved like every other role.
  textFaint: palette.ink450,
  ring: palette.ink900,
  ringTrack: palette.ink100,
  protein: palette.protein,
  // Wave 4: light `carbs` was the palette hex #F2A93B — 2.00:1 on white,
  // failing even the 3:1 graphical bar for ring strokes and chart series.
  // The computed grade #C68607 is 3.08:1; the palette hex stays the artwork /
  // brand identity value.
  carbs: '#C68607',
  fat: palette.fat,
  uncertain: palette.uncertain,
  uncertainBg: palette.uncertainBg,
  safety: palette.safety,
  safetyBg: palette.safetyBg,
  affirm: palette.affirm,
  heart: palette.heart,
  // Wave 4 text grades (report Table 11.1): darker grades of the identity
  // hues — 5.38 / 5.57 / 5.25 / 5.79 / 5.74 :1 on white. Identity colors stay
  // on icons/strokes/tints; every Text color migrates to these slots.
  proteinText: '#2E63D9',
  carbsText: '#8F5E05',
  fatText: '#7B5EA7',
  uncertainText: '#6754C2',
  affirmText: '#1E744C',
  // The accent slot: the ink dialect the selected-state surfaces hardcoded
  // (stateLayer.selected / the Button's t.text fill). Same hexes, now named.
  accent: palette.ink900,
  accentTint: '#0B0B0F1F',
  affirmTint: '#2E9E6B1A',
  uncertainTint: '#8B7BD81A',
  proteinTint: '#3E7BFA1A',
  // Wave 2 (report Table 5.1 "Badge/Chip — one Badge with variants"): the
  // macro identity tints, same 0x1A ≈ 10% alpha family as proteinTint, so the
  // Badge's macro variants never hand-roll a wash. Wave 4: carbTint follows its
  // recomputed light identity grade (was #F2A93B1A).
  carbsTint: '#C686071A',
  fatTint: '#7B5EA71A',
  rowRaised: '#0B0B0F08',
  // 0x14 = 20/255 ≈ 7.8% ink; 0xA6 = 166/255 ≈ 65% white for the sweep band.
  skeletonBase: '#0B0B0F14',
  skeletonSweep: '#FFFFFFA6',
  bgSunkenStrong: '#EDEDF0',
  bgChrome: '#F3F3F6',
  bgSunkenVariant: '#F0F0F3',
  isDark: false,
}

/**
 * Dark theme.
 *
 * Wave 1a (report §11): the caption/muted pairs are now COMPUTED, not eyeballed
 * (type-scale.test.ts recomputes them every run):
 *   textFaint ink400 #8A8A99 → 5.78:1 on bg ink900, 5.30:1 on bgElevated ink800
 *   textMuted ink300 #B8B8C4 → 10.00:1 on bg ink900, 9.17:1 on bgElevated ink800
 * Wave 4 (report Table 11.1 "compute all pairs") closes the matrix: the FULL
 * pair set — macros, uncertain, safety, badges, the new text grades and the
 * accent slot — is computed by `scripts/check-contrast.mjs` on every CI run,
 * mirrored across both themes. The dark theme passes every pair (text 18.37:1
 * on bg down to badge pairs ≥4.79:1); there is nothing left to eyeball.
 */
export const darkTheme: Theme = {
  bg: palette.ink900,
  bgElevated: palette.ink800,
  bgSunken: palette.ink900,
  border: palette.ink700,
  text: palette.ink50,
  textMuted: palette.ink300,
  textFaint: palette.ink400,
  ring: palette.ink50,
  ringTrack: palette.ink700,
  protein: '#6E9BFF',
  carbs: '#F5BC63',
  fat: '#A288CC',
  uncertain: '#A99AE6',
  uncertainBg: '#241F38',
  safety: '#F0655B',
  safetyBg: '#3A1E1C',
  affirm: '#4FBE8C',
  heart: '#F2766B',
  // Wave 4 text grades: the dark identity colors already cleared the 4.5:1
  // text bar (computed, §9 of the Wave 4 spec), so the dark grades are the
  // same hexes — no visual change in dark mode.
  proteinText: '#6E9BFF',
  carbsText: '#F5BC63',
  fatText: '#A288CC',
  uncertainText: '#A99AE6',
  affirmText: '#4FBE8C',
  // The accent slot, dark dialect: white-ink, exactly what the dark
  // selected-state surfaces hardcoded.
  accent: palette.ink50,
  accentTint: '#F7F7FA1F',
  affirmTint: '#4FBE8C26',
  uncertainTint: '#A99AE626',
  proteinTint: '#6E9BFF26',
  // Dark mirrors the macro tints at the same 0x26 ≈ 15% alpha.
  carbsTint: '#F5BC6326',
  fatTint: '#A288CC26',
  rowRaised: '#FFFFFF0A',
  // Same 8% alpha, white ink on near-black; the sweep stays subtle (18%).
  skeletonBase: '#FFFFFF14',
  skeletonSweep: '#FFFFFF2E',
  bgSunkenStrong: palette.ink700,
  bgChrome: palette.ink800,
  bgSunkenVariant: palette.ink900,
  isDark: true,
}

/** 4pt base scale. Every margin in the app is one of these. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  // Wave 1a (report §4.3): the bottom-sheet radius — sits between lg (16) and
  // xl (24), matching modern sheet conventions. Wave 2's Sheet primitive is the
  // first consumer.
  sheet: 20,
  xl: 24,
  pill: 999,
} as const

/**
 * The canonical seven-step type scale (UI/UX report Table 3.1, Wave 1).
 *
 * Every text style in the app resolves to one of these eight entries
 * (bodyStrong is the weight-600 variant of body). A vitest gate
 * (src/theme/type-scale.test.ts) fails CI on any ad-hoc fontSize literal in
 * app/, src/components/, src/ui/ or src/onboarding/ — the 17 drifting sizes the
 * report audited (§3.3) cannot regrow.
 *
 * `monoData` carries tabular numerals so every macro number, ring readout and
 * diary row aligns digit-for-digit — the report's highest-leverage
 * typographic upgrade for a numbers app (§4.2).
 */
const canonicalType = {
  display: { fontSize: 56, lineHeight: 60, fontWeight: '800' as const, letterSpacing: -1.5 },
  title: { fontSize: 28, lineHeight: 32, fontWeight: '700' as const, letterSpacing: -0.5 },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' as const },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '500' as const },
  // The caption floor. 11px micro on faint grey failed AA (report §11); the
  // floor is now 12.5px paired with the darker ink450 faint colour.
  caption: { fontSize: 12.5, lineHeight: 16, fontWeight: '400' as const },
  monoData: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600' as const,
    // `as const` would make this a readonly tuple, which TextStyle's mutable
    // FontVariant[] rejects — cast to the exact property type instead.
    fontVariant: ['tabular-nums'] as TextStyle['fontVariant'],
  },
} as const

export const type = {
  ...canonicalType,
  // ---------------------------------------------------------------------
  // DEPRECATED aliases (UI/UX report Table 3.1). The Wave 1a sweep renamed
  // every in-app reference to the canonical names above; these aliases only
  // exist so stragglers outside the swept directories keep compiling. Delete
  // them once Wave 3 has rebuilt the last screen.
  /** @deprecated use type.display */
  hero: canonicalType.display,
  /** @deprecated use type.caption (the 11px micro tier is retired, §11) */
  micro: canonicalType.caption,
} as const

/**
 * Elevation — the layer this app never had (report §3.2, §4.3).
 *
 * Three levels only: subtle for resting cards, medium for floating elements
 * (the FAB, the ActiveWorkout card), high for sheets and dialogs. Consumers
 * spread the level into a View style; the shadows are ink-based so they read
 * on any surface, and `elevation` covers Android where RN ignores shadow*.
 */
export const elevation = {
  subtle: {
    shadowColor: '#0B0B0F',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  medium: {
    shadowColor: '#0B0B0F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
  },
  high: {
    shadowColor: '#0B0B0F',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 28,
    elevation: 12,
  },
} as const

export type ElevationLevel = keyof typeof elevation

/**
 * Dark-mode elevation strategy (report §4.3): shadows are invisible on
 * near-black backgrounds, so each level lightens the BORDER instead — a
 * lighter edge reads as "closer to you" exactly where a shadow would. Return
 * the style for a level in either mode; do not hand-roll shadow values.
 */
export const darkElevationBorder = {
  subtle: { borderWidth: 1, borderColor: '#22222B' },
  medium: { borderWidth: 1, borderColor: '#3A3A46' },
  high: { borderWidth: 1.5, borderColor: '#5C5C6B' },
} as const

export const elevationStyle = (level: ElevationLevel, isDark: boolean): ViewStyle =>
  isDark ? { ...darkElevationBorder[level] } : { ...elevation[level] }

/**
 * State layers (report §4.3) — the four interaction states every control owes
 * its users, tokenized once so five different pressed behaviours cannot
 * regrow (§3.6). Wave 4: the accent slot the report demanded (§3.2) HAS now
 * landed (`theme.accent` / `theme.accentTint`) — the values below are the
 * light dialect of exactly those tokens, kept here as the spread-compatible
 * style objects consumers import. `t.accent`/`t.accentTint` are the refs to
 * reach for in JSX; these objects are the style layer.
 *
 * Alpha hexes: 6% ink ≈ 0x0F (15/255 = 5.9%), 12% ≈ 0x1F (31/255 = 12.2%).
 *
 * Spread-order contract: disabled must come AFTER any elevation level in the
 * style array — it zeroes shadowOpacity/elevation so a disabled control never
 * floats (report: "38% opacity plus no shadow").
 */
export const stateLayer = {
  /** Pressed: 6% ink overlay composited over the resting surface. */
  pressed: { backgroundColor: '#0B0B0F0F' },
  /** Disabled: 38% opacity and no shadow. */
  disabled: { opacity: 0.38, shadowOpacity: 0, elevation: 0 },
  /** Selected: accent tint at 12%. */
  selected: { backgroundColor: '#0B0B0F1F' },
  /** Focus: 2px accent ring — web / external-keyboard users only. */
  focus: { borderWidth: 2, borderColor: '#0B0B0F' },
} as const

/** Dark mirror: the ink overlay flips to white ink on near-black surfaces. */
export const stateLayerDark = {
  pressed: { backgroundColor: '#FFFFFF0F' },
  disabled: { opacity: 0.38, shadowOpacity: 0, elevation: 0 },
  selected: { backgroundColor: '#F7F7FA1F' },
  focus: { borderWidth: 2, borderColor: '#F7F7FA' },
} as const

export const stateLayerFor = (isDark: boolean) => (isDark ? stateLayerDark : stateLayer)

/**
 * Motion durations, in ms.
 *
 * Every one of these is multiplied by the motionScale from the Reduce Motion
 * context (1 or 0). At 0 the transforms become opacity crossfades and nothing
 * loops — the result reveal must still communicate arrival without movement.
 */
export const motion = {
  instant: 90,
  fast: 160,
  base: 240,
  slow: 380,
  reveal: 520,
} as const

/** Minimum tap target. Anything smaller MUST set hitSlop — an ESLint rule checks. */
export const MIN_TAP_TARGET = 44
