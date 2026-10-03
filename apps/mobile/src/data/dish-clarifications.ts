/**
 * Dish clarification wiring — the app-side adapter between the dish composer
 * and the engine's clarification questions
 * (packages/indian-dishes/src/clarification.ts — generateClarifications /
 * applyClarifications), which had ZERO references in the app (AGENTS.md §0.2).
 *
 * WHAT THIS ADAPTER OWNS (the engine stays untouched):
 *
 *   1. THE GATE. Only dishes that carry an uncertainty model are asked
 *      questions. The corpus `dish_definitions` table ships an
 *      `uncertainty_model_json` column (highImpactUnknowns, …); household
 *      variants in the writable user DB do not — they open with no questions,
 *      exactly as before.
 *
 *   2. THE ANSWERABLE FILTER. `generateClarifications` also emits a question
 *      for every `unresolved` slot, but with an EMPTY option list ("To be
 *      populated by dynamic search"). The composer already serves those slots
 *      through the per-component IngredientResolver (searchable picker), so a
 *      zero-option card would be dead weight. The adapter keeps only questions
 *      with at least one option. Every shipped corpus row is fully mapped
 *      (1,451/1,451 slots resolve), so today this filters nothing — it exists
 *      so a future unresolved slot degrades to the resolver, not to a blank
 *      card.
 *
 *   3. THE MULTIPLIER GENERALIZATION. `applyClarifications` scales a slot's
 *      amount-prior range by an answer's `amountMultiplier` ONLY when the
 *      prior kind is `broad_mass_fraction_engineering_prior`. The shipped
 *      corpus is 100% `CURATED_PRIOR` (verified by survey: 1,451/1,451 slots),
 *      so the engine branch never fires and "None / Dry Roasted" (multiplier
 *      0) would leave the fat grams untouched. The adapter therefore scales
 *      the range for EVERY prior kind BEFORE delegating, and strips the
 *      multiplier from the answers it hands the engine — one application
 *      site, no double-scaling, identical arithmetic for engineering priors.
 *
 *   4. THE ESTIMATE RANGE. The dish uncertainty model exposes a LIST of
 *      high-impact unknowns, not a calibrated numeric band — so the honest
 *      "range" next to the composer's estimate propagates the model's OWN
 *      numbers: the reviewed fraction ranges on each slot's amount prior,
 *      clamped to their low and high bounds and re-run through the SAME
 *      derivation (dishIngredientBreakdown) the composer uses. No invented
 *      ±% calibration (AGENTS.md principle 6: a prior is not a measurement).
 *
 * Immutability: `applyClarifications` returns a NEW dish record; this adapter
 * likewise returns a NEW row. The raw DB row is never mutated, and answers
 * live in composer state only — they are never persisted to the dish record
 * (the household save path stores the user's confirmed grams instead).
 *
 * ZERO React Native imports — unit-testable under bare Node.
 */

import { applyClarifications, generateClarifications, isFatSlot, type ClarificationQuestion } from '@nutai/indian-dishes'
import { dishIsFried } from '@nutai/recipe-engine'
import type { DishDefinition } from '@nutai/core-schema'
import { dishIngredientBreakdown, type DishRowLike } from './dish-ingredients'

export type { ClarificationQuestion } from '@nutai/indian-dishes'

/**
 * A dish row as the composer loads it (`SELECT * FROM dish_definitions`):
 * the corpus carries the uncertainty model column, household rows do not.
 */
export interface DishClarificationRow extends DishRowLike {
  uncertainty_model_json?: string | null
}

export interface DishClarificationAnswer {
  canonicalFoodId: string | null
  /** 0 = "none" — the adapter scales the slot's prior range by this for every prior kind. */
  amountMultiplier?: number
}

/** Keyed by question id (`clarify_<slotLabel>`), mirroring the engine's answer shape. */
export type DishClarificationAnswers = Record<string, DishClarificationAnswer>

/** The uncertainty model as shipped in `uncertainty_model_json`. */
export interface DishUncertaintyModel {
  highImpactUnknowns?: string[]
  allowIDontKnow?: boolean
  questionPolicy?: string
}

