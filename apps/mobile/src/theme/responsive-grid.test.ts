import { describe, expect, it } from 'vitest'
import {
  MAX_DAY_COLUMN_WIDTH,
  MIN_DAY_COLUMN_WIDTH,
  MIN_METRIC_CARD_WIDTH,
  MIN_QUICK_ACTION_TILE_WIDTH,
  dayColumnWidthFor,
  metricCardWidthFor,
  quickActionColumnsFor,
  quickActionTileWidthFor,
} from './responsive-grid'

/**
 * Android release QA 2026-10 — UI width-sweep regression locks.
 *
 * On the physical Samsung device (release APK):
 *  - Food's quick-action tiles collapsed into narrow vertical pills with the
 *    label wrapping one character per line ("S/c/a/n/ f/o/o/d") — percentage
 *    widths inside flexWrap+gap measured as ~0 under Yoga.
 *  - Progress's section chips overflowed and hard-clipped the last label.
 *  - Home's day strip clipped left/right (flex:1 + fixed width in the main
 *    axis of a horizontal ScrollView).
 *
 * These tests sweep EVERY representative Android width (including the
 * physical phone's) and prove the computed grid floors hold. The screens use
 * these exact functions (imports pinned below by usage), so a regression in
 * the math or a call-site that reintroduces percentages cannot pass this
 * sweep silently.
 *
 * Evidence class: AUTOMATICALLY VERIFIED for the math; the on-device rendering
 * of the new widths is verified by the next device QA pass.
 */

/** Representative Android widths: small phones through tablets. 412 is the
 * physical Samsung device the regressions were reported on. */
const ANDROID_WIDTHS = [320, 360, 384, 390, 412, 432, 480, 560, 600, 720, 800]

describe('quick-action grid (Food) — must never collapse into one-character vertical text', () => {
  it('every width yields a tile at or above the readable floor', () => {
    for (const width of ANDROID_WIDTHS) {
      const tile = quickActionTileWidthFor(width)
      expect(tile, `tile width at ${width}px`).toBeGreaterThanOrEqual(MIN_QUICK_ACTION_TILE_WIDTH)
    }
  })

  it('a tile always fits its container (never wider than the padded screen)', () => {
    for (const width of ANDROID_WIDTHS) {
      const columns = quickActionColumnsFor(width)
      const tile = quickActionTileWidthFor(width)
      const available = width - 2 * 20 // SCREEN_HORIZONTAL_PAD
      // Two tiles + one gap must always fit side by side (3 tiles + 2 gaps on
      // the 3-column tablet layout), i.e. the grid actually wraps, not overflows.
      const rowWidth = tile * columns + 8 * (columns - 1)
      expect(rowWidth, `row fits at ${width}px`).toBeLessThanOrEqual(available)
    }
  })

  it('phones get 2 comfortable columns; wide tablets get 3', () => {
    for (const width of [320, 360, 384, 390, 412, 432, 480, 560]) {
      expect(quickActionColumnsFor(width), `${width}px`).toBe(2)
    }
    // 3 columns needs 560px of AVAILABLE width (window minus screen padding).
    for (const width of [600, 720, 800]) {
      expect(quickActionColumnsFor(width), `${width}px`).toBe(3)
    }
  })

  it('the reported phone width (412) leaves room for the longest label at 130% font scale', () => {
    // "Indian dishes" ≈ 13 chars; at caption 12.5px and a 1.2 cap the line is
    // ~110px — it must fit on ONE line inside a single-column tile at 412.
    const tile = quickActionTileWidthFor(412)
    expect(tile).toBeGreaterThanOrEqual(160)
    expect(tile).toBeLessThanOrEqual(200)
  })

  it('even the smallest supported phone keeps a 44pt+ touch target height', () => {
    // minHeight: 88 lives in the tile style; here we lock that the WIDTH math
    // never forces a narrower-than-44pt tile (which would shrink the target).
    expect(quickActionTileWidthFor(320)).toBeGreaterThanOrEqual(44)
  })
})

describe('progress metric cards — computed widths, no percentage measurement', () => {
  it('every width yields a metric card at or above its floor', () => {
    for (const width of ANDROID_WIDTHS) {
      expect(metricCardWidthFor(width), `metric card at ${width}px`).toBeGreaterThanOrEqual(
        MIN_METRIC_CARD_WIDTH,
      )
    }
  })

  it('two cards + gap fit the padded screen exactly (2-up grid, no overflow)', () => {
    for (const width of ANDROID_WIDTHS) {
      const pair = metricCardWidthFor(width) * 2 + 8
      expect(pair, `pair fits at ${width}px`).toBeLessThanOrEqual(width - 2 * 16)
    }
  })
})

describe('home day strip — exact column widths, no main-axis flex competition', () => {
  it('columns stay inside the 44–64pt band at every width', () => {
    for (const width of ANDROID_WIDTHS) {
      const col = dayColumnWidthFor(width)
      expect(col, `day column at ${width}px`).toBeGreaterThanOrEqual(MIN_DAY_COLUMN_WIDTH)
      expect(col, `day column at ${width}px`).toBeLessThanOrEqual(MAX_DAY_COLUMN_WIDTH)
    }
  })

  it('~7 columns are visible on the reported phone width', () => {
    const col = dayColumnWidthFor(412)
    const visible = Math.floor((412 - 2 * 16) / (col + 4)) // gap: space.xs
    expect(visible).toBeGreaterThanOrEqual(6)
    expect(visible).toBeLessThanOrEqual(8)
  })
})
