import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * UI/UX report §7.1 + Ch. 8.3 (Wave 3) — "Food: the write surface".
 *
 * The app/ screens sit behind expo imports vitest's node environment cannot
 * load, so their wiring is pinned by SOURCE SWEEP (the established pattern —
 * wave3-home.test.ts, model-hint.test.ts, wave2-nav.test.ts). The pure
 * derivations the Food tab consumes (slot choice from time of day, preset
 * grams, the one-tap write + undo revert) are unit-tested in
 * src/data/one-tap-log.test.ts; the meal-detail row actions' data layer in
 * logged-meals.test.ts. Runtime behaviour (cards render, one tap logs, toast
 * undo reverts, zero console errors) is verified in the headless browser pass
 * for this wave.
 */

const here = dirname(fileURLToPath(import.meta.url))
const foodTab = readFileSync(join(here, '..', '..', 'app', '(tabs)', 'food.tsx'), 'utf8')
const homeTab = readFileSync(join(here, '..', '..', 'app', '(tabs)', 'index.tsx'), 'utf8')
const foodSearch = readFileSync(join(here, '..', '..', 'app', 'food-search.tsx'), 'utf8')
const foodReview = readFileSync(join(here, '..', '..', 'app', 'food-review.tsx'), 'utf8')
const mealDetail = readFileSync(join(here, '..', '..', 'app', 'meal-detail.tsx'), 'utf8')
const ingredientForm = readFileSync(join(here, 'NewIngredientForm.tsx'), 'utf8')
const dishComposer = readFileSync(join(here, '..', '..', 'app', 'dish-composer.tsx'), 'utf8')

