import { beforeEach, describe, expect, it } from 'vitest'
import type { Band } from '@nutai/confidence'
import type { IngredientRow, LoggedMeal } from '@nutai/core-schema'
import { recomputeAfterEdit } from '@nutai/pipeline'
import type { ScanResult } from '@nutai/pipeline'
import { QUESTION_BANK, type SelectedQuestion } from '@nutai/repair'
import {
  countAnswerValue,
  countMultiplierFor,
  estimateProvenanceLabel,
  formatInt,
  isWideTier,
  likelyRangeLabel,
  mealTitleFor,
  modelCountFor,
  portionRangeFor,
  quickSetGramsFor,
  roundForUncertainty,
  rowIdForNamedQuestion,
  sceneCaptionFor,
} from './review'
import type {
  ModelHighImpactQuestion,
  PortionContext,
  PreparationInfo,
} from './review'
import {
  preparationNoteFor,
  portionConfidenceNoteFor,
  shouldShowModelQuestionCard,
  summaryLinesFor,
  topUncertaintyFor,
} from './review'
import { answerQuestion, editGrams, getPhase, reset, setPhase } from './store'

/**
 * Pure-logic tests for the review screen's presentation rules (task 2-d).
 *
 * WHY no component-render tests: apps/mobile has no @testing-library/react-native
 * in its devDependencies, so result.tsx cannot render under the repo's
 * node-only vitest setup. The RULES the screen obeys were therefore extracted
 * into src/scan/review.ts (node-pure) and are tested here, together with the
 * store mutations the screen drives. The JSX itself is a thin renderer of
 * these already-tested decisions.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const band = (halfPct: number, tier: Band['tier']): Band => ({ halfPct, tier, reasons: [] })

function row(over: Partial<IngredientRow> = {}): IngredientRow {
  return {
    id: 'r1',
    displayName: 'Grilled chicken breast',
    sourceFoodId: '1',
    grams: 170,
    nutrientSnapshot: { kcal: 165, protein_g: 31, fat_g: 3.6, carbs_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 74 },
    origin: 'vision_model',
    gramPathway: 'fndds_standard_portion' as IngredientRow['gramPathway'],
    bandHalfPct: 0.2,
    isEstimate: false,
    assumptions: [],
    ...over,
  }
}

function readyWith(rows: IngredientRow[]): void {
  const meal: LoggedMeal = {
    id: 'm1',
    loggedAt: '2026-08-01T12:00:00Z',
    ingredients: rows,
    portionEatenFraction: 1,
    engineId: 'test',
    promptVersion: null,
    schemaVersion: null,
    clampFlags: [],
  }
  const bands: Band[] = rows.map((r) => band(r.bandHalfPct, 'moderate'))
  const { totals, mealBand } = recomputeAfterEdit(meal, bands)
  const result: ScanResult = {
    isFood: true,
    refusalReason: null,
    items: rows.map((r, i) => ({ row: r, band: bands[i]!, resolution: 'auto_accept', gramPathway: r.gramPathway })),
    meal,
    totals,
    mealBand,
    questions: [],
    clampFlags: [],
    zeroHitCount: 0,
  }
  setPhase({ kind: 'ready', photoUri: null, result, bands, meta: null, webLookups: {} })
}

const readyPhase = () => {
  const p = getPhase()
  if (p.kind !== 'ready') throw new Error(`expected ready, got ${p.kind}`)
  return p
}

function chipFor(id: string, text?: string): SelectedQuestion {
  const question = QUESTION_BANK.find((b) => b.id === id)!
  return {
    question,
    text: text ?? question.text,
    expectedValue: 0,
    state: 'highlighted',
    appliedDefault: null,
    disclosure: question.defaultDisclosure,
  }
}

beforeEach(() => reset())

// ---------------------------------------------------------------------------
// Thousands separator
// ---------------------------------------------------------------------------

describe('formatInt', () => {
  it('groups thousands and rounds', () => {
    expect(formatInt(1433)).toBe('1,433')
    expect(formatInt(2640)).toBe('2,640')
    expect(formatInt(950)).toBe('950')
    expect(formatInt(1234567)).toBe('1,234,567')
    expect(formatInt(926.25)).toBe('926')
  })
})

// ---------------------------------------------------------------------------
// Scene-based meal title (the "whole thali titled Chapati" bug)
// ---------------------------------------------------------------------------

describe('mealTitleFor', () => {
  const items = (names: string[]) => names.map((n, i) => ({ row: { displayName: n, id: `r${i}` } }))

  it('titles a multi-component scene from the scene, not items[0]', () => {
    expect(
      mealTitleFor({
        scene: { mealType: 'indian_thali', displayName: 'Indian mixed thali', confidence: 0.9 },
        sceneDisplayName: 'Indian mixed thali',
        items: items(['Chapati', 'Dal', 'Rice']),
      }),
    ).toBe('Indian mixed thali')
  })

  it('keeps the item name for a single-item composite (a pizza is "Pizza")', () => {
    expect(
      mealTitleFor({
        scene: { mealType: 'composite_dish', displayName: 'Pizza', confidence: 0.8 },
        sceneDisplayName: 'Pizza',
        items: items(['Pizza']),
      }),
    ).toBe('Pizza')
  })

  it('falls back to items[0] without a scene', () => {
    expect(mealTitleFor({ items: items(['Chapati', 'Dal']) })).toBe('Chapati')
    expect(mealTitleFor({ scene: null, sceneDisplayName: null, items: items(['Chapati']) })).toBe('Chapati')
  })

  it('falls back to items[0] when a multi-item scene carries no display name', () => {
    expect(
      mealTitleFor({
        scene: { mealType: 'indian_thali', displayName: '', confidence: 0.9 },
        sceneDisplayName: null,
        items: items(['Chapati', 'Dal']),
      }),
    ).toBe('Chapati')
  })

  it('ignores non-multi-component scene types', () => {
    expect(
      mealTitleFor({
        scene: { mealType: 'single_dish', displayName: 'Breakfast plate', confidence: 0.9 },
        sceneDisplayName: 'Breakfast plate',
        items: items(['Oatmeal', 'Banana']),
      }),
    ).toBe('Oatmeal')
  })

  it('names an empty meal', () => {
    expect(mealTitleFor({ items: [] })).toBe('Your meal')
  })
})

describe('sceneCaptionFor', () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ row: { displayName: `R${i}`, id: `r${i}` } }))

  it('adds the scene label and item count when the scene says something new', () => {
    expect(
      sceneCaptionFor({
        scene: { mealType: 'mixed_plate', displayName: 'Mixed Platter', confidence: 0.7 },
        sceneDisplayName: 'Indian mixed thali',
        items: items(8),
      }),
    ).toBe('mixed platter · 8 items')
  })

  it('stays silent when the caption would repeat the title', () => {
    expect(
      sceneCaptionFor({
        scene: { mealType: 'indian_thali', displayName: 'Indian mixed thali', confidence: 0.9 },
        sceneDisplayName: 'Indian mixed thali',
        items: items(8),
      }),
    ).toBeNull()
  })

  it('singularizes a one-item meal and stays silent without a scene', () => {
    expect(
      sceneCaptionFor({
        scene: { mealType: 'mixed_plate', displayName: 'Mixed plate', confidence: 0.6 },
        sceneDisplayName: null,
        items: items(1),
      }),
    ).toBe('mixed plate · 1 item')
    expect(sceneCaptionFor({ items: items(3) })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Uncertainty-honest hero number
// ---------------------------------------------------------------------------

describe('roundForUncertainty / isWideTier', () => {
  it('rounds to the nearest 100 with an ≈ anchor on wide tiers', () => {
    expect(roundForUncertainty(1433, 'wide')).toBe('≈ 1,400')
    expect(roundForUncertainty(1388, 'very_wide')).toBe('≈ 1,400')
    expect(roundForUncertainty(2755, 'very_wide')).toBe('≈ 2,800')
  })

  it('keeps the exact figure (grouped) on tight/moderate/none tiers', () => {
    expect(roundForUncertainty(1433, 'moderate')).toBe('1,433')
    expect(roundForUncertainty(1433, 'tight')).toBe('1,433')
    expect(roundForUncertainty(1433, 'none')).toBe('1,433')
    expect(roundForUncertainty(2640, 'tight')).toBe('2,640')
  })

  it('classifies only wide tiers as wide', () => {
    expect(isWideTier('wide')).toBe(true)
    expect(isWideTier('very_wide')).toBe(true)
    expect(isWideTier('none')).toBe(false)
    expect(isWideTier('tight')).toBe(false)
    expect(isWideTier('moderate')).toBe(false)
  })
})

describe('likelyRangeLabel', () => {
  it('renders the measured band as a plain-language range', () => {
    expect(likelyRangeLabel(1000, band(0.4, 'very_wide'))).toBe('Likely range 600–1,400')
    expect(likelyRangeLabel(1425, band(0.35, 'wide'))).toBe('Likely range 926–1,924')
  })
})

// ---------------------------------------------------------------------------
// Per-row gram range + quick-set math
// ---------------------------------------------------------------------------

describe('portionRangeFor', () => {
  it('prefers the model\'s own bounded range', () => {
    const r = row({ grams: 250, portionRange: { minG: 100, maxG: 400 } })
    expect(portionRangeFor(r, band(0.2, 'moderate'))).toEqual({ minG: 100, maxG: 400 })
  })

  it('derives from the band around the anchored grams when the model gave no range', () => {
    const r = row({ grams: 250 })
    expect(portionRangeFor(r, band(0.2, 'moderate'))).toEqual({ minG: 200, maxG: 300 })
  })

  it('does NOT re-center on live grams after a quick-set — the anchor holds', () => {
    // The user already tapped [min] (grams now 200); the range must stay
    // anchored at the original 250, or every tap ratchets the estimate down.
    const r = row({ grams: 200 })
    expect(portionRangeFor(r, band(0.2, 'moderate'), 250)).toEqual({ minG: 200, maxG: 300 })
  })

  it('ignores a crossing (nonsense) portionRange', () => {
    const r = row({ grams: 250, portionRange: { minG: 400, maxG: 100 } })
    expect(portionRangeFor(r, band(0.2, 'moderate'))).toEqual({ minG: 200, maxG: 300 })
  })
})

describe('quickSetGramsFor', () => {
  it('maps min/typical/max around the anchor', () => {
    const r = row({ grams: 250 })
    expect(quickSetGramsFor(r, band(0.2, 'moderate'), 250)).toEqual({ min: 200, typical: 250, max: 300 })
  })

  it('uses the model range for the ends and the anchor for typical', () => {
    const r = row({ grams: 250, portionRange: { minG: 100, maxG: 400 } })
    expect(quickSetGramsFor(r, band(0.2, 'moderate'), 250)).toEqual({ min: 100, typical: 250, max: 400 })
  })
})

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

describe('estimateProvenanceLabel', () => {
  it('reads Confirmed once the user edited the grams', () => {
    expect(estimateProvenanceLabel(row({ userEditedAt: 123 }))).toEqual({ label: 'Confirmed', tone: 'positive' })
  })

  it('reads Confirmed when a stated assumption was user-confirmed', () => {
    expect(estimateProvenanceLabel(row({ assumptions: [{ type: 'oil_added', userConfirmed: true }] }))).toEqual({
      label: 'Confirmed',
      tone: 'positive',
    })
  })

  it('keeps AI ESTIMATE for untouched estimates and stays silent on clean rows', () => {
    expect(estimateProvenanceLabel(row({ isEstimate: true }))).toEqual({ label: 'AI ESTIMATE', tone: 'uncertain' })
    expect(estimateProvenanceLabel(row())).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Question → row matching and count math
// ---------------------------------------------------------------------------

describe('rowIdForNamedQuestion', () => {
  const rows = (names: string[]) => names.map((n, i) => ({ id: `r${i}`, displayName: n }))

  it('finds the row a whole_dish_size question is about', () => {
    expect(rowIdForNamedQuestion('How large was the margherita pizza?', rows(['Chapati', 'Margherita Pizza']))).toBe('r1')
  })

  it('matches plural question text against a singular row name', () => {
    expect(rowIdForNamedQuestion('How many samosas did you eat?', rows(['Green Chutney', 'Samosa']))).toBe('r1')
  })

  it('prefers the longest (most specific) name contained in the text', () => {
    expect(rowIdForNamedQuestion('How large was the margherita pizza?', rows(['Pizza', 'Margherita pizza']))).toBe('r1')
  })

  it('returns null when no row is named in the question', () => {
    expect(rowIdForNamedQuestion('How large was the pizza?', rows(['Chapati', 'Dal']))).toBeNull()
  })

  it('ignores degenerately short names', () => {
    expect(rowIdForNamedQuestion('How large was the ox?', rows(['Ox']))).toBeNull()
  })
})

describe('count question math', () => {
  it('recovers the model count from a count assumption on the row', () => {
    const r = row({ assumptions: [{ type: 'count:3', userConfirmed: false }] })
    expect(modelCountFor(r)).toBe(3)
    expect(countMultiplierFor(r, 2)).toBeCloseTo(2 / 3, 6)
  })

  it('falls back to a one-unit baseline when the scan carried no count', () => {
    expect(modelCountFor(row())).toBeNull()
    expect(countMultiplierFor(row(), 2)).toBe(2)
  })

  it('maps the count options, including the 4+ floor and the silent default', () => {
    expect(countAnswerValue('1')).toBe(1)
    expect(countAnswerValue('3')).toBe(3)
    expect(countAnswerValue('4plus')).toBe(4)
    expect(countAnswerValue('as_counted')).toBeNull()
    expect(countAnswerValue('garbage')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Contract v1.3.0 honesty surfaces (task 3-c) — what the model itself flagged
// ---------------------------------------------------------------------------

describe('summaryLinesFor', () => {
  it('renders both lines display-ready with their prefixes', () => {
    expect(
      summaryLinesFor({
        knownSummary: 'Rice, dal, and chapati are clearly visible',
        unknownSummary: 'The amount of ghee in the tadka',
      }),
    ).toEqual({
      known: '✓ Rice, dal, and chapati are clearly visible',
      unknown: '? The amount of ghee in the tadka',
    })
  })

  it('renders each line independently', () => {
    expect(summaryLinesFor({ knownSummary: 'Whole meal is visible', unknownSummary: null })).toEqual({
      known: '✓ Whole meal is visible',
      unknown: null,
    })
    expect(summaryLinesFor({ knownSummary: null, unknownSummary: 'Cooking fat is not visible' })).toEqual({
      known: null,
      unknown: '? Cooking fat is not visible',
    })
  })

  it('treats whitespace-only, empty, and absent summaries as nothing to say', () => {
    expect(summaryLinesFor({ knownSummary: '   ', unknownSummary: '' })).toEqual({ known: null, unknown: null })
    expect(summaryLinesFor({})).toEqual({ known: null, unknown: null })
  })

  it('trims the model\'s text', () => {
    expect(summaryLinesFor({ knownSummary: '  Two chapatis visible  ', unknownSummary: ' \t ' }).known).toBe(
      '✓ Two chapatis visible',
    )
  })
})

describe('topUncertaintyFor', () => {
  it('picks the first high-impact factor', () => {
    expect(
      topUncertaintyFor([
        { factor: 'cooking oil not visible', impactOnTotalCalories: 'medium' },
        { factor: 'curry composition estimated', impactOnTotalCalories: 'high' },
        { factor: 'rice quantity uncertain', impactOnTotalCalories: 'high' },
      ]),
    ).toBe('Biggest calorie uncertainty: curry composition estimated')
  })

  it('falls back to the first factor of any impact when the model marked none high', () => {
    expect(topUncertaintyFor([{ factor: 'rice quantity uncertain', impactOnTotalCalories: 'low' }])).toBe(
      'Biggest calorie uncertainty: rice quantity uncertain',
    )
  })

  it('returns null with no factors, and skips blank factor text', () => {
    expect(topUncertaintyFor([])).toBeNull()
    expect(topUncertaintyFor(null)).toBeNull()
    expect(topUncertaintyFor(undefined)).toBeNull()
    expect(topUncertaintyFor([{ factor: '   ', impactOnTotalCalories: 'high' }])).toBeNull()
  })

  it('skips a factor that duplicates the shown likely-range line and falls through', () => {
    const factors = [
      { factor: 'Portion size unknown.', impactOnTotalCalories: 'high' as const },
      { factor: 'cooking oil not visible', impactOnTotalCalories: 'medium' as const },
    ]
    // The range line already IS the size statement, in numbers — say the next
    // thing instead.
    expect(topUncertaintyFor(factors, { rangeShown: true })).toBe(
      'Biggest calorie uncertainty: cooking oil not visible',
    )
    // No range line shown (tight band): the factor is then the only size
    // honesty on the screen — keep it.
    expect(topUncertaintyFor(factors)).toBe('Biggest calorie uncertainty: Portion size unknown.')
  })

  it('never suppresses factors that are not about overall amount, even with the range showing', () => {
    expect(
      topUncertaintyFor([{ factor: 'cooking oil not visible', impactOnTotalCalories: 'high' }], { rangeShown: true }),
    ).toBe('Biggest calorie uncertainty: cooking oil not visible')
  })

  it('returns null when every factor is guarded', () => {
    expect(
      topUncertaintyFor([{ factor: 'total amount unclear', impactOnTotalCalories: 'high' }], { rangeShown: true }),
    ).toBeNull()
  })
})

describe('portionConfidenceNoteFor', () => {
  const context = (confidence: PortionContext['absolutePortionConfidence'], scaleReferenceAvailable = false): PortionContext => ({
    wholeMealVisible: true,
    scaleReferenceAvailable,
    scaleReferenceDescription: scaleReferenceAvailable ? 'a credit card beside the plate' : null,
    absolutePortionConfidence: confidence,
  })

  it('flags a low-confidence portion when no scale reference was found', () => {
    expect(portionConfidenceNoteFor(context('low'))).toBe('Portion size is a guess — no scale in photo')
  })

  it('keeps the copy honest when a reference WAS found but confidence stayed low', () => {
    expect(portionConfidenceNoteFor(context('low', true))).toBe('Portion size is a rough guess')
  })

  it('treats unknown confidence as a guess too', () => {
    expect(portionConfidenceNoteFor(context('unknown'))).toBe('Portion size is a guess — no scale in photo')
  })

  it('stays silent on medium and high confidence and on a missing context', () => {
    expect(portionConfidenceNoteFor(context('medium'))).toBeNull()
    expect(portionConfidenceNoteFor(context('high'))).toBeNull()
    expect(portionConfidenceNoteFor(null)).toBeNull()
    expect(portionConfidenceNoteFor(undefined)).toBeNull()
  })
})

describe('shouldShowModelQuestionCard', () => {
  const q = (question: string, options: string[] = ['Yes', 'No']): ModelHighImpactQuestion => ({ question, options })
  const input = (question: ModelHighImpactQuestion | null) => ({ highImpactQuestion: question })

  it('shows the card when there are no chips', () => {
    expect(shouldShowModelQuestionCard(input(q('How much oil was used in the curry?')), [])).toBe(true)
  })

  it('shows no card without a model question, or with a question that normalizes to nothing', () => {
    expect(shouldShowModelQuestionCard(input(null), ['How much oil was used in the curry?'])).toBe(false)
    expect(shouldShowModelQuestionCard(input(q('???')), [])).toBe(false)
  })

  it('suppresses when a chip carries the same question', () => {
    expect(
      shouldShowModelQuestionCard(input(q('How much oil was used in the curry?')), [
        'How much oil was used in the curry?',
      ]),
    ).toBe(false)
  })

  it('suppresses at or above the 60% token-coverage threshold with different phrasing', () => {
    // Model tokens: how, much, oil, was, used, in, the, curry (8). Chip covers
    // how, much, oil, the, curry → 5/8 = 62.5% ≥ 60% → same question twice.
    expect(
      shouldShowModelQuestionCard(input(q('How much oil was used in the curry?')), [
        'How much oil went into the curry?',
      ]),
    ).toBe(false)
  })

  it('keeps the card below the threshold', () => {
    // Covered: was, in, the → 3/8 = 37.5% — a different question.
    expect(
      shouldShowModelQuestionCard(input(q('How much oil was used in the curry?')), [
        'Was the rice cooked in broth?',
      ]),
    ).toBe(true)
  })

  it('normalizes case, punctuation, and whitespace on both sides', () => {
    expect(
      shouldShowModelQuestionCard(input(q('  How   LARGE was the pizza? ')), ['HOW LARGE WAS THE PIZZA']),
    ).toBe(false)
  })

  it('ignores chips that normalize to nothing, and ignores the option list entirely', () => {
    expect(shouldShowModelQuestionCard(input(q('How much oil was used?', [])), ['???'])).toBe(true)
    expect(shouldShowModelQuestionCard(input(q('How much oil was used in the curry?', [])), [])).toBe(true)
  })
})

describe('preparationNoteFor', () => {
  const prep = (addedCookingFat: PreparationInfo['addedCookingFat']): PreparationInfo => ({
    method: 'pan fried',
    intrinsicFat: 'low',
    addedCookingFat,
    confidence: 0.8,
  })

  it('flags moderate and heavy added cooking fat', () => {
    expect(preparationNoteFor({ ...row(), preparation: prep('moderate') })).toBe('· likely cooked in oil/ghee')
    expect(preparationNoteFor({ ...row(), preparation: prep('heavy') })).toBe('· likely cooked in oil/ghee')
  })

  it('stays silent for none, light, unknown, a null block, and a row without preparation', () => {
    expect(preparationNoteFor({ ...row(), preparation: prep('none') })).toBeNull()
    expect(preparationNoteFor({ ...row(), preparation: prep('light') })).toBeNull()
    expect(preparationNoteFor({ ...row(), preparation: prep('unknown') })).toBeNull()
    expect(preparationNoteFor({ ...row(), preparation: null })).toBeNull()
    expect(preparationNoteFor(row())).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Store: the screen's mutations, driven exactly as the UI drives them
// ---------------------------------------------------------------------------

describe('store — whole_dish_size answers rescale only the named row', () => {
  beforeEach(() =>
    readyWith([
      row({ id: 'pizza', displayName: 'Margherita Pizza', grams: 250 }),
      row({ id: 'dal', displayName: 'Dal', grams: 150, bandHalfPct: 0.25 }),
    ]),
  )

  it('14" scales the pizza by the area multiplier (1.96×) and nothing else', () => {
    answerQuestion(chipFor('whole_dish_size', 'How large was the margherita pizza?'), '14in')
    const [pizza, dal] = readyPhase().result.meal.ingredients
    expect(pizza!.grams).toBeCloseTo(490, 6)
    expect(dal!.grams).toBe(150)
    // The answer IS the user speaking — the row becomes user-confirmed.
    expect(pizza!.userEditedAt).toBeDefined()
    expect(dal!.userEditedAt).toBeUndefined()
  })

  it('repeated answers REPLACE, not compound: 12" then 14" lands at 1.96×', () => {
    answerQuestion(chipFor('whole_dish_size', 'How large was the margherita pizza?'), '12in')
    expect(readyPhase().result.meal.ingredients[0]!.grams).toBeCloseTo(250 * 1.44, 6)
    answerQuestion(chipFor('whole_dish_size', 'How large was the margherita pizza?'), '14in')
    // Multipliers are defined on the item's ESTIMATED grams (question-bank),
    // so the second answer rescales the scan baseline of 250 g, not the
    // already-rescaled 360 g.
    expect(readyPhase().result.meal.ingredients[0]!.grams).toBeCloseTo(250 * 1.96, 6)
  })

  it('"I know the weight" and the 10" baseline change nothing and claim nothing', () => {
    answerQuestion(chipFor('whole_dish_size', 'How large was the margherita pizza?'), 'know_weight')
    expect(readyPhase().result.meal.ingredients[0]!.grams).toBe(250)
    expect(readyPhase().result.meal.ingredients[0]!.userEditedAt).toBeUndefined()
    answerQuestion(chipFor('whole_dish_size', 'How large was the margherita pizza?'), '10in')
    expect(readyPhase().result.meal.ingredients[0]!.grams).toBe(250)
    expect(readyPhase().result.meal.ingredients[0]!.userEditedAt).toBeUndefined()
  })
})

describe('store — count_question answers rescale the named row', () => {
  it('uses the model count when the row carries one (N=3, ate 2 → ×2/3)', () => {
    readyWith([row({ id: 'sam', displayName: 'Samosa', grams: 300, assumptions: [{ type: 'count:3', userConfirmed: false }] })])
    answerQuestion(chipFor('count_question', 'How many samosas did you eat?'), '2')
    expect(readyPhase().result.meal.ingredients[0]!.grams).toBeCloseTo(200, 6)
    expect(readyPhase().result.meal.ingredients[0]!.userEditedAt).toBeDefined()
  })

  it('falls back to a one-unit baseline without a count, and floors 4+', () => {
    readyWith([row({ id: 'sam', displayName: 'Samosa', grams: 300 })])
    answerQuestion(chipFor('count_question', 'How many samosas did you eat?'), '2')
    expect(readyPhase().result.meal.ingredients[0]!.grams).toBe(600)
    answerQuestion(chipFor('count_question', 'How many samosas did you eat?'), '4plus')
    expect(readyPhase().result.meal.ingredients[0]!.grams).toBe(1200)
  })

  it('the silent default "as_counted" changes nothing', () => {
    readyWith([row({ id: 'sam', displayName: 'Samosa', grams: 300 })])
    answerQuestion(chipFor('count_question', 'How many samosas did you eat?'), 'as_counted')
    expect(readyPhase().result.meal.ingredients[0]!.grams).toBe(300)
    expect(readyPhase().result.meal.ingredients[0]!.userEditedAt).toBeUndefined()
  })
})

describe('store — per-row quick-set isolation (the [min][typical][max] path)', () => {
  it('editing one row moves only that row and recomputes the totals', () => {
    readyWith([
      row({ id: 'a', grams: 250, nutrientSnapshot: { kcal: 200, protein_g: 5, fat_g: 8, carbs_g: 26, fiber_g: 1, sugar_g: 0, sodium_mg: 10 } }),
      row({ id: 'b', grams: 150, nutrientSnapshot: { kcal: 100, protein_g: 4, fat_g: 2, carbs_g: 15, fiber_g: 2, sugar_g: 0, sodium_mg: 5 } }),
    ])
    const before = readyPhase().result.totals
    // [min] on row a, derived from a ±20% band anchored at 250 → 200 g.
    const quick = quickSetGramsFor(readyPhase().result.meal.ingredients[0]!, band(0.2, 'moderate'), 250)
    editGrams('a', quick.min)
    const after = readyPhase().result
    const [a, b] = after.meal.ingredients
    expect(a!.grams).toBe(200)
    expect(b!.grams).toBe(150)
    expect(a!.userEditedAt).toBeDefined()
    expect(b!.userEditedAt).toBeUndefined()
    // Totals: the DISPLAYED kcal is Atwater over the already-rounded macro
    // grams (totals §6.3 — the one number a user can hand-check), so for
    // a=200 g / b=150 g: P16, F19, C75 → 4·16 + 4·75 + 9·19 = 535.
    expect(after.totals.kcal).toBe(535)
    expect(after.totals.kcal).toBeLessThan(before.kcal)
  })
})
