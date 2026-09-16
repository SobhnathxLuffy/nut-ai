import type { ManualFoodSelection } from './manual-food'

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) throw new Error('Choose a valid date')
  if (parsed.selections?.some((item) => !item.displayName?.trim() || !Number.isFinite(item.grams) || item.grams <= 0)) {
    throw new Error('This meal has invalid serving information')
  }
  return parsed
}