describe('§7.1 item 1 — the Food tab is the write surface; the DayTimeline duplicate dies here', () => {
  it('food.tsx contains NO DayTimeline import or mount — the second copy is gone entirely', () => {
    expect(foodTab).not.toContain('DayTimeline')
  })

  it('Home KEEPS its timeline copy — the read surface stays whole', () => {
    expect(homeTab).toContain("from '../../src/components/DayTimeline'")
    expect(homeTab).toMatch(/<DayTimeline selectedDate=\{localDate\(selected\)\} hideDateControls hideTotals \/>/)
  })

  it('everything the timeline offered on Food stays reachable through write-surface actions', () => {
    // Log food → the large primary entry (also pinned by e2e p2-regression).
    expect(foodTab).toMatch(/label="Log food"/)
    // Repeat meal → the one-tap cards (oneTapLog).
    expect(foodTab).toContain('oneTapLog')
    // Copy yesterday → quick action with its Undo toast.
    expect(foodTab).toContain('copyYesterday')
    expect(foodTab).toMatch(/Yesterday's meals were added to today\./)
  })
})

describe('§7.1 item 2 + Ch. 8.3 — the shortcut strip is ONE-TAP LOGGING CARDS', () => {
  it('each card shows the meal name, its gram preset, and a plus glyph', () => {
    expect(foodTab).toMatch(/g preset/)
    expect(foodTab).toMatch(/name="plus"/)
    expect(foodTab).toContain('presetGrams')
  })

  it('a repeat log is a single tap through the repo repeat path — never an ad-hoc write', () => {
    // oneTapLog → repeatSnapshots (immutable snapshots + recordOperation).
    expect(foodTab).toContain('oneTapLog(')
    expect(foodTab).not.toMatch(/INSERT INTO/)
  })

  it('the tap fires the success haptic and the Meal-logged Undo toast', () => {
    expect(foodTab).toContain('hapticSuccess()')
    expect(foodTab).toMatch(/message: 'Meal logged\.'/)
    expect(foodTab).toContain('undoLastOperation')
  })

  it('all five shortcut sources remain (Recent, Frequent, Favorites, Usual, Saved)', () => {
    for (const mode of ['Recent', 'Frequent', 'Favorites', 'Usual', 'Saved']) {
      expect(foodTab).toContain(`'${mode}'`)
    }
    expect(foodTab).toContain('recentFoodsWithGrams')
    expect(foodTab).toContain('oneTapCardFromShortcut')
  })

  it('the long-press row menu keeps shortcut removal and meal-detail reachable', () => {
    expect(foodTab).toContain('onLongPress')
    expect(foodTab).toContain('MenuSheet')
    expect(foodTab).toContain('removeShortcut')
    expect(foodTab).toMatch(/pathname: '\/meal-detail'/)
  })

  it('press feedback + chip toggles ride the shared primitives and haptics map', () => {
    expect(foodTab).toContain('PressableFX')
    expect(foodTab).toContain('ChipRow')
    expect(foodTab).toContain('selectionAsync')
  })
})

describe('§7.1 item 3 — quick actions are an icon grid with distinct glyphs', () => {
  it('the grid renders six tiles, each with its own glyph', () => {
    const glyphs = ['scan', 'lotus', 'bookOpen', 'pencil', 'bookmark', 'clock']
    for (const glyph of glyphs) {
      expect(foodTab).toMatch(new RegExp(`icon: '${glyph}'`))
    }
    // No glyph reused across tiles.
    const iconUses = foodTab.match(/icon: '([a-zA-Z]+)'/g) ?? []
    const names = iconUses.map((u) => u.replace(/icon: '|'/g, ''))
    expect(new Set(names).size).toBe(names.length)
  })

  it('saved meals, recipes, and the Indian dish library have clear entries', () => {
    expect(foodTab).toMatch(/label: 'Saved meals'/)
    expect(foodTab).toMatch(/label: 'Recipes'/)
    expect(foodTab).toMatch(/label: 'Indian dishes'/)
  })
})

describe('Ch. 8.3 item 5 — food-search is search-first; the decomposer and ingredient creator sit behind clear entry points', () => {
  it('the search surface stays first: query field + results + recent chips', () => {
    expect(foodSearch).toContain('accessibilityLabel="Search foods"')
    expect(foodSearch).toContain('recentFoodsWithGrams')
    expect(foodSearch).toMatch(/Search recent food/)
  })

  it('a labeled entry row opens the unknown-dish builder (not a stacked inline section)', () => {
    expect(foodSearch).toContain('accessibilityLabel="Build a dish from ingredients"')
  })

  it('the decomposer renders inside its own Modal surface with a close affordance', () => {
    expect(foodSearch).toMatch(/<Modal[\s\S]*visible=\{showDecompose\}/)
    expect(foodSearch).toContain('accessibilityLabel="Close dish decomposition"')
    expect(foodSearch).toMatch(/animationType="slide"/)
  })

  it('the on-the-spot ingredient creator stays INSIDE the decomposer surface and shares the ONE form', () => {
    expect(foodSearch).toContain('NewIngredientForm')
    expect(dishComposer).toContain('NewIngredientForm')
    // The rebuilt form rides the Field primitive — no private TextInput dialects.
    expect(ingredientForm).toContain("from './Field'")
    expect(ingredientForm).not.toMatch(/borderRadius: 12|borderRadius: 8/)
  })

  it('the zero-match Decompose entry still exists (functionality reorganized, not deleted)', () => {
    expect(foodSearch).toMatch(/Decompose .\{query\}. into Ingredients/)
    expect(foodSearch).toContain('openDecompose(query)')
  })
})

describe('Ch. 8.3 item 6 — food-review is a stepper', () => {
  it('quantity and unit are confirmed in one card with large touch ladders', () => {
    expect(foodReview).toContain('How much')
    expect(foodReview).toMatch(/label="How many"/)
    expect(foodReview).toMatch(/label="Total grams"/)
    // The gram ladder chips + 44pt steppers.
    expect(foodReview).toMatch(/Set \$\{preset\} grams/)
    expect(foodReview).toMatch(/width: MIN_TAP_TARGET/)
  })

  it('the slot picker is a segmented row', () => {
    expect(foodReview).toMatch(/styles\.slotRow/)
    expect(foodReview).toMatch(/slotFirst/)
    expect(foodReview).toMatch(/slotLast/)
  })

  it('a sticky summary footer carries the totals and the log button', () => {
    expect(foodReview).toMatch(/styles\.footer/)
    expect(foodReview).toMatch(/label=\{busy \? 'Saving…' : 'Save to diary'\}/)
    expect(foodReview).toMatch(/type\.monoData/)
  })

  it('every existing behavior is kept: piece-weight sync, dish breakdown, composer jump, undo toast, haptic', () => {
    expect(foodReview).toMatch(/updateQuantity|updateUnitGrams|updateGrams/)
    expect(foodReview).toContain(`What's inside`)
    expect(foodReview).toMatch(/pathname: '\/dish-composer'/)
    expect(foodReview).toMatch(/message: 'Meal logged\.'/)
    expect(foodReview).toContain('hapticSuccess')
  })
})

describe('Ch. 8.3 item 7 — meal-detail rows adopt the row-action pattern', () => {
  it('rows are summaries with a long-press + visible dot3 affordance opening the Sheet menu', () => {
    expect(mealDetail).toContain('onLongPress')
    expect(mealDetail).toContain('MenuSheet')
    expect(mealDetail).toMatch(/name="dot3"/)
  })

  it('the menu carries edit / duplicate / remove — no per-row text buttons', () => {
    expect(mealDetail).toMatch(/label: 'Edit item'/)
    expect(mealDetail).toMatch(/label: 'Duplicate item'/)
    expect(mealDetail).toMatch(/label: 'Remove item'/)
    // The old always-open per-item Field pairs are gone; editing is expanded
    // per-row through the menu/tap.
    expect(mealDetail).toContain('editingItemId')
  })

  it('duplicate/remove ride the operation ledger with Undo toasts', () => {
    expect(mealDetail).toContain('duplicateLoggedItem')
    expect(mealDetail).toContain('removeLoggedItem')
    expect(mealDetail).toMatch(/label: 'Undo'/)
    expect(mealDetail).toContain('undoOperation')
  })

  it('the destructive meal delete still goes through confirmDialog', () => {
    expect(mealDetail).toContain('confirmDialog(')
  })
})
