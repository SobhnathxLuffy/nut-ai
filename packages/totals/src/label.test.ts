import { describe, expect, it } from 'vitest'
import { declaredCaloriesLabel, labelRounding } from './index.js'

/**
 * P3-D12 (QA): a real 1-4 kcal serving used to render as a fabricated "0".
 * The declared-label form now says "<5" for that band; arithmetic paths keep
 * using labelRounding directly.
 */
describe('declaredCaloriesLabel', () => {
  it('renders the 1-4 kcal band as <5 instead of a fabricated zero', () => {
    expect(declaredCaloriesLabel(0)).toBe('0')
    expect(declaredCaloriesLabel(1.2)).toBe('<5')
    expect(declaredCaloriesLabel(4.9)).toBe('<5')
  })

  it('matches labelRounding above the <5 band', () => {
    for (const kcal of [5, 7, 50, 51, 104.6, 412]) {
      expect(declaredCaloriesLabel(kcal)).toBe(String(labelRounding.calories(kcal)))
    }
  })

  it('labelRounding keeps its numeric contract for sums', () => {
    expect(labelRounding.calories(3)).toBe(0)
    expect(labelRounding.calories(42)).toBe(40)
    expect(labelRounding.calories(52)).toBe(50)
  })
})