export interface ClarifiedSlot {
  /** Raw slot label (snake_case, matches breakdown lines). */
  label: string
  /** Human-readable slot name ("Cooking fat (optional)"). */
  display: string
  /** Per-serving grams after the answers — the fold value for selector-folded fat slots. */
  grams: number
  /** True when the slot is represented by the composer's fat selector. */
  foldedIntoFat: boolean
}

/**
 * The uncertainty model of a dish row, or null. Household variants and rows
 * without the column open with no clarifications (current behavior).
 *
 * Takes a structural MINIMUM (only the column it reads) so surfaces like the
 * dish browser — which fetches name/status/aliases/uncertainty but no recipe
 * template — can reuse the same parser without a cast.
 */
export function dishUncertaintyModel(row: { uncertainty_model_json?: string | null }): DishUncertaintyModel | null {
  const raw = row.uncertainty_model_json
  if (typeof raw !== 'string' || raw.trim() === '') return null
  try {
    const parsed = JSON.parse(raw) as DishUncertaintyModel
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

type SlotRecord = Record<string, unknown>

/** The slot's prior range, or null when it is not a finite [low, high] pair. */
function slotPriorRange(slot: SlotRecord): [number, number] | null {
  const prior = slot.amountPrior
  if (prior == null || typeof prior !== 'object') return null
  const range = (prior as { range?: unknown }).range
  if (!Array.isArray(range) || range.length !== 2) return null
  const low = range[0] as number
  const high = range[1] as number
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null
  return [low, high]
}

/** A slot's label, or '' when the slot is malformed. */
function slotLabelOf(slot: SlotRecord): string {
  return typeof slot.label === 'string' ? slot.label : ''
}

function parseTemplate(row: DishRowLike): { template: { ingredientSlots?: SlotRecord[] }; ok: boolean } {
  try {
    return { template: JSON.parse(row.recipe_template_json || '{}') as { ingredientSlots?: SlotRecord[] }, ok: true }
  } catch {
    return { template: {}, ok: false }
  }
}

/**
 * The engine's clarification questions for a dish row, gated on the
 * uncertainty model and filtered to answerable (option-bearing) questions.
 */
export function dishClarificationQuestions(row: DishClarificationRow): ClarificationQuestion[] {
  const model = dishUncertaintyModel(row)
  if (!model || !Array.isArray(model.highImpactUnknowns) || model.highImpactUnknowns.length === 0) return []
  const { template, ok } = parseTemplate(row)
  if (!ok) return []
  // Both engine functions only read `recipeTemplate`; the row carries exactly
  // that template. A single documented structural cast at this boundary (the
  // DB row does not carry the full DishDefinition field set).
  const dish = { recipeTemplate: template } as DishDefinition
  return generateClarifications(dish).filter((question) => question.options.length > 0)
}

/**
 * Slot labels whose answer carries amountMultiplier 0 — the ingredient is
 * absent ("None / Dry Roasted") and the composer drops its row entirely.
 */
export function zeroedClarificationSlots(answers: DishClarificationAnswers): string[] {
  const labels: string[] = []
  for (const [id, answer] of Object.entries(answers)) {
    if (answer.amountMultiplier === 0) labels.push(id.replace(/^clarify_/, ''))
  }
  return labels
}

/**
 * Applies the user's answers to a dish ROW, returning a NEW row whose
 * `recipe_template_json` carries the clarified slots. No answers (or an
 * unparseable template) → the SAME row object back: skipping is exactly the
 * current behavior.
 */
export function applyDishClarifications(row: DishClarificationRow, answers: DishClarificationAnswers): DishClarificationRow {
  const answered = Object.keys(answers).length > 0
  if (!answered || typeof row.recipe_template_json !== 'string' || row.recipe_template_json === '') return row
  const { template, ok } = parseTemplate(row)
  if (!ok) return row

  // 3. Pre-scale the prior ranges for multiplier answers (every prior kind —
  //    see the header). The multipliers are stripped from the answers handed
  //    to the engine so the range is scaled exactly once.
  const scaledSlots = (template.ingredientSlots ?? []).map((slot) => {
    const answer = answers[`clarify_${slotLabelOf(slot)}`]
    const factor = answer?.amountMultiplier
    const range = factor !== undefined ? slotPriorRange(slot) : null
    if (answer == null || factor === undefined || range == null) return slot
    const prior: Record<string, unknown> =
      slot.amountPrior != null && typeof slot.amountPrior === 'object'
        ? (slot.amountPrior as Record<string, unknown>)
        : {}
    return {
      ...slot,
      amountPrior: {
        ...prior,
        range: [range[0] * factor, range[1] * factor] as [number, number],
      },
    }
  })
  const engineAnswers: Record<string, { canonicalFoodId: string | null }> = {}
  for (const [id, answer] of Object.entries(answers)) {
    engineAnswers[id] = { canonicalFoodId: answer.canonicalFoodId }
  }

  const clarified = applyClarifications(
    { recipeTemplate: { ...template, ingredientSlots: scaledSlots } } as DishDefinition,
    engineAnswers,
  )
  return { ...row, recipe_template_json: JSON.stringify(clarified.recipeTemplate) }
}

/** Human-readable unknown key — "piece_weight" → "Piece weight". */
export function humanizeUnknownKey(key: string): string {
  const pretty = key.replace(/_/g, ' ').trim()
  return pretty.charAt(0).toUpperCase() + pretty.slice(1)
}

/**
 * Does this dish row FRY? Adapter over the engine's dishIsFried: corpus rows
 * carry `cooking_methods_json` (e.g. ["assemble_or_shape","cook_or_fry"])
 * and the uncertainty model's own frying_oil_absorption unknown is the
 * fallback. Drives the used-vs-absorbed oil semantics in the composer.
 */
export function rowIsFried(row: DishRowLike): boolean {
  let methods: string[] | null = null
  const raw = (row as { cooking_methods_json?: string | null }).cooking_methods_json
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) methods = parsed.filter((m): m is string => typeof m === 'string')
    } catch {
      methods = null
    }
  }
  const model = dishUncertaintyModel(row)
  return dishIsFried({
    cooking: methods ? { methods } : null,
    uncertaintyModel: model ?? undefined,
  })
}

