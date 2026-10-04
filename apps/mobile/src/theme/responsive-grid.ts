import { space } from './tokens'

/**
 * Pure responsive-grid math for the Android release QA (2026-10) layout fixes.
 *
 * The on-device failures all came from Yoga measuring percentage widths
 * (`width: '31%'` / `'48%'`) inside `flexWrap` + `gap` containers against an
 * under-determined available width — tiles collapsed to ~0 and their labels
 * wrapped one character per line. Every grid now computes EXACT pixel widths
 * from the window width. These helpers are pure so a width sweep (see
 * responsive-grid.test.ts) can prove, for every representative Android width,
 * that no tile can ever measure below a readable floor.
 */

/**
 * Screen.tsx's scroll content pads `space.lg + 4` per side — the real inset
 * every in-Screen grid lives inside. Keep in sync with Screen.tsx
 * contentContainerStyle (the type system cannot see it).
 */
export const SCREEN_HORIZONTAL_PAD = space.lg + 4

/** Window width (minus screen padding) at which grids earn a third column. */
export const TABLET_GRID_MIN_WIDTH = 560

/** Smallest acceptable quick-action tile width (icon + 2-line caption). */
export const MIN_QUICK_ACTION_TILE_WIDTH = 104
/** Smallest acceptable progress metric-card width. */
export const MIN_METRIC_CARD_WIDTH = 140
/** Day-strip column bounds (44pt touch floor, ~7 columns on a phone). */
export const MIN_DAY_COLUMN_WIDTH = 44
export const MAX_DAY_COLUMN_WIDTH = 64

export function quickActionColumnsFor(windowWidth: number): number {
  return windowWidth - SCREEN_HORIZONTAL_PAD * 2 >= TABLET_GRID_MIN_WIDTH ? 3 : 2
}

export function quickActionTileWidthFor(windowWidth: number): number {
  const columns = quickActionColumnsFor(windowWidth)
  return Math.floor(
    (windowWidth - SCREEN_HORIZONTAL_PAD * 2 - space.sm * (columns - 1)) / columns,
  )
}

export function metricCardWidthFor(windowWidth: number): number {
  return Math.floor((windowWidth - space.lg * 2 - space.sm) / 2)
}

export function dayColumnWidthFor(windowWidth: number): number {
  return Math.min(
    MAX_DAY_COLUMN_WIDTH,
    Math.max(MIN_DAY_COLUMN_WIDTH, Math.floor((windowWidth - space.lg * 2 - space.xs * 6) / 7)),
  )
}
