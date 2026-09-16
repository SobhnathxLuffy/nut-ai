import { describe, expect, it } from 'vitest'
import { decodeFoodReview, encodeFoodReview } from './food-review'

describe('food review payload',()=>{
  it('round-trips the selected date and immutable nutrient snapshot',()=>{
    const value={selection:{foodId:null,matchedFoodSource:'userfood',displayName:'Home food',grams:75,nutrientSnapshot:{kcal:200,protein_g:10,fat_g:5,carbs_g:20,fiber_g:null}},date:'2024-01-12'}
    expect(decodeFoodReview(encodeFoodReview(value))).toEqual(value)
  })
})
