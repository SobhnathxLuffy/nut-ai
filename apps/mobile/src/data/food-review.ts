import type { ManualFoodSelection } from './manual-food'
import { isValidLocalDate } from './date-utils'

/** One curated-dish ingredient line, per standard serving (grams). */
export interface FoodReviewIngredient {
  label: string
  grams: number
}

export interface FoodReviewPayload {
  selection: ManualFoodSelection
  selections?: ManualFoodSelection[]
  date: string
  /** Dish-KB id when the reviewed item resolves from the dish library — enables "Edit ingredients". */
  dishId?: string
  /** Ingredient breakdown for dish-KB items, per standard serving. */
  ingredients?: FoodReviewIngredient[]
}

export function encodeFoodReview(payload: FoodReviewPayload): string {
  return JSON.stringify(payload)
}

function validIngredients(value: unknown): FoodReviewIngredient[] | undefined {
  if (!Array.isArray(value)) return undefined
  const lines = value
    .filter((item): item is FoodReviewIngredient =>
      typeof item?.label === 'string' && item.label.trim().length > 0 &&
      typeof item?.grams === 'number' && Number.isFinite(item.grams) && item.grams >= 0)
    .map((item) => ({ label: item.label.trim(), grams: Math.round(item.grams * 10) / 10 }))
  return lines.length > 0 ? lines : undefined
}

export function decodeFoodReview(value: string | undefined): FoodReviewPayload {
  if (!value) throw new Error('This food is no longer available for review')
  const parsed = JSON.parse(value) as FoodReviewPayload
  const selection = parsed?.selection
  if (!selection || !selection.displayName?.trim() || !Number.isFinite(selection.grams) || selection.grams <= 0) {
    throw new Error('This food has invalid serving information')
  }
  // P1-6: a missing or malformed date is recoverable, not corruption — send an
  // empty date and let the review screen default to today with live validation.
  // Throwing here used to render the hostile "Data corrupted, go back" card for
  // a payload whose only sin was `date: ""`.
  const date = isValidLocalDate(parsed.date) ? parsed.date : ''
  if (parsed.selections?.some((item) => !item.displayName?.trim() || !Number.isFinite(item.grams) || item.grams <= 0)) {
    throw new Error('This meal has invalid serving information')
  }
  const dishId = typeof parsed.dishId === 'string' && parsed.dishId.trim().length > 0 ? parsed.dishId : undefined
  return { ...parsed, date, dishId, ingredients: validIngredients(parsed.ingredients) }
}