// Unknown keys that NAME the fat itself (type/identity), not its amount:
// answering "which fat" resolves these. Keys about absorbed or measured
// quantities stay open — the question does not answer them.
const FAT_IDENTITY_UNKNOWN = /(^|_)(fat|oil|ghee)(_|$)/
const AMOUNT_UNKNOWN = /(amount|weight|absorption|ratio|concentration|fraction|count|volume|size|serving|portion)/

/**
 * The uncertainty model's high-impact unknowns that remain open after the
 * user's answers. An answered fat question (any fat-family slot — the engine
 * now asks about every one of them, not just added_fat_optional/cooking_oil)
 * resolves the fat-identity unknowns only — amount unknowns
 * (frying_oil_absorption, oil_ghee_amount, …) stay honestly open.
 */
export function dishOpenUnknowns(row: DishClarificationRow, answers: DishClarificationAnswers): string[] {
  const model = dishUncertaintyModel(row)
  if (!model?.highImpactUnknowns?.length) return []
  const fatAnswered = Object.entries(answers).some(([id, answer]) => {
    const label = id.replace(/^clarify_/, '')
    return isFatSlot({ label }) && answer.canonicalFoodId != null
  })
  return model.highImpactUnknowns.filter((key) => {
    if (!fatAnswered) return true
    return !(FAT_IDENTITY_UNKNOWN.test(key) && !AMOUNT_UNKNOWN.test(key))
  })
}

/**
 * The slot lines the composer should show after clarifications — per-serving
 * grams and fold state straight from the shared derivation path
 * (dishIngredientBreakdown). Zeroed slots (multiplier 0) contribute 0 grams.
 */
