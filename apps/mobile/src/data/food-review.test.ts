import { describe, expect, it } from 'vitest'
import { decodeFoodReview, encodeFoodReview } from './food-review'

const SELECTION = { foodId: null, matchedFoodSource: 'userfood', displayName: 'Home food', grams: 75, nutrientSnapshot: { kcal: 200, protein_g: 10, fat_g: 5, carbs_g: 20, fiber_g: null } }

describe('food review payload',()=>{
  it('round-trips the selected date and immutable nutrient snapshot',()=>{
    const value={selection:SELECTION,date:'2024-01-12'}
    expect(decodeFoodReview(encodeFoodReview(value))).toEqual(value)
  })

  it('P1-6: a missing date no longer fails the whole decode',()=>{
    const value={selection:SELECTION,date:''}
    expect(()=>decodeFoodReview(encodeFoodReview(value))).not.toThrow()
    expect(decodeFoodReview(encodeFoodReview(value)).date).toBe('')
  })

  it('P1-6: impossible dates degrade to an empty (recoverable) date',()=>{
    const value={selection:SELECTION,date:'2026-02-30'}
    expect(decodeFoodReview(encodeFoodReview(value)).date).toBe('')
  })

  it('P1-6: an invalid date does not render the Data corrupted card path',()=>{
    // The screen branches on decode failure; a bad date must decode so the
    // review UI can default to today instead of showing the hostile card.
    const decoded = decodeFoodReview(encodeFoodReview({ selection: SELECTION, date: 'soon' }))
    expect(decoded.selection.displayName).toBe('Home food')
  })

  it('still rejects a selection without serving information',()=>{
    const bad = JSON.stringify({ selection: { displayName: '', grams: 100 }, date: '2024-01-12' })
    expect(()=>decodeFoodReview(bad)).toThrow(/invalid serving information/)
    const badGrams = JSON.stringify({ selection: { displayName: 'X', grams: 0 }, date: '2024-01-12' })
    expect(()=>decodeFoodReview(badGrams)).toThrow(/invalid serving information/)
  })
})
