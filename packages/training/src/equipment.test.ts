import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { calculatePlates, toKg, type Plate } from './equipment.js'

describe('EQP-001: Equipment and plate calculator', () => {
  const standardBar = { weight_kg: 20, count: 1 }
  const standardPlates: Plate[] = [
    { weight_kg: 20, count: 4 },
    { weight_kg: 15, count: 2 },
    { weight_kg: 10, count: 4 },
    { weight_kg: 5, count: 4 },
    { weight_kg: 2.5, count: 4 },
    { weight_kg: 1.25, count: 4 },
  ]

  it('calculates exact load for 100 kg on standard bar', () => {
    // 100 kg - 20 kg bar = 80 kg needed => 40 kg per side (2x 20kg per side)
    const res = calculatePlates(100, standardBar, standardPlates)
    expect(res.exact).not.toBeNull()
    expect(res.exact?.load_kg).toBe(100)
    expect(res.exact?.delta_kg).toBe(0)
    expect(res.exact?.per_side).toEqual([{ weight_kg: 20, count: 2 }])
    expect(res.exact?.total_plates).toBe(4)
  })

  it('calculates exact load for 62.5 kg on standard bar', () => {
    // 62.5 kg - 20 kg bar = 42.5 kg needed => 21.25 kg per side (1x 20kg, 1x 1.25kg)
    const res = calculatePlates(62.5, standardBar, standardPlates)
    expect(res.exact).not.toBeNull()
    expect(res.exact?.load_kg).toBe(62.5)
    expect(res.exact?.per_side).toEqual([
      { weight_kg: 20, count: 1 },
      { weight_kg: 1.25, count: 1 },
    ])
  })

  it('suggests nearest lower and upper loads when exact match is impossible', () => {
    // With plates available in 2.5kg steps (1.25 per side), target 61kg cannot be reached exactly
    const res = calculatePlates(61, standardBar, standardPlates)
    expect(res.exact).toBeNull()
    expect(res.lower).not.toBeNull()
    expect(res.upper).not.toBeNull()
    expect(res.lower?.load_kg).toBe(60) // -1 kg delta
    expect(res.lower?.delta_kg).toBe(-1)
    expect(res.upper?.load_kg).toBe(62.5) // +1.5 kg delta
    expect(res.upper?.delta_kg).toBe(1.5)
  })

  it('handles pair of dumbbells (2 handles) with symmetric plate distribution', () => {
    const dumbbellHandle = { weight_kg: 2.5, count: 2 }
    const dbPlates: Plate[] = [
      { weight_kg: 5, count: 4 },
      { weight_kg: 2.5, count: 8 },
      { weight_kg: 1.25, count: 8 },
    ]
    // 2 handles: each handle gets bar (2.5kg) + 2 sides of plates
    // Total load for pair target 25 kg: each dumbbell is 12.5 kg (2.5 bar + 2x 5kg plates per db => 2x 2.5kg per side)
    const res = calculatePlates(25, dumbbellHandle, dbPlates, 2)
    expect(res.exact).not.toBeNull()
    expect(res.exact?.load_kg).toBe(25)
    // 2 handles * 2 sides = 4 ends. Each end gets 1x5kg, 2x2.5kg, 1x1.25kg = 4 plates => 16 total plates
    expect(res.exact?.total_plates).toBe(16)
  })

  it('respects reserved plates already in use', () => {
    // 170kg is normally achievable (2x 20kg + 1x 15kg + 2x 10kg per side = 75kg per side + 20kg bar = 170kg)
    // But with 2x 20kg reserved, only 1x 20kg per side is available, max achievable is 165kg
    const reserved: Plate[] = [{ weight_kg: 20, count: 2 }]
    const res = calculatePlates(170, standardBar, standardPlates, 1, reserved)
    expect(res.exact).toBeNull()
    expect(res.lower?.load_kg).toBe(165)
    expect(res.lower?.load_kg).toBeLessThan(170)
  })

  it('rejects invalid inputs', () => {
    expect(() => calculatePlates(-10, standardBar, standardPlates)).toThrow('Invalid load')
    expect(() => calculatePlates(100, { weight_kg: -5, count: 1 }, standardPlates)).toThrow('Invalid load')
    expect(() => calculatePlates(100, standardBar, [{ weight_kg: -2.5, count: 2 }])).toThrow()
    expect(() => calculatePlates(100, standardBar, standardPlates, 3)).toThrow()
  })

  it('converts lbs to kg accurately', () => {
    expect(toKg(100, 'lb')).toBeCloseTo(45.359, 2)
    expect(toKg(45, 'kg')).toBe(45)
  })

  it('property test: exact loads always equal bar weight plus twice per-side plate sum', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 200 }),
        (target) => {
          const res = calculatePlates(target, standardBar, standardPlates)
          if (res.exact) {
            const sideSum = res.exact.per_side.reduce((s, p) => s + p.weight_kg * p.count, 0)
            expect(res.exact.load_kg).toBeCloseTo(standardBar.weight_kg + 2 * sideSum, 3)
          }
        },
      ),
    )
  })
})