export function clarifiedSlotLines(row: DishRowLike): ClarifiedSlot[] {
  const { lines, fatFold } = dishIngredientBreakdown(row, true)
  return lines.map((line) => ({
    label: line.label,
    display: line.display,
    // The fold's grams rounded the same way the composer's fat selector
    // state rounds it (Math.round(x*10)/10) — one truth on screen.
    grams: line.foldedIntoFat && fatFold ? Math.round(fatFold.grams * 10) / 10 : line.grams,
    foldedIntoFat: line.foldedIntoFat,
  }))
}

function clampedRangeRow(row: DishRowLike, mode: 'low' | 'high'): DishRowLike {
  const { template, ok } = parseTemplate(row)
  if (!ok) return row
  const slots = (template.ingredientSlots ?? []).map((slot) => {
    const range = slotPriorRange(slot)
    if (!range) return slot
    const prior: Record<string, unknown> =
      slot.amountPrior != null && typeof slot.amountPrior === 'object'
        ? (slot.amountPrior as Record<string, unknown>)
        : {}
    const bound = mode === 'low' ? range[0] : range[1]
    return {
      ...slot,
      amountPrior: { ...prior, range: [bound, bound] as [number, number] },
    }
  })
  return { ...row, recipe_template_json: JSON.stringify({ ...template, ingredientSlots: slots }) }
}

export interface DishPriorKcalRangeInput {
  row: DishRowLike
  /**
   * kcal per 100 g for each slot LABEL — the values the composer already
   * fetched for its component rows. A selector-folded fat slot carries the
   * fat option's per-100 g value under its own label.
   */
  kcalPer100gBySlot: Record<string, number | null | undefined>
  /** The portion the estimate is for (the composer's current portion input). */
  portionGrams: number
  /**
   * Owner QA 2026-10: on fried dishes the folded fat slot contributes its
   * ABSORBED share (absorbedMid / used) — the same factor the composer's
   * totals use — so the band is stated in eaten-kcal, not pan-kcal. The
   * batch mass (and the yield denominator) stays on the used grams.
   */
  fatAbsorptionFactor?: number
}

/**
 * The estimate's range from the model's OWN numbers: every fraction prior
 * clamped to its low (then high) bound, re-derived through the SAME
 * dishIngredientBreakdown path, scaled by the same portion/yield arithmetic
 * the composer performs. The portion is fixed by the record; the band comes
 * from redistributing the raw batch between slots — which is exactly what the
 * reviewed ranges are uncertain about.
 *
 * Null when no honest range exists: no verified yield/portion, a missing
 * portion, any slot's kcal unknown, or a collapsed band (point priors — a
 * fake ±0 range is false precision, not honesty).
 */
export function dishPriorKcalRange({ row, kcalPer100gBySlot, portionGrams, fatAbsorptionFactor }: DishPriorKcalRangeInput): { low: number; high: number } | null {
  const base = dishIngredientBreakdown(row, true)
  if (base.verifiedNumericYield == null || base.standardPortionGrams == null) return null
  if (!(portionGrams > 0)) return null

  const side = (mode: 'low' | 'high'): number | null => {
    const bd = dishIngredientBreakdown(clampedRangeRow(row, mode), true)
    let kcal = 0
    let rawMass = 0
    for (const line of bd.lines) {
      // The batch mass keeps the used fat (the yield denominator is the pan
      // batch); the fat slot's ENERGY uses its absorbed share on fried dishes.
      rawMass += line.grams
      if (line.grams <= 0) continue
      const kcal100 = kcalPer100gBySlot[line.label]
      if (kcal100 == null || !Number.isFinite(kcal100)) return null
      const effective = line.foldedIntoFat && fatAbsorptionFactor != null
        ? line.grams * fatAbsorptionFactor
        : line.grams
      kcal += (kcal100 * effective) / 100
    }
    const cookedYield = rawMass * base.verifiedNumericYield!
    if (!(cookedYield > 0)) return null
    return kcal * (portionGrams / cookedYield)
  }

  const lowSide = side('low')
  const highSide = side('high')
  if (lowSide == null || highSide == null) return null
  const low = Math.min(lowSide, highSide)
  const high = Math.max(lowSide, highSide)
  // A band under 1 kcal is a point estimate — say nothing rather than ±0.4.
  if (!(high - low >= 1)) return null
  return { low, high }
}
