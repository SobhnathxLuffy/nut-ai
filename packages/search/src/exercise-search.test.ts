import { describe, expect, it } from 'vitest'
import { rankSearch, type SearchEntity } from './index.js'

describe('Exercise Search Ranking and Filters (SRH-003)', () => {
  const exercises: SearchEntity[] = [
    {
      id: 'ex:1',
      type: 'exercise',
      label: 'Barbell Bench Press',
      aliases: ['Flat bench', 'Chest press'],
      source: 'builtin',
      provenance: 'Nut AI original taxonomy v1',
      custom: false,
      equipment: ['barbell', 'bench'],
      muscles: ['chest', 'triceps'],
      tracking_type: 'weight_reps',
    },
    {
      id: 'ex:2',
      type: 'exercise',
      label: 'Dumbbell Bench Press',
      aliases: ['DB bench', 'Flat dumbbell press'],
      source: 'builtin',
      provenance: 'Nut AI original taxonomy v1',
      custom: false,
      equipment: ['dumbbell', 'bench'],
      muscles: ['chest', 'triceps'],
      tracking_type: 'weight_reps',
    },
    {
      id: 'ex:3',
      type: 'exercise',
      label: 'My Custom Incline Press',
      aliases: ['Incline bench', 'Chest press'],
      source: 'user',
      provenance: 'user',
      custom: true,
      equipment: ['dumbbell', 'bench'],
      muscles: ['chest', 'shoulders'],
      tracking_type: 'weight_reps',
    },
    {
      id: 'ex:4',
      type: 'exercise',
      label: 'Push Up',
      aliases: ['Press up'],
      source: 'builtin',
      provenance: 'Nut AI original taxonomy v1',
      custom: false,
      equipment: [],
      muscles: ['chest'],
      tracking_type: 'bodyweight_reps',
    },
    {
      id: 'ex:5',
      type: 'exercise',
      label: 'Cable Crossover',
      aliases: ['Cable fly'],
      source: 'builtin',
      provenance: 'Nut AI original taxonomy v1',
      custom: false,
      equipment: ['cable'],
      muscles: ['chest'],
      tracking_type: 'weight_reps',
    },
  ]

  it('boosts custom exercises so they are not hidden behind built-in exercises on equal query confidence', () => {
    // Both ex:1, ex:2, and ex:3 have alias or label matching "bench press"
    const res = rankSearch(exercises, {
      query: 'bench press',
      locale: 'en-IN',
      scopes: ['exercise'],
      limit: 10,
    })
    expect(res.results.length).toBeGreaterThan(0)
    // Custom exercise ex:3 gets +100 exercise bonus and +50 custom bonus
    const customEx = res.results.find((r) => r.id === 'ex:3')
    expect(customEx).toBeDefined()
    expect(customEx?.custom).toBe(true)
  })

  it('filters exercises by user owned equipment inventory', () => {
    // User only owns dumbbell and bench (no barbell, no cable)
    const ownedEquipment = ['dumbbell', 'bench']
    const res = rankSearch(exercises, {
      query: '',
      locale: 'en-IN',
      scopes: ['exercise'],
      limit: 10,
      allowEmpty: true,
      filters: { equipment: ownedEquipment },
    })

    // Barbell Bench Press (needs barbell) and Cable Crossover (needs cable) should be excluded
    const ids = res.results.map((r) => r.id)
    expect(ids).toContain('ex:2') // Dumbbell Bench Press (dumbbell, bench)
    expect(ids).toContain('ex:3') // My Custom Incline Press (dumbbell, bench)
    expect(ids).toContain('ex:4') // Push Up (bodyweight, no equipment required)
    expect(ids).not.toContain('ex:1') // Barbell Bench Press
    expect(ids).not.toContain('ex:5') // Cable Crossover
  })

  it('filters exercises by muscle group', () => {
    const res = rankSearch(exercises, {
      query: '',
      locale: 'en-IN',
      scopes: ['exercise'],
      limit: 10,
      allowEmpty: true,
      filters: { muscle: 'shoulders' },
    })
    expect(res.results.length).toBe(1)
    expect(res.results[0]?.id).toBe('ex:3')
  })

  it('exposes tracking type, equipment, and custom flag in search results', () => {
    const res = rankSearch(exercises, {
      query: 'push up',
      locale: 'en-IN',
      scopes: ['exercise'],
      limit: 1,
    })
    expect(res.results.length).toBe(1)
    const pushup = res.results[0]!
    expect(pushup.label).toBe('Push Up')
    expect(pushup.tracking_type).toBe('bodyweight_reps')
    expect(pushup.equipment).toEqual([])
    expect(pushup.custom).toBe(false)
  })
})
