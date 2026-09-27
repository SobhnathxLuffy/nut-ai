import type { ManualFoodSelection } from './manual-food'
import { isValidLocalDate } from './date-utils'

export interface FoodReviewPayload {
  selection: ManualFoodSelection
  selections?: ManualFoodSelection[]
  date: string
}

export function encodeFoodReview(payload: FoodReviewPayload): string {
  return JSON.stringify(payload)
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
  return { ...parsed, date }
}
