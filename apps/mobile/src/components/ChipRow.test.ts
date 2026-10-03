import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Wave 5C (AA fix, docs/design-system.md §7) — the filled option-chip pair.
 *
 * The ChipRow selected state (and its hand-rolled siblings: the
 * indian-dishes filter chips, the food-search quick-add ingredient chips and
 * the dish-composer yield/method chips) used to render a SOLID
 * `theme.protein` fill with a `theme.bg` label — 3.88:1 in light, the last
 * accepted contrast deviation. They now render the Badge macro dialect
 * (Badge.test.ts locks the same pair for the Badge variants):
 * `proteinTint` wash + `proteinText` label + `protein` border — 4.78:1
 * (light) / 6.00:1 (dark) for the label, 3.44:1 / 6.00:1 for the border,
 * both gated in scripts/check-contrast.mjs as the "filled option-chip" pairs
 * composited over the page bg. Selection never rides colour alone:
 * accessibilityState.selected stays on every chip.
 *
 * Expo screens cannot run under plain Node (Badge.test.ts constraint), so
 * this is a source sweep over the real files — the same convention as
 * wave3-food.test.ts / wave2-nav.test.ts.
 */

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, rel), 'utf8')

const chipRow = read('ChipRow.tsx')
const indianDishes = read('../../app/indian-dishes.tsx')
const foodSearch = read('../../app/food-search.tsx')
const dishComposer = read('../../app/dish-composer.tsx')
// The gate that computes the pair's WCAG ratios from tokens.ts.
const contrastGate = read('../../../../scripts/check-contrast.mjs')

describe('ChipRow selected state — the Badge macro dialect (Wave 5C)', () => {
  it('selected = proteinTint fill + protein border + proteinText label', () => {
    expect(chipRow).toContain('backgroundColor: active ? theme.proteinTint : theme.bg')
    expect(chipRow).toContain('borderColor: active ? theme.protein : theme.border')
    expect(chipRow).toContain('color: active ? theme.proteinText : theme.text')
  })

  it('the retired solid-protein fill pair cannot regrow (3.88:1 light)', () => {
    expect(chipRow).not.toMatch(/backgroundColor:\s*active\?\s*theme\.protein\s*:/)
    expect(chipRow).not.toMatch(/color:\s*active\?\s*theme\.bg\s*:/)
  })

  it('selection is still spoken, never colour-only', () => {
    expect(chipRow).toContain('accessibilityState={{ selected: active }}')
    expect(chipRow).toContain('MIN_TAP_TARGET')
  })
})

describe('the hand-rolled siblings render the same dialect (one family)', () => {
  it('indian-dishes filter chips: tint + text label, not the solid fill', () => {
    expect(indianDishes).toContain('filter === f ? t.proteinTint : t.bgSunken')
    expect(indianDishes).toContain('filter === f ? t.proteinText : t.text')
    expect(indianDishes).toContain('filter === f ? t.protein : t.border')
    expect(indianDishes).not.toContain('filter === f ? t.protein : t.bgSunken')
    expect(indianDishes).not.toContain('filter === f ? t.bg : t.text')
  })

  it('food-search quick-add ingredient chips: tint + text label', () => {
    expect(foodSearch).toContain('backgroundColor: picked ? theme.proteinTint : theme.bg')
    expect(foodSearch).toContain('borderColor: picked ? theme.protein : theme.border')
    expect(foodSearch).toContain('color: picked ? theme.proteinText : theme.text')
    // The retired chip pair (the "Review & log dish" BUTTON fill further down
    // is a button, not a chip — it keeps its own pattern and is recorded as a
    // design-system §7 residual, so the negative must stay chip-specific).
    expect(foodSearch).not.toContain(
      'backgroundColor: decompItems.some((row) => row.foodId === item.foodId) ? theme.protein : theme.bg',
    )
  })

  it('dish-composer yield + method chips: tint + text label', () => {
    expect(dishComposer).toContain('useRecipeYield ? t.proteinTint : t.bg')
    expect(dishComposer).toContain('useRecipeYield ? t.proteinText : t.text')
    expect(dishComposer).toContain('active ? t.proteinTint : t.bg')
    expect(dishComposer).toContain('color: active ? t.proteinText : t.text')
    expect(dishComposer).not.toContain('useRecipeYield ? t.protein : t.bg')
    expect(dishComposer).not.toMatch(/backgroundColor:\s*active\?\s*t\.protein\s*:/)
  })
})

describe('the contrast gate carries the filled-chip pair (no silent drop)', () => {
  it('the manifest gates the label AND border pairs over the page bg', () => {
    expect(contrastGate).toContain(
      "pairs.push({ fg: 'proteinText', wash: 'proteinTint', base: 'bg', mode: 'text', note: 'filled option-chip label on its tint over the page (ChipRow selected)' })",
    )
    expect(contrastGate).toContain(
      "pairs.push({ fg: 'protein', wash: 'proteinTint', base: 'bg', mode: 'graphical', note: 'filled option-chip border on its tint over the page' })",
    )
  })
})
